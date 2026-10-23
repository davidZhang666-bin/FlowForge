import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { Database, json, type Transaction } from '../../../packages/data/src/index.js';
import { saveTransition } from '../../../packages/data/src/transitions.js';
import { canonical, digest } from '../../../packages/data/src/security.js';
import { commandSchema, flowSchema, requestSchema, type Actor, type Member } from '../../../packages/contracts/src/index.js';
import { executeCommand, startProcess, type ProcessState } from '../../../packages/core/src/index.js';
import { instanceScope } from './access.js';

export async function tenantMembers(tx: Transaction): Promise<Member[]> {
  const memberships = await tx.membership.findMany();
  const users = await tx.user.findMany({ where: { id: { in: memberships.map(m => m.userId) } }, select: { id: true, name: true, active: true } });
  return memberships.map(m => ({ userId: m.userId, departmentId: m.departmentId, role: m.role as Member['role'], name: users.find(u => u.id === m.userId)?.name ?? '未知成员', active: m.active && !!users.find(u => u.id === m.userId)?.active }));
}
@Injectable()
export class ProcessService {
  constructor(private readonly db: Database) {}
  private async idempotent<T>(actor: Actor, key: string | undefined, input: unknown, operation: (tx: Transaction) => Promise<T>): Promise<T> {
    z.string().min(8).max(120).regex(/^[a-zA-Z0-9:_-]+$/).parse(key);
    const requestHash = digest(canonical(input));
    return this.db.tenant(actor.tenantId, async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${actor.tenantId}:${actor.userId}:${key!}`}, 0))`;
      const identity = { tenantId: actor.tenantId, actorId: actor.userId, key: key! };
      const existing = await tx.idempotencyRecord.findUnique({ where: { tenantId_actorId_key: identity } });
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ConflictException('幂等键已用于其他请求');
        return existing.response as T;
      }
      const result = await operation(tx);
      await tx.idempotencyRecord.create({ data: { ...identity, requestHash, response: json(result) } }); return result;
    });
  }
  async submit(actor: Actor, input: unknown, key: string | undefined): Promise<unknown> {
    const parsed = z.object({ data: requestSchema, linkedFrom: z.string().uuid().optional() }).strict().parse(input);
    return this.idempotent(actor, key, { command: 'submit', ...parsed }, async tx => {
      if (parsed.linkedFrom) await this.visible(tx, actor, parsed.linkedFrom);
      const definition = await tx.flowDefinition.findUnique({ where: { tenantId_type: { tenantId: actor.tenantId, type: parsed.data.type } } });
      if (!definition?.latestVersion) throw new ConflictException('该申请类型尚未发布流程');
      const version = await tx.flowVersion.findUniqueOrThrow({ where: { tenantId_definitionId_number: { tenantId: actor.tenantId, definitionId: definition.id, number: definition.latestVersion } } });
      const transition = startProcess(randomUUID(), version.id, flowSchema.parse(version.graph), parsed.data, actor, { now: new Date().toISOString(), id: randomUUID, members: await tenantMembers(tx) });
      const state = transition.state;
      await tx.processInstance.create({ data: { id: state.id, tenantId: actor.tenantId, versionId: state.versionId, applicantId: actor.userId, departmentId: state.departmentId, title: state.data.title, type: state.data.type, status: state.status, revision: state.revision, state: json(state), linkedFrom: parsed.linkedFrom } });
      await saveTransition(tx, actor.tenantId, transition); return { id: state.id, revision: state.revision };
    });
  }
  private async visible(tx: Transaction, actor: Actor, id: string) {
    const instance = await tx.processInstance.findFirst({ where: { AND: [{ id }, await instanceScope(tx, actor)] } });
    if (!instance) throw new NotFoundException('申请不存在或无权访问'); return instance;
  }
  async command(actor: Actor, id: string, input: unknown, key: string | undefined): Promise<unknown> {
    z.string().uuid().parse(id); const command = commandSchema.parse(input);
    return this.idempotent(actor, key, { command: 'transition', id, ...command }, async tx => {
      const instance = await this.visible(tx, actor, id);
      const version = await tx.flowVersion.findUniqueOrThrow({ where: { id: instance.versionId } });
      const transition = executeCommand(instance.state as unknown as ProcessState, flowSchema.parse(version.graph), command, actor, { now: new Date().toISOString(), id: randomUUID, members: await tenantMembers(tx) });
      const updated = await tx.processInstance.updateMany({ where: { id, revision: command.expectedRevision }, data: { state: json(transition.state), revision: transition.state.revision, status: transition.state.status, title: transition.state.data.title } });
      if (!updated.count) throw new ConflictException('申请已被其他人处理，请刷新');
      await saveTransition(tx, actor.tenantId, transition); return { id, revision: transition.state.revision };
    });
  }
  async list(actor: Actor, input: unknown): Promise<unknown> {
    const query = z.object({ view: z.enum(['all', 'mine', 'pending', 'tickets', 'escalated']).default('all'), status: z.string().max(30).optional(), search: z.string().max(120).optional(), page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(input);
    return this.db.tenant(actor.tenantId, async tx => {
      const conditions: Prisma.ProcessInstanceWhereInput[] = [await instanceScope(tx, actor)];
      if (query.view === 'mine') conditions.push({ applicantId: actor.userId });
      if (query.status) conditions.push({ status: query.status });
      if (query.search) conditions.push({ title: { contains: query.search, mode: 'insensitive' } });
      if (query.view === 'tickets') conditions.push({ type: 'INCIDENT' });
      if (query.view === 'pending' || query.view === 'escalated') {
        const tasks = await tx.taskIndex.findMany({ where: query.view === 'pending' ? { kind: 'approval', assigneeId: actor.userId, status: 'PENDING' } : { escalated: true, status: { in: ['PENDING', 'ASSIGNED', 'IN_PROGRESS'] } }, select: { instanceId: true } });
        conditions.push({ id: { in: tasks.map(t => t.instanceId) } });
      }
      const where = { AND: conditions };
      const [items, total] = await Promise.all([tx.processInstance.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }), tx.processInstance.count({ where })]);
      const versions = await tx.flowVersion.findMany({ where: { id: { in: items.map(i => i.versionId) } }, select: { id: true, number: true } });
      return { items: items.map(item => ({ ...item, versionNumber: versions.find(v => v.id === item.versionId)?.number })), total, page: query.page, limit: query.limit };
    });
  }
  async detail(actor: Actor, id: string): Promise<unknown> {
    z.string().uuid().parse(id);
    return this.db.tenant(actor.tenantId, async tx => {
      const instance = await this.visible(tx, actor, id);
      const version = await tx.flowVersion.findUniqueOrThrow({ where: { id: instance.versionId } });
      return { ...instance, version, events: await tx.domainEvent.findMany({ where: { instanceId: id }, orderBy: { sequence: 'asc' } }), members: await tenantMembers(tx) };
    });
  }
  async events(actor: Actor, id: string, after: number): Promise<unknown[]> {
    return this.db.tenant(actor.tenantId, async tx => { await this.visible(tx, actor, id); return tx.domainEvent.findMany({ where: { instanceId: id, sequence: { gt: after } }, orderBy: { sequence: 'asc' }, take: 200 }); });
  }
  async dashboard(actor: Actor): Promise<unknown> {
    return this.db.tenant(actor.tenantId, async tx => {
      const where = await instanceScope(tx, actor);
      const groups = await tx.processInstance.groupBy({ by: ['status'], where, _count: true });
      const pending = await tx.taskIndex.count({ where: { kind: 'approval', assigneeId: actor.userId, status: 'PENDING' } });
      const recent = await tx.processInstance.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 6 });
      const audit = await tx.domainEvent.count({ where: { instanceId: { in: (await tx.processInstance.findMany({ where, select: { id: true } })).map(i => i.id) } } });
      return { groups, pending, recent, eventCount: audit };
    });
  }
}
