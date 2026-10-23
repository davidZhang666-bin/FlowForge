import type { Member } from '../../contracts/src/index.js';
import type { Transaction } from './index.js';
export async function tenantMembers(tx: Transaction): Promise<Member[]> {
  const memberships = await tx.membership.findMany();
  const users = await tx.user.findMany({
    where: { id: { in: memberships.map((m) => m.userId) } },
    select: { id: true, name: true, active: true },
  });
  return memberships.map((m) => ({
    userId: m.userId,
    departmentId: m.departmentId,
    role: m.role as Member['role'],
    name: users.find((u) => u.id === m.userId)?.name ?? '未知成员',
    active: m.active && !!users.find((u) => u.id === m.userId)?.active,
  }));
}
