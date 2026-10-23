import { randomUUID } from 'node:crypto';
import { Database, json } from './index.js';
import { tenantMembers } from './members.js';
import { saveTransition } from './transitions.js';
import { flowSchema, type Actor } from '../../contracts/src/index.js';
import { escalateOverdue, type ProcessState } from '../../core/src/index.js';

export class BackgroundWorker {
  constructor(private readonly db: Database) {}
  async deliverOne(tenantId: string): Promise<boolean> {
    let eventId: string | undefined;
    try {
      return await this.db.tenant(tenantId, async (tx) => {
        const rows = await tx.$queryRaw<
          { eventId: string }[]
        >`SELECT "eventId" FROM outbox WHERE "processedAt" IS NULL AND "failedAt" IS NULL AND "availableAt" <= NOW() ORDER BY "availableAt", "eventId" LIMIT 1 FOR UPDATE SKIP LOCKED`;
        eventId = rows[0]?.eventId;
        if (!eventId) return false;
        const event = await tx.domainEvent.findUniqueOrThrow({ where: { id: eventId } });
        const instance = await tx.processInstance.findUniqueOrThrow({
          where: { id: event.instanceId },
        });
        await tx.auditLog.createMany({
          data: [
            {
              id: event.id,
              tenantId,
              instanceId: event.instanceId,
              actorId: event.actorId,
              action: event.type,
              payload: json(event.payload),
              occurredAt: event.occurredAt,
            },
          ],
          skipDuplicates: true,
        });
        const payload = event.payload as Record<string, unknown>;
        const recipients = Array.isArray(payload.recipientIds)
          ? payload.recipientIds.filter((id): id is string => typeof id === 'string')
          : [];
        const valid = await tx.membership.findMany({
          where: { userId: { in: recipients }, active: true },
        });
        if (valid.length)
          await tx.notification.createMany({
            data: valid.map((m) => ({
              tenantId,
              eventId: event.id,
              userId: m.userId,
              instanceId: event.instanceId,
              title: `${instance.title} · ${event.type}`,
            })),
            skipDuplicates: true,
          });
        await tx.outbox.update({
          where: { eventId },
          data: { processedAt: new Date(), lastError: null },
        });
        return true;
      });
    } catch (error) {
      if (!eventId) throw error;
      await this.db.tenant(tenantId, async (tx) => {
        const record = await tx.outbox.findUnique({ where: { eventId } });
        if (!record || record.processedAt) return;
        const attempts = record.attempts + 1;
        await tx.outbox.update({
          where: { eventId },
          data: {
            attempts,
            lastError:
              error instanceof Error ? error.message.slice(0, 500) : 'unknown delivery error',
            failedAt: attempts >= 5 ? new Date() : null,
            availableAt: new Date(Date.now() + Math.min(300000, 1000 * 2 ** attempts)),
          },
        });
      });
      return false;
    }
  }
  async escalate(tenantId: string, now = new Date()): Promise<number> {
    const due = await this.db.tenant(tenantId, (tx) =>
      tx.taskIndex.findMany({
        where: {
          escalated: false,
          dueAt: { lte: now },
          status: { in: ['PENDING', 'ASSIGNED', 'IN_PROGRESS'] },
        },
        select: { instanceId: true },
        take: 100,
      }),
    );
    let count = 0;
    for (const instanceId of new Set(due.map((t) => t.instanceId))) {
      await this.db.tenant(tenantId, async (tx) => {
        const instance = await tx.processInstance.findUnique({ where: { id: instanceId } });
        if (!instance) return;
        const version = await tx.flowVersion.findUniqueOrThrow({
          where: { id: instance.versionId },
        });
        const system = await tx.user.findUniqueOrThrow({
          where: { email: 'system@flowforge.invalid' },
        });
        const actor: Actor = {
          userId: system.id,
          tenantId,
          departmentId: instance.departmentId,
          role: 'admin',
          scope: 'TENANT',
          name: '系统调度器',
        };
        const transition = escalateOverdue(
          instance.state as unknown as ProcessState,
          flowSchema.parse(version.graph),
          actor,
          { now: now.toISOString(), id: randomUUID, members: await tenantMembers(tx) },
        );
        if (!transition) return;
        const updated = await tx.processInstance.updateMany({
          where: { id: instance.id, revision: instance.revision },
          data: { revision: transition.state.revision, state: json(transition.state) },
        });
        if (!updated.count) return;
        await saveTransition(tx, tenantId, transition);
        count++;
      });
    }
    return count;
  }
  async tick(): Promise<void> {
    const tenants = await this.db.client.tenant.findMany({ select: { id: true } });
    for (const tenant of tenants) {
      await this.escalate(tenant.id);
      for (let i = 0; i < 100; i++) if (!(await this.deliverOne(tenant.id))) break;
    }
  }
}
