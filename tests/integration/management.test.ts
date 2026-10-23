import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './fixture.js';
import { OrganizationService } from '../../apps/api/src/organization.js';
import { WorkflowService } from '../../apps/api/src/workflows.js';
import { ProcessService } from '../../apps/api/src/processes.js';
import { createTemplate } from '../../packages/core/src/index.js';

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  f = await fixture();
});
afterAll(async () => {
  await f?.runtime.close();
  await f?.control.close();
});

it('writes membership before/after audit and enforces append-only tenant isolation', async () => {
  const org = new OrganizationService(f.runtime);
  const member = f.actors.outsider;
  await org.membership(f.actors.admin, member.userId, {
    role: 'employee',
    scope: 'DEPARTMENT',
    departmentId: member.departmentId,
    active: true,
  });
  const log = await f.runtime.tenant(f.tenantId, (tx) =>
    tx.managementLog.findFirstOrThrow({ where: { subjectId: member.userId } }),
  );
  expect(log.action).toBe('membership.updated');
  expect(log.payload).toMatchObject({ before: { scope: 'SELF' }, after: { scope: 'DEPARTMENT' } });
  await expect(f.control.client.managementLog.delete({ where: { id: log.id } })).rejects.toThrow(
    'append-only',
  );
  expect(await f.runtime.tenant(f.otherTenantId, (tx) => tx.managementLog.count())).toBe(0);
});

it('rolls back the draft when the management audit cannot be written', async () => {
  const workflow = new WorkflowService(f.runtime);
  const id = f.definitions.LEAVE!;
  await expect(
    workflow.save({ ...f.actors.admin, userId: randomUUID() }, id, {
      graph: createTemplate('LEAVE'),
      expectedRevision: 0,
    }),
  ).rejects.toThrow();
  expect(
    (await f.control.client.flowDefinition.findUniqueOrThrow({ where: { id } })).revision,
  ).toBe(0);
  expect(await f.control.client.managementLog.count({ where: { subjectId: id } })).toBe(0);
});

it('hides previously delivered notifications after a data scope reduction', async () => {
  const processes = new ProcessService(f.runtime);
  const org = new OrganizationService(f.runtime);
  const { id } = (await processes.submit(
    f.actors.outsider,
    { data: { type: 'EXPENSE', title: 'Notification scope', amountCents: 100 } },
    randomUUID(),
  )) as { id: string };
  const event = await f.control.client.domainEvent.findFirstOrThrow({ where: { instanceId: id } });
  await f.control.client.notification.create({
    data: {
      tenantId: f.tenantId,
      userId: f.actors.manager.userId,
      eventId: event.id,
      instanceId: id,
      title: 'Reminder delivered before a scope change',
    },
  });
  const notifications = (await org.notifications({ ...f.actors.manager, scope: 'TENANT' })) as {
    id: string;
  }[];
  expect(notifications.length).toBeGreaterThan(0);
  expect(await org.notifications({ ...f.actors.manager, scope: 'SELF' })).toEqual([]);
});
