import { useState } from 'react';
import {
  Alert,
  App as AntApp,
  Avatar,
  Button,
  Empty,
  Form,
  Modal,
  Select,
  Switch,
  Table,
  Tag,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { roles, scopes } from '../../../packages/contracts/src/index.js';
import { api, mutate, tenantPath } from './api.js';
import { formatDate, Icon, PageTitle, roleLabels } from './components.js';
import { useApp } from './shell.js';
import type { Directory } from './types.js';
const scopeLabels = {
  SELF: '本人及参与事项',
  DEPARTMENT: '本部门',
  DEPARTMENT_TREE: '本部门及下级部门',
  TENANT: '全企业',
};
export function OrganizationPage() {
  const { tenant } = useApp();
  const { message } = AntApp.useApp();
  const client = useQueryClient();
  const [selected, setSelected] = useState<string>();
  const [form] = Form.useForm();
  const query = useQuery({
    queryKey: ['directory', tenant.id],
    queryFn: () => api<Directory>(tenantPath(tenant.id, '/directory')),
    enabled: tenant.role === 'admin',
  });
  const edit = useMutation({
    mutationFn: (values: unknown) =>
      mutate(tenantPath(tenant.id, `/members/${selected}`), values, 'PATCH'),
    onSuccess: () => {
      message.success('成员权限已更新');
      setSelected(undefined);
      void client.invalidateQueries({ queryKey: ['directory'] });
      void client.invalidateQueries({ queryKey: ['session'] });
    },
    onError: (error) => message.error(error.message),
  });
  if (tenant.role !== 'admin') return <Alert type="warning" message="仅企业管理员可管理组织权限" />;
  const rows = query.data?.members.map((member) => ({
    ...member,
    ...query.data?.memberships.find((m) => m.userId === member.userId),
  }));
  return (
    <>
      <PageTitle
        eyebrow="MANAGEMENT / ORGANIZATION"
        title="组织与权限"
        description="为团队成员配置适当的角色与数据访问范围。"
      />
      <div className="department-cards">
        {query.data?.departments.map((department) => (
          <div className="panel department-card" key={department.id}>
            <Icon name="users" />
            <div>
              <strong>{department.name}</strong>
              <span>
                {
                  query.data.members.filter((m) => m.departmentId === department.id && m.active)
                    .length
                }{' '}
                位有效成员
              </span>
            </div>
            <Tag>{department.parentId ? '下级部门' : '一级部门'}</Tag>
          </div>
        ))}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>企业成员</h3>
            <p>角色决定操作能力，数据范围决定可见事项</p>
          </div>
        </div>
        {query.error && <Alert message={query.error.message} type="error" />}
        <Table
          rowKey="userId"
          loading={query.isPending}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 850 }}
          columns={[
            {
              title: '成员',
              dataIndex: 'name',
              render: (name: string) => (
                <div className="member-cell">
                  <Avatar style={{ background: '#eaf0ff', color: '#3868fa' }}>
                    {name.slice(-2)}
                  </Avatar>
                  <strong>{name}</strong>
                </div>
              ),
            },
            {
              title: '部门',
              dataIndex: 'departmentId',
              render: (id: string) => query.data?.departments.find((d) => d.id === id)?.name,
            },
            {
              title: '角色',
              dataIndex: 'role',
              render: (role: keyof typeof roleLabels) => roleLabels[role],
            },
            {
              title: '数据范围',
              dataIndex: 'scope',
              render: (scope: keyof typeof scopeLabels) => scopeLabels[scope],
            },
            {
              title: '状态',
              dataIndex: 'active',
              render: (active: boolean) => (
                <Tag color={active ? 'green' : 'default'}>{active ? '有效' : '停用'}</Tag>
              ),
            },
            {
              title: '',
              render: (_: unknown, row) => (
                <Button
                  type="link"
                  onClick={() => {
                    setSelected(row.userId);
                    form.setFieldsValue({
                      role: row.role,
                      scope: row.scope,
                      departmentId: row.departmentId,
                      active: row.active,
                    });
                  }}
                >
                  编辑权限
                </Button>
              ),
            },
          ]}
        />
      </section>
      <Modal
        forceRender
        open={!!selected}
        title="编辑成员权限"
        onCancel={() => setSelected(undefined)}
        onOk={() => form.submit()}
        confirmLoading={edit.isPending}
        okText="保存权限"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" onFinish={(values) => edit.mutate(values)}>
          <Form.Item name="departmentId" label="所属部门" rules={[{ required: true }]}>
            <Select
              options={query.data?.departments.map((d) => ({ value: d.id, label: d.name }))}
            />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select options={roles.map((value) => ({ value, label: roleLabels[value] }))} />
          </Form.Item>
          <Form.Item name="scope" label="数据范围" rules={[{ required: true }]}>
            <Select options={scopes.map((value) => ({ value, label: scopeLabels[value] }))} />
          </Form.Item>
          <Form.Item name="active" label="成员有效" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
        <Alert
          type="info"
          message="管理员身份不直接赋予审批权。审批仍需拥有对应待办，且不能审批本人申请。"
        />
      </Modal>
    </>
  );
}
interface Notification {
  id: string;
  title: string;
  instanceId: string;
  readAt: string | null;
  createdAt: string;
}
export function NotificationsPage() {
  const { tenant } = useApp();
  const client = useQueryClient();
  const { message } = AntApp.useApp();
  const query = useQuery({
    queryKey: ['notifications', tenant.id],
    queryFn: () => api<Notification[]>(tenantPath(tenant.id, '/notifications')),
    refetchInterval: 10000,
  });
  const read = async (id: string) => {
    try {
      await mutate(tenantPath(tenant.id, `/notifications/${id}/read`), {});
      void client.invalidateQueries({ queryKey: ['notifications'] });
    } catch (error) {
      message.error((error as Error).message);
    }
  };
  return (
    <>
      <PageTitle
        eyebrow="WORKSPACE / NOTIFICATIONS"
        title="站内通知"
        description="与我相关的审批、办理和超时提醒。"
      />
      <section className="panel notification-panel">
        {query.error && <Alert type="error" message={query.error.message} />}
        <Table
          rowKey="id"
          loading={query.isPending}
          dataSource={query.data}
          pagination={{ pageSize: 15 }}
          locale={{ emptyText: <Empty description="暂时没有新通知" /> }}
          columns={[
            {
              title: '通知事项',
              dataIndex: 'title',
              render: (title: string, row: Notification) => (
                <Link
                  to={`/instances/${row.instanceId}`}
                  className="notification-title"
                  onClick={() => {
                    void read(row.id);
                  }}
                >
                  <Icon name="bell" />
                  {title}
                  <Tag color={row.readAt ? 'default' : 'blue'}>{row.readAt ? '已读' : '未读'}</Tag>
                </Link>
              ),
            },
            { title: '收到时间', dataIndex: 'createdAt', render: formatDate, width: 170 },
            {
              title: '',
              width: 100,
              render: (_: unknown, row: Notification) =>
                !row.readAt && (
                  <Button
                    type="link"
                    onClick={() => {
                      void read(row.id);
                    }}
                  >
                    标记已读
                  </Button>
                ),
            },
          ]}
        />
      </section>
    </>
  );
}
interface FailedEvent {
  eventId: string;
  attempts: number;
  lastError: string;
  failedAt: string;
}
interface ManagementLog {
  id: string;
  actorId: string;
  action: string;
  subjectId: string;
  payload: unknown;
  occurredAt: string;
}
const auditLabels: Record<string, string> = {
  'workflow.draft_saved': '保存流程草稿',
  'workflow.published': '发布流程版本',
  'membership.updated': '变更成员权限',
  'outbox.replayed': '重投失败事件',
};
export function OperationsPage() {
  const { tenant } = useApp();
  const { message } = AntApp.useApp();
  const client = useQueryClient();
  const audit = useQuery({
    queryKey: ['management-audit', tenant.id],
    queryFn: () => api<ManagementLog[]>(tenantPath(tenant.id, '/audit')),
    enabled: tenant.role === 'admin',
    refetchInterval: 10000,
  });
  const directory = useQuery({
    queryKey: ['directory', tenant.id],
    queryFn: () => api<Directory>(tenantPath(tenant.id, '/directory')),
    enabled: tenant.role === 'admin',
  });
  const query = useQuery({
    queryKey: ['outbox', tenant.id],
    queryFn: () => api<FailedEvent[]>(tenantPath(tenant.id, '/outbox/failures')),
    enabled: tenant.role === 'admin',
    refetchInterval: 10000,
  });
  const replay = useMutation({
    mutationFn: (id: string) => mutate(tenantPath(tenant.id, `/outbox/${id}/replay`), {}),
    onSuccess: () => {
      message.success('事件已重新进入投递队列');
      void client.invalidateQueries({ queryKey: ['outbox'] });
    },
    onError: (error) => message.error(error.message),
  });
  if (tenant.role !== 'admin') return <Alert type="warning" message="仅企业管理员可管理事件投递" />;
  return (
    <>
      <PageTitle
        eyebrow="MANAGEMENT / DELIVERY"
        title="事件投递"
        description="查看通知和审计投影的失败事件，并在排查后重新投递。"
      />
      <div className="notice-card">
        <Icon name="check" />
        <div>
          <strong>业务结果已持久化</strong>
          <p>通知投递失败不会撤销已完成的审批。事件会自动重试，连续失败五次后进入此列表。</p>
        </div>
      </div>
      <section className="panel">
        {query.error && <Alert type="error" message={query.error.message} />}
        <Table
          rowKey="eventId"
          loading={query.isPending}
          dataSource={query.data}
          locale={{ emptyText: <Empty description="没有需要处理的失败事件" /> }}
          pagination={false}
          columns={[
            { title: '事件 ID', dataIndex: 'eventId', render: (id: string) => <code>{id}</code> },
            { title: '尝试次数', dataIndex: 'attempts', width: 100 },
            { title: '失败原因', dataIndex: 'lastError', ellipsis: true },
            { title: '失败时间', dataIndex: 'failedAt', render: formatDate, width: 150 },
            {
              title: '',
              width: 100,
              render: (_: unknown, row: FailedEvent) => (
                <Button
                  type="link"
                  loading={replay.isPending}
                  onClick={() => replay.mutate(row.eventId)}
                >
                  重新投递
                </Button>
              ),
            },
          ]}
        />
      </section>
      <section className="panel" style={{ marginTop: 24 }}>
        <div className="panel-heading">
          <div>
            <h3>管理审计</h3>
            <p>最近 100 条记录 · 与业务变更在同一事务写入 · 不可修改</p>
          </div>
        </div>
        {audit.error && <Alert type="error" message={audit.error.message} />}
        <Table<ManagementLog>
          rowKey="id"
          loading={audit.isPending}
          dataSource={audit.data}
          scroll={{ x: 750 }}
          pagination={{ pageSize: 10 }}
          expandable={{
            expandedRowRender: (row) => (
              <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {JSON.stringify(row.payload, null, 2)}
              </pre>
            ),
          }}
          columns={[
            {
              title: '操作',
              dataIndex: 'action',
              render: (action: string) => auditLabels[action] ?? action,
            },
            {
              title: '操作人',
              dataIndex: 'actorId',
              render: (id: string) =>
                directory.data?.members.find((m) => m.userId === id)?.name ?? id,
            },
            { title: '对象 ID', dataIndex: 'subjectId', ellipsis: true },
            { title: '时间', dataIndex: 'occurredAt', render: formatDate, width: 170 },
          ]}
        />
      </section>
    </>
  );
}
