import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { roles, scopes, type Actor } from '../../../packages/contracts/src/index.js';
import { Database } from '../../../packages/data/src/index.js';
import { tenantMembers } from '../../../packages/data/src/members.js';

@Injectable()
export class OrganizationService {
  constructor(private readonly db: Database) {}
  async directory(actor: Actor): Promise<unknown> {
    return this.db.tenant(actor.tenantId, async tx => ({ departments: await tx.department.findMany({ orderBy: { name: 'asc' } }), members: await tenantMembers(tx), memberships: actor.role === 'admin' ? await tx.membership.findMany() : [] }));
  }
  async membership(actor: Actor, userId: string, input: unknown): Promise<unknown> {
    if (actor.role !== 'admin') throw new ForbiddenException('需要企业管理员权限');
    z.string().uuid().parse(userId);
    const data = z.object({ role: z.enum(roles), scope: z.enum(scopes), departmentId: z.string().uuid(), active: z.boolean() }).strict().parse(input);
    return this.db.tenant(actor.tenantId, async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`org:${actor.tenantId}`}, 0))`;
      const old = await tx.membership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId: actor.tenantId, userId } } });
      if (userId === actor.userId && (!data.active || data.role !== 'admin')) throw new ConflictException('不能停用或降级当前管理员，请由另一位管理员操作');
      if (old.role === 'admin' && old.active && (!data.active || data.role !== 'admin') && await tx.membership.count({ where: { role: 'admin', active: true } }) <= 1) throw new ConflictException('企业必须保留至少一位管理员');
      return tx.membership.update({ where: { tenantId_userId: { tenantId: actor.tenantId, userId } }, data });
    });
  }
  async notifications(actor: Actor): Promise<unknown> {
    return this.db.tenant(actor.tenantId, tx => tx.notification.findMany({ where: { userId: actor.userId }, orderBy: { createdAt: 'desc' }, take: 50 }));
  }
  async read(actor: Actor, id: string): Promise<unknown> {
    z.string().uuid().parse(id);
    return this.db.tenant(actor.tenantId, tx => tx.notification.updateMany({ where: { id, userId: actor.userId }, data: { readAt: new Date() } }));
  }
  async failures(actor: Actor): Promise<unknown> {
    if (actor.role !== 'admin') throw new ForbiddenException('需要企业管理员权限');
    return this.db.tenant(actor.tenantId, tx => tx.outbox.findMany({ where: { failedAt: { not: null } }, orderBy: { failedAt: 'desc' }, take: 50 }));
  }
  async replay(actor: Actor, eventId: string): Promise<unknown> {
    if (actor.role !== 'admin') throw new ForbiddenException('需要企业管理员权限');
    z.string().uuid().parse(eventId);
    return this.db.tenant(actor.tenantId, tx => tx.outbox.updateMany({ where: { eventId, failedAt: { not: null }, processedAt: null }, data: { attempts: 0, failedAt: null, availableAt: new Date(), lastError: null } }));
  }
}
