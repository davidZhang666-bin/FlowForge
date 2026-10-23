import { expect, test, type Page } from '@playwright/test';
const password = process.env.DEMO_PASSWORD ?? 'FlowForge2026!';
async function login(page: Page, role: string) {
  await page.goto('/');
  await expect(page.locator('.login-form, .app-layout')).toBeVisible();
  const logout = page.getByRole('button', { name: '退出登录' });
  if (await logout.isVisible()) {
    await logout.click();
    await expect(page.getByRole('heading', { name: '登录你的工作空间' })).toBeVisible();
  }
  await page.getByLabel('工作邮箱').fill(`${role}@flowforge.demo`);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
}
async function submit(page: Page, type: string, suffix: string, amount = '123.45') {
  await page.goto(`/new?type=${type}`);
  const title = `E2E ${suffix} ${Date.now()}`;
  await page.getByLabel('申请标题').fill(title);
  if (type === 'EXPENSE' || type === 'PURCHASE')
    await page.getByLabel('申请金额（元）').fill(amount);
  if (type === 'LEAVE') await page.getByLabel('请假时长（工作日，每天 8 小时）').fill('2');
  await page.getByRole('button', { name: '提交申请', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  return { url: page.url(), title };
}
async function status(page: Page, text: string) {
  await expect(page.locator('.instance-summary')).toContainText(text);
}

test('dashboard renders real records and adapts to a narrow viewport', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, 'admin');
  await expect(page.getByText('最近流转', { exact: true })).toBeVisible();
  await expect(page.locator('.metric-card')).toHaveCount(4);
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
test('an applicant submits and a manager approves along the actual path', async ({ page }) => {
  await login(page, 'employee');
  const item = await submit(page, 'EXPENSE', 'ordinary expense');
  await status(page, '进行中');
  await login(page, 'manager');
  await page.goto(item.url);
  await page.getByRole('button', { name: '同意申请', exact: true }).click();
  await status(page, '已完成');
  await expect(page.locator('.react-flow__edge.animated')).not.toHaveCount(0);
});
test('countersign waits for both financial reviewers', async ({ page }) => {
  await login(page, 'employee');
  const item = await submit(page, 'EXPENSE', 'countersign expense', '8900');
  await login(page, 'manager');
  await page.goto(item.url);
  await page.getByRole('button', { name: '同意申请', exact: true }).click();
  await expect(page.locator('.action-panel')).toContainText('财务会签');
  await login(page, 'finance1');
  await page.goto(item.url);
  await page.getByRole('button', { name: '同意申请', exact: true }).click();
  await status(page, '进行中');
  await expect(page.locator('.action-panel')).toContainText('陆予安');
  await login(page, 'finance2');
  await page.goto(item.url);
  await page.getByRole('button', { name: '同意申请', exact: true }).click();
  await status(page, '已完成');
});
test('return and resubmit preserve the version and show separate rounds', async ({ page }) => {
  await login(page, 'employee');
  const item = await submit(page, 'EXPENSE', 'returned expense');
  await login(page, 'manager');
  await page.goto(item.url);
  await page.getByRole('button', { name: '退回修改', exact: true }).click();
  await page.getByRole('dialog').getByLabel('处理意见 / 原因').fill('请补充费用明细');
  await page.getByRole('button', { name: '确认操作' }).click();
  await status(page, '待修改');
  await login(page, 'employee');
  await page.goto(item.url);
  await page.getByRole('button', { name: '修改并重新提交', exact: true }).click();
  await page.getByRole('dialog').getByLabel('申请说明').fill('已补充费用明细和用途');
  await page.getByRole('button', { name: '重新提交', exact: true }).click();
  await status(page, '第 2 轮');
  await status(page, '流程 v1');
  await page.getByRole('combobox', { name: '查看审批轮次' }).click();
  await page.getByText('第 1 轮执行', { exact: true }).click();
  await expect(page.locator('.event-panel')).toContainText('退回申请人');
});
test('incident supports claim, resolution, reopening and final acceptance', async ({ page }) => {
  await login(page, 'employee');
  const item = await submit(page, 'INCIDENT', 'incident lifecycle');
  await login(page, 'agent');
  await page.goto(item.url);
  await page.getByRole('button', { name: '认领并开始处理' }).click();
  await page.getByRole('button', { name: '提交解决结果', exact: true }).click();
  await page.getByRole('dialog').getByLabel('处理意见 / 原因').fill('已完成设备复位与检查');
  await page.getByRole('button', { name: '确认操作' }).click();
  await expect(page.locator('.action-panel')).toContainText('待验收');
  await login(page, 'employee');
  await page.goto(item.url);
  await page.getByRole('button', { name: '问题未解决，重开工单' }).click();
  await page.getByRole('dialog').getByLabel('处理意见 / 原因').fill('仍然间歇性断线');
  await page.getByRole('button', { name: '确认操作' }).click();
  await login(page, 'agent');
  await page.goto(item.url);
  await page.getByRole('button', { name: '提交解决结果', exact: true }).click();
  await page.getByRole('dialog').getByLabel('处理意见 / 原因').fill('更换供电模块，复测通过');
  await page.getByRole('button', { name: '确认操作' }).click();
  await login(page, 'employee');
  await page.goto(item.url);
  await page.getByRole('button', { name: '确认验收', exact: true }).click();
  await status(page, '已完成');
});
test('publishing a changed branch keeps old requests on their original version', async ({
  page,
}) => {
  await login(page, 'employee');
  const old = await submit(page, 'PURCHASE', 'old version purchase', '20000');
  await login(page, 'admin');
  await page.goto('/workflows');
  await page.getByRole('heading', { name: '采购申请流程', exact: true }).click();
  await expect(page.getByText('草稿工作区', { exact: false })).toBeVisible();
  await page.locator('.react-flow__node').filter({ hasText: '申请金额判断' }).click();
  await page.getByLabel('条件阈值').fill('9000000');
  await page.getByLabel('分支名称').first().fill('金额 ≥ ¥90,000');
  await page.getByRole('button', { name: '发布新版本', exact: true }).click();
  await expect(page.getByText('当前发布 v2', { exact: false })).toBeVisible();
  await login(page, 'employee');
  const fresh = await submit(page, 'PURCHASE', 'new version purchase', '20000');
  await status(page, '流程 v2');
  await login(page, 'manager');
  await page.goto(old.url);
  await status(page, '流程 v1');
  await page.getByRole('button', { name: '同意申请', exact: true }).click();
  await expect(page.locator('.action-panel')).toContainText('财务会签');
  await page.goto(fresh.url);
  await page.getByRole('button', { name: '同意申请', exact: true }).click();
  await status(page, '已完成');
});
test('ordinary members cannot enter the administrative designer', async ({ page }) => {
  await login(page, 'employee');
  await expect(page.getByRole('link', { name: '流程设计', exact: true })).toHaveCount(0);
  await page.goto('/workflows');
  await expect(page.getByText('仅企业管理员可配置流程', { exact: true })).toBeVisible();
});

test('dragged nodes persist in drafts and disconnected nodes block publication', async ({
  page,
}) => {
  await login(page, 'admin');
  await page.goto('/workflows');
  await page.getByRole('heading', { name: '费用报销流程', exact: true }).click();
  const node = page.locator('.react-flow__node').filter({ hasText: '部门负责人审批' });
  const bounds = await node.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + 25);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width / 2 + 80, bounds!.y + 65, { steps: 10 });
  await page.mouse.up();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible();
  const originalCount = await page.locator('.react-flow__node').count();
  await page
    .getByRole('button', { name: '审批节点', exact: true })
    .dragTo(page.locator('.designer-canvas'), { targetPosition: { x: 100, y: 200 } });
  await expect(page.locator('.react-flow__node')).toHaveCount(originalCount + 1);
  await expect(page.getByRole('button', { name: '发布新版本', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(originalCount + 1);
});
