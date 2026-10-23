import type { Prisma } from '@prisma/client';
import type { Actor } from '../../../packages/contracts/src/index.js';
import type { Transaction } from '../../../packages/data/src/index.js';

export async function instanceScope(tx: Transaction, actor: Actor): Promise<Prisma.ProcessInstanceWhereInput> {
  if (actor.scope === 'TENANT') return { tenantId: actor.tenantId };
  const clauses: Prisma.ProcessInstanceWhereInput[] = [{ applicantId: actor.userId }];
  const participation = await tx.participant.findMany({ where: { userId: actor.userId }, select: { instanceId: true } });
  clauses.push({ id: { in: participation.map(p => p.instanceId) } });
  if (actor.scope === 'DEPARTMENT') clauses.push({ departmentId: actor.departmentId });
  if (actor.scope === 'DEPARTMENT_TREE') {
    const departments = await tx.department.findMany();
    const ids = new Set([actor.departmentId]);
    let changed = true;
    while (changed) { changed = false; for (const department of departments) { if (department.parentId && ids.has(department.parentId) && !ids.has(department.id)) { ids.add(department.id); changed = true; } } }
    clauses.push({ departmentId: { in: [...ids] } });
  }
  return { tenantId: actor.tenantId, OR: clauses };
}
