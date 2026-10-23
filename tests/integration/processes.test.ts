import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './fixture.js';
import { ProcessService } from '../../apps/api/src/processes.js';
import { WorkflowService } from '../../apps/api/src/workflows.js';
import { BackgroundWorker } from '../../packages/data/src/worker.js';
import { OrganizationService } from '../../apps/api/src/organization.js';
import { createTemplate, type ProcessState } from '../../packages/core/src/index.js';
import type { Actor, FlowGraph, InstanceCommand } from '../../packages/contracts/src/index.js';

let f: Awaited<ReturnType<typeof fixture>>;
let service: ProcessService;
beforeAll(async () => {
  f = await fixture();
  service = new ProcessService(f.runtime);
});
afterAll(async () => {
  await f?.runtime.close();
  await f?.control.close();
});
const input = (amountCents = 10000, title = 'Integration expense') => ({
  data: {
    title,
    type: 'EXPENSE',
    amountCents,
    leaveMinutes: 0,
    priority: 'NORMAL',
    description: '',
  },
});
async function submit(amount = 10000, actor?: Actor, title?: string): Promise<string> {
  return (
    (await service.submit(actor ?? f.actors.employee, input(amount, title), randomUUID())) as {
      id: string;
    }
  ).id;
}
async function state(id: string): Promise<ProcessState> {
  return (await f.control.client.processInstance.findUniqueOrThrow({ where: { id } }))
    .state as unknown as ProcessState;
}
function command(
  snapshot: ProcessState,
  actor: Actor,
  action: InstanceCommand['action'] = 'approve',
) {
  return {
    expectedRevision: snapshot.revision,
    action,
    comment: '',
    taskId: snapshot.tasks.find((t) => t.status === 'PENDING' && t.assigneeId === actor.userId)?.id,
  };
}

describe('database enforcement', () => {
  it('connects as a non-owner without BYPASSRLS', async () => {
    const role = await f.runtime.client.$queryRaw<
      { rolsuper: boolean; rolbypassrls: boolean }[]
    >`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(role[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    expect(await f.runtime.client.flowDefinition.findMany()).toEqual([]);
  });
  it('isolates tenants even for unfiltered queries and rejects cross-tenant inserts', async () => {
    expect(await f.runtime.tenant(f.otherTenantId, (tx) => tx.flowDefinition.findMany())).toEqual(
      [],
    );
    await expect(
      f.runtime.tenant(f.otherTenantId, (tx) =>
        tx.department.create({ data: { tenantId: f.tenantId, name: 'Forbidden' } }),
      ),
    ).rejects.toThrow();
    expect(await f.runtime.tenant(f.tenantId, (tx) => tx.flowDefinition.count())).toBe(4);
  });
  it('protects immutable published versions at the database boundary', async () => {
    const version = await f.control.client.flowVersion.findFirstOrThrow({
      where: { tenantId: f.tenantId },
    });
    await expect(
      f.control.client.flowVersion.update({ where: { id: version.id }, data: { number: 99 } }),
    ).rejects.toThrow('append-only');
  });
  it('filters details, lists and dashboard aggregates by data scope', async () => {
    const id = await submit(10000, f.actors.outsider);
    await expect(service.detail(f.actors.employee, id)).rejects.toThrow('无权访问');
    const employeeList = (await service.list(f.actors.employee, {})) as { items: { id: string }[] };
    expect(employeeList.items.some((i) => i.id === id)).toBe(false);
    await expect(service.detail(f.actors.manager, id)).rejects.toThrow('无权访问');
    expect(
      await service.detail({ ...f.actors.manager, scope: 'DEPARTMENT_TREE' }, id),
    ).toBeTruthy();
    await expect(service.events(f.actors.employee, id, 0)).rejects.toThrow('无权访问');
  });
});

describe('concurrent commands', () => {
  it('replays simultaneous identical submissions and rejects conflicting key reuse', async () => {
    const key = randomUUID();
    const body = input();
    const results = (await Promise.all(
      Array.from({ length: 8 }, () => service.submit(f.actors.employee, body, key)),
    )) as { id: string }[];
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await f.control.client.processInstance.count({ where: { id: results[0]!.id } })).toBe(1);
    await expect(service.submit(f.actors.employee, input(20000), key)).rejects.toThrow('幂等键');
  });
  it('lets only one concurrent OR-sign decision succeed', async () => {
    const id = await submit();
    const before = await state(id);
    expect(before.tasks.filter((t) => t.status === 'PENDING')).toHaveLength(2);
    const results = await Promise.allSettled(
      [f.actors.manager, f.actors.manager2].map((actor) =>
        service.command(actor, id, command(before, actor), randomUUID()),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const final = await state(id);
    expect(final.status).toBe('COMPLETED');
    expect(final.revision).toBe(1);
    expect(final.tasks.filter((t) => t.status === 'APPROVED')).toHaveLength(1);
    expect(final.tasks.some((t) => t.status === 'PENDING')).toBe(false);
  });
  it('keeps all countersign seats when different reviewers race', async () => {
    const id = await submit(900000);
    let before = await state(id);
    await service.command(f.actors.manager, id, command(before, f.actors.manager), randomUUID());
    before = await state(id);
    const reviewers = [f.actors.reviewer1, f.actors.reviewer2];
    const results = await Promise.allSettled(
      reviewers.map((actor) => service.command(actor, id, command(before, actor), randomUUID())),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const loser = reviewers[results.findIndex((r) => r.status === 'rejected')]!;
    const partial = await state(id);
    expect(partial.status).toBe('RUNNING');
    await service.command(loser, id, command(partial, loser), randomUUID());
    expect((await state(id)).status).toBe('COMPLETED');
  });
  it('replays an approval result before checking its now-stale revision', async () => {
    const id = await submit();
    const before = await state(id);
    const key = randomUUID();
    const body = command(before, f.actors.manager);
    const first = await service.command(f.actors.manager, id, body, key);
    expect(await service.command(f.actors.manager, id, body, key)).toEqual(first);
    expect((await state(id)).revision).toBe(1);
    const events = await f.control.client.domainEvent.count({
      where: { instanceId: id, type: 'task.approved' },
    });
    expect(events).toBe(1);
  });
  it('serializes withdrawal versus approval with no orphaned pending tasks', async () => {
    const id = await submit();
    const before = await state(id);
    const results = await Promise.allSettled([
      service.command(f.actors.manager, id, command(before, f.actors.manager), randomUUID()),
      service.command(
        f.actors.employee,
        id,
        command(before, f.actors.employee, 'withdraw'),
        randomUUID(),
      ),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const final = await state(id);
    expect(['WITHDRAWN', 'COMPLETED']).toContain(final.status);
    expect(final.tasks.some((t) => t.status === 'PENDING')).toBe(false);
    expect(
      await f.runtime.tenant(f.tenantId, (tx) =>
        tx.taskIndex.count({ where: { instanceId: id, status: 'PENDING' } }),
      ),
    ).toBe(0);
  });
});

describe('version and delivery guarantees', () => {
  it('continues old instances on v1 while new instances use v2', async () => {
    const workflows = new WorkflowService(f.runtime);
    const definitionId = f.definitions.PURCHASE!;
    const body = { data: { ...input(2000000).data, type: 'PURCHASE' } };
    const old = (await service.submit(f.actors.employee, body, randomUUID())) as { id: string };
    const graph: FlowGraph = createTemplate('PURCHASE');
    graph.edges.find((e) => e.id === 'branch-finance')!.condition = {
      op: 'gte',
      field: 'amountCents',
      value: 1000000000,
    };
    const saved = (await workflows.save(f.actors.admin, definitionId, {
      graph,
      expectedRevision: 0,
    })) as { revision: number };
    await workflows.publish(f.actors.admin, definitionId, { expectedRevision: saved.revision });
    const fresh = (await service.submit(f.actors.employee, body, randomUUID())) as { id: string };
    await service.command(
      f.actors.manager,
      old.id,
      command(await state(old.id), f.actors.manager),
      randomUUID(),
    );
    await service.command(
      f.actors.manager,
      fresh.id,
      command(await state(fresh.id), f.actors.manager),
      randomUUID(),
    );
    expect((await state(old.id)).currentNodeId).toBe('finance');
    expect((await state(fresh.id)).status).toBe('COMPLETED');
    expect((await state(old.id)).versionId).not.toBe((await state(fresh.id)).versionId);
  });
  it('deduplicates notifications and immutable audit projections on redelivery', async () => {
    const worker = new BackgroundWorker(f.runtime);
    while (await worker.deliverOne(f.tenantId)) {
      /* drain persisted events */
    }
    const id = await submit();
    while (await worker.deliverOne(f.tenantId)) {
      /* drain */
    }
    const event = await f.control.client.domainEvent.findFirstOrThrow({
      where: { instanceId: id, type: 'task.created' },
    });
    const before = await f.control.client.notification.count({ where: { eventId: event.id } });
    expect(before).toBe(1);
    await f.control.client.outbox.update({
      where: { eventId: event.id },
      data: { processedAt: null },
    });
    expect(await worker.deliverOne(f.tenantId)).toBe(true);
    expect(await f.control.client.notification.count({ where: { eventId: event.id } })).toBe(
      before,
    );
    expect(await f.control.client.auditLog.count({ where: { id: event.id } })).toBe(1);
  });
  it('retries failed delivery, exposes dead letters and safely replays them', async () => {
    const worker = new BackgroundWorker(f.runtime);
    while (await worker.deliverOne(f.tenantId)) {
      /* drain */
    }
    await f.control.client.$executeRawUnsafe(
      "CREATE FUNCTION fail_test_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.title LIKE 'FAILURE%' THEN RAISE EXCEPTION 'injected delivery failure'; END IF; RETURN NEW; END; $$",
    );
    await f.control.client.$executeRawUnsafe(
      'CREATE TRIGGER fail_test_notification BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION fail_test_notification()',
    );
    let failedId = '';
    try {
      const id = await submit(10000, undefined, 'FAILURE delivery scenario');
      for (let i = 0; i < 30; i++) if (!(await worker.deliverOne(f.tenantId))) break;
      const failed = await f.control.client.outbox.findFirstOrThrow({
        where: { tenantId: f.tenantId, attempts: 1 },
      });
      failedId = failed.eventId;
      for (let i = 0; i < 4; i++) {
        await f.control.client.outbox.update({
          where: { eventId: failedId },
          data: { availableAt: new Date(0) },
        });
        await worker.deliverOne(f.tenantId);
      }
      const dead = await f.control.client.outbox.findUniqueOrThrow({
        where: { eventId: failedId },
      });
      expect(dead.attempts).toBe(5);
      expect(dead.failedAt).not.toBeNull();
      expect((await state(id)).status).toBe('RUNNING');
      expect(await f.control.client.auditLog.count({ where: { id: failedId } })).toBe(0);
    } finally {
      await f.control.client.$executeRawUnsafe(
        'DROP TRIGGER fail_test_notification ON notifications',
      );
      await f.control.client.$executeRawUnsafe('DROP FUNCTION fail_test_notification()');
    }
    const organization = new OrganizationService(f.runtime);
    await organization.replay(f.actors.admin, failedId);
    while (await worker.deliverOne(f.tenantId)) {
      /* drain */
    }
    expect(
      (await f.control.client.outbox.findUniqueOrThrow({ where: { eventId: failedId } }))
        .processedAt,
    ).not.toBeNull();
  });
});
