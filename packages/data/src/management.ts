import type { Actor } from '../../contracts/src/index.js';
import { json, type Transaction } from './index.js';
export async function recordManagement(
  tx: Transaction,
  actor: Actor,
  action: string,
  subjectId: string,
  payload: unknown,
): Promise<void> {
  await tx.managementLog.create({
    data: {
      tenantId: actor.tenantId,
      actorId: actor.userId,
      action,
      subjectId,
      payload: json(payload),
    },
  });
}
