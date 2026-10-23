import 'dotenv/config';
import { Database, json } from '../packages/data/src/index.js';
import { hashPassword } from '../packages/data/src/security.js';
import { BackgroundWorker } from '../packages/data/src/worker.js';
import { createTemplate } from '../packages/core/src/index.js';
import { applicationTypes, type Actor, type ApplicationType, type DataScope, type Role } from '../packages/contracts/src/index.js';
import { ProcessService } from '../apps/api/src/processes.js';

if (process.env.NODE_ENV === 'production') throw new Error('Demo seeding is disabled in production');
if (!process.env.DATABASE_ADMIN_URL || !process.env.DEMO_PASSWORD) throw new Error('Run pnpm setup before seeding');
const control = new Database(process.env.DATABASE_ADMIN_URL);
const runtime = new Database();
const processes = new ProcessService(runtime);
export const demoId = (n: number): string => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const profiles: { key: string; name: string; role: Role; scope: DataScope; department: number }[] = [
  { key: 'admin', name: '陈知行', role: 'admin', scope: 'TENANT', department: 1 },
  { key: 'employee', name: '林悦', role: 'employee', scope: 'SELF', department: 1 },
  { key: 'manager', name: '周明远', role: 'manager', scope: 'DEPARTMENT_TREE', department: 1 },
  { key: 'finance1', name: '许清禾', role: 'approver', scope: 'SELF', department: 2 },
  { key: 'finance2', name: '陆予安', role: 'approver', scope: 'SELF', department: 2 },
  { key: 'agent', name: '程野', role: 'agent', scope: 'SELF', department: 3 },
  { key: 'colleague', name: '沈星', role: 'employee', scope: 'SELF', department: 2 },
];
try {
  const systemId = demoId(9999);
  await control.client.user.upsert({ where: { id: systemId }, create: { id: systemId, email: 'system@flowforge.invalid', name: '系统调度器', passwordHash: await hashPassword('disabled-system-account'), active: false }, update: {} });
  for (const [index, company] of ['星澜科技', '远山设计'].entries()) {
    const base = index * 1000; const tenantId = demoId(base + 100); const domain = index === 0 ? 'flowforge.demo' : 'northstar.demo';
    await control.client.tenant.upsert({ where: { id: tenantId }, create: { id: tenantId, name: company }, update: {} });
    for (const [departmentIndex, name] of ['产品研发部', '财务中心', '技术服务部'].entries()) {
      const id = demoId(base + 201 + departmentIndex);
      await control.client.department.upsert({ where: { id }, create: { id, tenantId, name, parentId: departmentIndex === 2 ? demoId(base + 201) : null }, update: {} });
    }
    const actors: Actor[] = [];
    for (const [profileIndex, profile] of profiles.entries()) {
      const userId = demoId(base + 1 + profileIndex); const departmentId = demoId(base + 200 + profile.department);
      await control.client.user.upsert({ where: { id: userId }, create: { id: userId, email: `${profile.key}@${domain}`, name: profile.name, passwordHash: await hashPassword(process.env.DEMO_PASSWORD) }, update: {} });
      await control.client.membership.upsert({ where: { tenantId_userId: { tenantId, userId } }, create: { tenantId, userId, departmentId, role: profile.role, scope: profile.scope }, update: {} });
      actors.push({ userId, tenantId, departmentId, role: profile.role, scope: profile.scope, name: profile.name });
    }
    await control.client.membership.upsert({ where: { tenantId_userId: { tenantId, userId: systemId } }, create: { tenantId, userId: systemId, departmentId: demoId(base + 201), role: 'employee', scope: 'SELF', active: false }, update: {} });
    for (const [typeIndex, type] of applicationTypes.entries()) {
      const definitionId = demoId(base + 300 + typeIndex); const graph = createTemplate(type);
      await control.client.flowDefinition.upsert({ where: { id: definitionId }, create: { id: definitionId, tenantId, name: { LEAVE: '员工请假流程', EXPENSE: '费用报销流程', PURCHASE: '采购申请流程', INCIDENT: '故障服务流程' }[type], type, draft: json(graph), latestVersion: 1 }, update: {} });
      const versionId = demoId(base + 400 + typeIndex);
      if (!await control.client.flowVersion.findUnique({ where: { id: versionId } })) await control.client.flowVersion.create({ data: { id: versionId, tenantId, definitionId, number: 1, graph: json(graph), publishedBy: actors[0]!.userId } });
    }
    const scenarios: { key: string; title: string; type: ApplicationType; amount: number; action?: 'approve' | 'return'; applicant?: number }[] = [
      { key: 'purchase', title: '设计团队 · 工作站采购', type: 'PURCHASE', amount: 2680000 },
      { key: 'travel', title: '上海客户拜访 · 差旅报销', type: 'EXPENSE', amount: 892000, action: 'approve' },
      { key: 'completed', title: '团队协作工具 · 月度订阅', type: 'EXPENSE', amount: 128000, action: 'approve' },
      { key: 'leave', title: '年度休假 · 待补充交接安排', type: 'LEAVE', amount: 0, action: 'return' },
      { key: 'incident', title: '会议室 A · 视频会议设备离线', type: 'INCIDENT', amount: 0 },
      { key: 'private', title: '财务中心 · 内部费用申请', type: 'EXPENSE', amount: 150000, applicant: 6 },
    ];
    for (const scenario of scenarios) {
      if (await control.client.processInstance.findFirst({ where: { tenantId, title: scenario.title } })) continue;
      const applicant = actors[scenario.applicant ?? 1]!;
      const result = await processes.submit(applicant, { data: { title: scenario.title, type: scenario.type, amountCents: scenario.amount, leaveMinutes: scenario.type === 'LEAVE' ? 960 : 0, priority: scenario.type === 'INCIDENT' ? 'HIGH' : 'NORMAL', description: '演示数据。所有人员、金额与业务内容均为合成，可用于完整业务操作。' } }, `seed:${scenario.key}`) as { id: string };
      if (scenario.action) {
        const instance = await control.client.processInstance.findUniqueOrThrow({ where: { id: result.id } });
        const state = instance.state as unknown as import('../packages/core/src/index.js').ProcessState;
        await processes.command(actors[2]!, result.id, { expectedRevision: 0, action: scenario.action, taskId: state.tasks[0]?.id, comment: scenario.action === 'return' ? '请补充休假期间的工作交接安排' : '预算与材料已确认' }, `seed:${scenario.key}:decision`);
      }
    }
  }
  await new BackgroundWorker(runtime).tick();
  console.log('Demo data ready. Login: admin@flowforge.demo / password from DEMO_PASSWORD in .env');
} finally { await control.close(); await runtime.close(); }
