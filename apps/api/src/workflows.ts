import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { z } from 'zod';
import { Database, json } from '../../../packages/data/src/index.js';
import { flowSchema, type Actor } from '../../../packages/contracts/src/index.js';
import { validateGraph } from '../../../packages/core/src/index.js';

@Injectable()
export class WorkflowService {
  constructor(@Inject(Database) private readonly db: Database) {}
  private admin(actor: Actor): void {
    if (actor.role !== 'admin') throw new ForbiddenException('只有企业管理员可以配置流程');
  }
  async list(actor: Actor): Promise<unknown> {
    return this.db.tenant(actor.tenantId, async (tx) => {
      const rows = await tx.flowDefinition.findMany({ orderBy: { type: 'asc' } });
      return actor.role === 'admin'
        ? rows
        : rows.map(({ id, name, type, latestVersion, revision }) => ({
            id,
            name,
            type,
            latestVersion,
            revision,
          }));
    });
  }
  async detail(actor: Actor, id: string): Promise<unknown> {
    this.admin(actor);
    z.string().uuid().parse(id);
    return this.db.tenant(actor.tenantId, async (tx) => {
      const definition = await tx.flowDefinition.findUnique({ where: { id } });
      if (!definition) throw new NotFoundException('流程不存在');
      return {
        ...definition,
        versions: await tx.flowVersion.findMany({
          where: { definitionId: id },
          orderBy: { number: 'desc' },
        }),
      };
    });
  }
  async save(actor: Actor, id: string, input: unknown): Promise<unknown> {
    this.admin(actor);
    z.string().uuid().parse(id);
    const { graph, expectedRevision } = z
      .object({ graph: flowSchema, expectedRevision: z.number().int().nonnegative() })
      .strict()
      .parse(input);
    return this.db.tenant(actor.tenantId, async (tx) => {
      const updated = await tx.flowDefinition.updateMany({
        where: { id, revision: expectedRevision },
        data: { draft: json(graph), revision: { increment: 1 } },
      });
      if (!updated.count) throw new ConflictException('草稿已更新或不存在，请刷新后重试');
      return tx.flowDefinition.findUniqueOrThrow({ where: { id } });
    });
  }
  async publish(actor: Actor, id: string, input: unknown): Promise<unknown> {
    this.admin(actor);
    z.string().uuid().parse(id);
    const { expectedRevision } = z
      .object({ expectedRevision: z.number().int().nonnegative() })
      .strict()
      .parse(input);
    return this.db.tenant(actor.tenantId, async (tx) => {
      const definition = await tx.flowDefinition.findUnique({ where: { id } });
      if (!definition) throw new NotFoundException('流程不存在');
      if (definition.revision !== expectedRevision)
        throw new ConflictException('草稿已更新，请刷新后重试');
      const errors = validateGraph(definition.draft);
      if (errors.length) throw new UnprocessableEntityException(errors);
      const graph = flowSchema.parse(definition.draft);
      const staticIds = graph.nodes.flatMap((n) =>
        (n.kind === 'approval' || n.kind === 'handling') && n.assignees.kind === 'users'
          ? n.assignees.userIds
          : [],
      );
      const members = await tx.membership.findMany({
        where: { userId: { in: staticIds }, active: true },
      });
      if (staticIds.some((userId) => !members.some((m) => m.userId === userId)))
        throw new UnprocessableEntityException('流程包含不属于本企业或已停用的人员');
      const updated = await tx.flowDefinition.updateMany({
        where: { id, revision: expectedRevision },
        data: { latestVersion: { increment: 1 }, revision: { increment: 1 } },
      });
      if (!updated.count) throw new ConflictException('流程已被其他管理员发布');
      return tx.flowVersion.create({
        data: {
          tenantId: actor.tenantId,
          definitionId: id,
          number: definition.latestVersion + 1,
          graph: json(graph),
          publishedBy: actor.userId,
        },
      });
    });
  }
}
