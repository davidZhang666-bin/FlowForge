import { z } from 'zod';
import { commandSchema, flowSchema, requestSchema } from './index.js';

function schema(name: string, value: z.ZodType): Record<string, unknown> {
  const result = z.toJSONSchema(value, { io: 'input' });
  // JSON Schema self-references must resolve inside this OpenAPI component.
  return JSON.parse(
    JSON.stringify(result).replace(
      /"\$ref":"#([^"]*)"/g,
      `"$ref":"#/components/schemas/${name}$1"`,
    ),
  ) as Record<string, unknown>;
}
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonBody = (value: unknown) => ({
  required: true,
  content: { 'application/json': { schema: value } },
});
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const uuid = { type: 'string', format: 'uuid' };
const revision = { type: 'integer', minimum: 0 };
const resources: {
  path: string;
  method: 'get' | 'post' | 'patch';
  summary: string;
  body?: unknown;
  response?: unknown;
  idempotent?: boolean;
  public?: boolean;
}[] = [
  {
    path: '/auth/login',
    method: 'post',
    summary: '登录并创建八小时会话',
    public: true,
    body: object({
      email: { type: 'string', format: 'email' },
      password: { type: 'string', maxLength: 200 },
    }),
    response: object({ csrfToken: { type: 'string' } }),
  },
  { path: '/auth/logout', method: 'post', summary: '注销当前会话' },
  { path: '/session', method: 'get', summary: '读取当前用户及有效企业成员身份' },
  { path: '/openapi.json', method: 'get', summary: '读取接口规范', public: true },
  ...['dashboard', 'directory', 'notifications', 'outbox/failures'].map((resource) => ({
    path: `/tenants/{tenantId}/${resource}`,
    method: 'get' as const,
    summary: `查询 ${resource}`,
  })),
  {
    path: '/tenants/{tenantId}/members/{userId}',
    method: 'patch',
    summary: '更新成员角色与数据范围',
    body: object({
      role: { enum: ['admin', 'manager', 'approver', 'agent', 'employee'] },
      scope: { enum: ['SELF', 'DEPARTMENT', 'DEPARTMENT_TREE', 'TENANT'] },
      departmentId: uuid,
      active: { type: 'boolean' },
    }),
  },
  { path: '/tenants/{tenantId}/workflows', method: 'get', summary: '列出业务流程' },
  {
    path: '/tenants/{tenantId}/workflows/{id}',
    method: 'get',
    summary: '读取流程草稿与版本历史（管理员）',
  },
  {
    path: '/tenants/{tenantId}/workflows/{id}',
    method: 'patch',
    summary: '保存流程草稿（乐观锁）',
    body: object({ graph: ref('FlowGraph'), expectedRevision: revision }),
  },
  {
    path: '/tenants/{tenantId}/workflows/{id}/publish',
    method: 'post',
    summary: '校验并发布不可变版本',
    body: object({ expectedRevision: revision }),
  },
  { path: '/tenants/{tenantId}/instances', method: 'get', summary: '分页查询授权范围内的申请' },
  {
    path: '/tenants/{tenantId}/instances',
    method: 'post',
    summary: '按最新发布版本提交申请',
    idempotent: true,
    body: object({ data: ref('Application'), linkedFrom: uuid }, ['data']),
    response: ref('CommandResult'),
  },
  {
    path: '/tenants/{tenantId}/instances/{id}',
    method: 'get',
    summary: '读取实例、原版本图与执行事件',
  },
  {
    path: '/tenants/{tenantId}/instances/{id}/commands',
    method: 'post',
    summary: '审批、转交、退回、撤回或办理命令',
    idempotent: true,
    body: ref('InstanceCommand'),
    response: ref('CommandResult'),
  },
  {
    path: '/tenants/{tenantId}/instances/{id}/events',
    method: 'get',
    summary: 'SSE 执行事件流，支持 Last-Event-ID',
  },
  {
    path: '/tenants/{tenantId}/notifications/{id}/read',
    method: 'post',
    summary: '标记本人通知已读',
  },
  {
    path: '/tenants/{tenantId}/outbox/{id}/replay',
    method: 'post',
    summary: '重新投递失败事件（管理员）',
  },
];
export function openApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const resource of resources) {
    const parameters: unknown[] = [...resource.path.matchAll(/\{(\w+)\}/g)].map((match) => ({
      name: match[1],
      in: 'path',
      required: true,
      schema: uuid,
    }));
    if (resource.idempotent)
      parameters.push({
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        schema: { type: 'string', minLength: 8, maxLength: 120 },
      });
    if (resource.method !== 'get' && !resource.public)
      parameters.push({
        name: 'x-csrf-token',
        in: 'header',
        required: true,
        schema: { type: 'string' },
      });
    if (resource.path.endsWith('/events'))
      parameters.push({
        name: 'Last-Event-ID',
        in: 'header',
        schema: { type: 'integer', minimum: 0 },
      });
    if (resource.path.endsWith('/instances') && resource.method === 'get')
      parameters.push(
        ...[
          { name: 'view', schema: { enum: ['all', 'mine', 'pending', 'tickets', 'escalated'] } },
          { name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { name: 'status', schema: { type: 'string' } },
          { name: 'search', schema: { type: 'string', maxLength: 120 } },
        ].map((value) => ({ ...value, in: 'query' })),
      );
    const content = resource.path.endsWith('/events')
      ? {
          'text/event-stream': {
            schema: { type: 'string' },
            example: 'id: 2\ndata: {"sequence":2,"type":"node.entered"}\n\n',
          },
        }
      : { 'application/json': { schema: resource.response ?? { type: 'object' } } };
    const success = resource.method === 'post' ? '201' : '200';
    paths[resource.path] ??= {};
    paths[resource.path]![resource.method] = {
      summary: resource.summary,
      operationId: `${resource.method}_${resource.path.replace(/[^\w]+/g, '_')}`,
      security: resource.public ? [] : [{ cookieAuth: [] }],
      parameters,
      ...(resource.body ? { requestBody: jsonBody(resource.body) } : {}),
      responses: {
        [success]: { description: '成功', content },
        ...Object.fromEntries(
          [400, 401, 403, 404, 409, 422, 429, 500].map((code) => [
            String(code),
            {
              description: {
                400: '输入校验失败',
                401: '未登录或会话过期',
                403: '权限或 CSRF 校验失败',
                404: '资源不存在或无权查看',
                409: '修订号、唯一约束或幂等冲突',
                422: '非法业务转换或发布配置',
                429: '请求频率受限',
                500: '服务异常',
              }[code],
              content: { 'application/json': { schema: ref('Error') } },
            },
          ]),
        ),
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'FlowForge API',
      version: '1.0.0',
      description:
        '租户隔离的审批与工单接口。先登录取得 Cookie 和 csrfToken；所有业务命令使用幂等键及 expectedRevision。',
    },
    servers: [{ url: '/api/v1' }],
    paths,
    components: {
      securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'ff_session' } },
      schemas: {
        Application: schema('Application', requestSchema),
        InstanceCommand: schema('InstanceCommand', commandSchema),
        FlowGraph: schema('FlowGraph', flowSchema),
        CommandResult: object({ id: uuid, revision }),
        Error: object({
          error: object(
            {
              code: { type: 'string' },
              message: {
                oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
              },
              requestId: { type: 'string' },
            },
            ['code', 'message'],
          ),
        }),
      },
    },
  };
}
