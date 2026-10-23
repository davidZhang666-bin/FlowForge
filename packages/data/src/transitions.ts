import { json, type Transaction } from './index.js';
import type { Transition } from '../../core/src/index.js';

/** The aggregate is canonical; task/participant indexes are updated in the same transaction. */
export async function saveTransition(
  tx: Transaction,
  tenantId: string,
  transition: Transition,
): Promise<void> {
  const { state, events } = transition;
  for (const task of state.tasks) {
    const data = {
      tenantId,
      instanceId: state.id,
      nodeId: task.nodeId,
      round: task.round,
      kind: 'approval',
      assigneeId: task.assigneeId,
      status: task.status,
      dueAt: new Date(task.dueAt),
      escalated: task.escalated,
    };
    await tx.taskIndex.upsert({
      where: { id: task.id },
      create: { id: task.id, ...data },
      update: data,
    });
  }
  for (const ticket of state.tickets) {
    const data = {
      tenantId,
      instanceId: state.id,
      nodeId: ticket.nodeId,
      round: ticket.round,
      kind: 'ticket',
      assigneeId: ticket.assigneeId,
      status: ticket.status,
      dueAt: new Date(ticket.dueAt),
      escalated: ticket.escalated,
    };
    await tx.taskIndex.upsert({
      where: { id: ticket.id },
      create: { id: ticket.id, ...data },
      update: data,
    });
  }
  const users = new Set([
    state.applicantId,
    ...state.tasks.map((t) => t.assigneeId),
    ...state.tickets.flatMap((t) => [...t.candidateIds, ...(t.assigneeId ? [t.assigneeId] : [])]),
  ]);
  await tx.participant.createMany({
    data: [...users].map((userId) => ({ tenantId, instanceId: state.id, userId })),
    skipDuplicates: true,
  });
  const latest = await tx.domainEvent.aggregate({
    where: { instanceId: state.id },
    _max: { sequence: true },
  });
  let sequence = latest._max.sequence ?? 0;
  for (const event of events) {
    await tx.domainEvent.create({
      data: {
        id: event.id,
        tenantId,
        instanceId: state.id,
        sequence: ++sequence,
        type: event.type,
        actorId: event.actorId,
        nodeId: event.nodeId,
        round: event.round,
        payload: json(event.payload),
        occurredAt: new Date(event.at),
      },
    });
    await tx.outbox.create({ data: { tenantId, eventId: event.id } });
  }
}
