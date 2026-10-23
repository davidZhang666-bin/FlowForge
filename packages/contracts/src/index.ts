import { z } from 'zod';

export const applicationTypes = ['LEAVE', 'EXPENSE', 'PURCHASE', 'INCIDENT'] as const;
export type ApplicationType = (typeof applicationTypes)[number];
export const roles = ['admin', 'manager', 'approver', 'agent', 'employee'] as const;
export type Role = (typeof roles)[number];
export const scopes = ['SELF', 'DEPARTMENT', 'DEPARTMENT_TREE', 'TENANT'] as const;
export type DataScope = (typeof scopes)[number];
export type Rule =
  | { op: 'all' | 'any'; rules: Rule[] }
  | { op: 'not'; rule: Rule }
  | {
      op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
      field: string;
      value: string | number | boolean | string[];
    };
export const ruleSchema: z.ZodType<Rule> = z.lazy(() =>
  z.union([
    z.object({ op: z.enum(['all', 'any']), rules: z.array(ruleSchema).min(1).max(20) }).strict(),
    z.object({ op: z.literal('not'), rule: ruleSchema }).strict(),
    z
      .object({
        op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in']),
        field: z.string().max(80),
        value: z.union([
          z.string().max(200),
          z.number().finite(),
          z.boolean(),
          z.array(z.string()).max(100),
        ]),
      })
      .strict(),
  ]),
);
export const assigneeSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('users'), userIds: z.array(z.string().uuid()).min(1).max(30) })
    .strict(),
  z.object({ kind: z.literal('role'), role: z.enum(roles) }).strict(),
]);
export type AssigneeSpec = z.infer<typeof assigneeSchema>;
const baseNode = {
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  name: z.string().min(1).max(80),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }),
};
export const nodeSchema = z.discriminatedUnion('kind', [
  z.object({ ...baseNode, kind: z.literal('start') }).strict(),
  z.object({ ...baseNode, kind: z.literal('end') }).strict(),
  z.object({ ...baseNode, kind: z.literal('condition') }).strict(),
  z
    .object({
      ...baseNode,
      kind: z.literal('approval'),
      strategy: z.enum(['ALL', 'ANY']),
      assignees: assigneeSchema,
      slaMinutes: z.number().int().min(1).max(43200),
    })
    .strict(),
  z
    .object({
      ...baseNode,
      kind: z.literal('handling'),
      assignees: assigneeSchema,
      slaMinutes: z.number().int().min(1).max(43200),
    })
    .strict(),
]);
export type FlowNode = z.infer<typeof nodeSchema>;
export const flowSchema = z
  .object({
    schemaVersion: z.literal(1),
    nodes: z.array(nodeSchema).min(2).max(100),
    edges: z
      .array(
        z
          .object({
            id: z.string().min(1).max(80),
            source: z.string(),
            target: z.string(),
            label: z.string().max(100),
            condition: ruleSchema.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();
export type FlowGraph = z.infer<typeof flowSchema>;
export const requestSchema = z
  .object({
    title: z.string().trim().min(2).max(120),
    type: z.enum(applicationTypes),
    description: z.string().trim().max(4000).default(''),
    amountCents: z.number().int().nonnegative().max(1_000_000_000).default(0),
    leaveMinutes: z.number().int().nonnegative().max(525600).default(0),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.type === 'LEAVE' && data.leaveMinutes === 0)
      ctx.addIssue({ code: 'custom', path: ['leaveMinutes'], message: '请假时长必须大于零' });
    if (['EXPENSE', 'PURCHASE'].includes(data.type) && data.amountCents === 0)
      ctx.addIssue({ code: 'custom', path: ['amountCents'], message: '金额必须大于零' });
  });
export type RequestData = z.infer<typeof requestSchema>;
export const revisionSchema = z.number().int().nonnegative();
export const commandSchema = z
  .object({
    expectedRevision: revisionSchema,
    action: z.enum([
      'approve',
      'reject',
      'return',
      'withdraw',
      'transfer',
      'resubmit',
      'claim',
      'start',
      'resolve',
      'accept',
      'reopen',
      'assign',
    ]),
    taskId: z.string().optional(),
    targetUserId: z.string().uuid().optional(),
    comment: z.string().trim().max(2000).default(''),
    data: requestSchema.optional(),
  })
  .strict();
export type InstanceCommand = z.infer<typeof commandSchema>;
export interface Actor {
  userId: string;
  tenantId: string;
  departmentId: string;
  role: Role;
  scope: DataScope;
  name: string;
}
export interface Member {
  userId: string;
  departmentId: string;
  role: Role;
  name: string;
  active: boolean;
}
export const typeLabels: Record<ApplicationType, string> = {
  LEAVE: '请假',
  EXPENSE: '报销',
  PURCHASE: '采购',
  INCIDENT: '故障处理',
};
export const statusLabels: Record<string, string> = {
  RUNNING: '进行中',
  RETURNED: '待修改',
  BLOCKED: '异常待处理',
  COMPLETED: '已完成',
  REJECTED: '已拒绝',
  WITHDRAWN: '已撤回',
  PENDING: '待审批',
  APPROVED: '已同意',
  CANCELLED: '已取消',
  ASSIGNED: '待认领',
  IN_PROGRESS: '处理中',
  RESOLVED: '待验收',
  CLOSED: '已验收',
};
