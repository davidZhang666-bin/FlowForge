import { useEffect, useState } from 'react';
import { Alert, App as AntApp, Avatar, Button, Form, Input, Select, Spin, Tooltip } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Link,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useOutletContext,
} from 'react-router-dom';
import { api, mutate } from './api.js';
import { Brand, Icon, roleLabels } from './components.js';
import type { AppContext, Session } from './types.js';
import { Dashboard } from './dashboard.js';
import { RequestList, NewRequest } from './requests.js';
import { InstancePage } from './instance.js';
import { WorkflowList, WorkflowEditor } from './designer.js';
import { NotificationsPage, OperationsPage, OrganizationPage } from './management.js';

export const useApp = () => useOutletContext<AppContext>();
const navigation = [
  { to: '/', name: '工作台', icon: 'grid', end: true },
  { to: '/requests', name: '我的申请', icon: 'file' },
  { to: '/approvals', name: '待我审批', icon: 'check' },
  { to: '/tickets', name: '工单中心', icon: 'tool' },
  { to: '/escalations', name: '审批升级', icon: 'clock' },
];
function Login({ onLogin }: { onLogin: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form] = Form.useForm();
  const submit = async (values: { email: string; password: string }) => {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ csrfToken: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      sessionStorage.setItem('ff_csrf', result.csrfToken);
      await onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-page">
      <div className="login-story">
        <Brand />
        <div className="login-copy">
          <div className="eyebrow">WORK, IN FLOW.</div>
          <h1>
            连接每一个决策，
            <br />
            推进每一件工作。
          </h1>
          <p>
            从申请到审批，从故障到解决。
            <br />
            用清晰的流程，连接团队的下一步。
          </p>
          <div className="login-visual">
            <div className="mini-flow-node">
              <Icon name="file" />
              提交申请<span>已完成</span>
            </div>
            <div className="mini-flow-line" />
            <div className="mini-flow-node current">
              <Icon name="users" />
              团队审批<span>进行中</span>
            </div>
            <div className="mini-flow-line" />
            <div className="mini-flow-node">
              <Icon name="check" />
              完成归档<span>下一步</span>
            </div>
          </div>
        </div>
        <div className="login-footer">FLOWFORGE / A CLEARER WAY TO WORK</div>
      </div>
      <div className="login-form">
        <div className="login-form-inner">
          <span className="welcome-label">欢迎回来</span>
          <h2>登录你的工作空间</h2>
          <p>让工作从这里开始流动。</p>
          {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 20 }} />}
          <Form
            form={form}
            layout="vertical"
            onFinish={(values) => {
              void submit(values);
            }}
            initialValues={{ email: 'admin@flowforge.demo' }}
          >
            <Form.Item
              name="email"
              label="工作邮箱"
              rules={[{ required: true, type: 'email', message: '请输入有效邮箱' }]}
            >
              <Input size="large" autoComplete="username" placeholder="name@company.com" />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                size="large"
                autoComplete="current-password"
                placeholder="输入登录密码"
              />
            </Form.Item>
            <Button size="large" type="primary" htmlType="submit" loading={busy} block>
              登录工作空间 <Icon name="arrow" size={17} />
            </Button>
          </Form>
          {import.meta.env.DEV && (
            <div className="demo-login">
              <span>选择演示角色</span>
              <div>
                {[
                  ['admin', '管理员'],
                  ['employee', '申请人'],
                  ['manager', '负责人'],
                  ['finance1', '财务 A'],
                  ['finance2', '财务 B'],
                  ['agent', '工程师'],
                ].map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    onClick={() =>
                      form.setFieldsValue({
                        email: `${key}@flowforge.demo`,
                        password: 'FlowForge2026!',
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <small>仅供合成数据演示 · 密码 FlowForge2026!</small>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function Layout({ context }: { context: AppContext }) {
  const location = useLocation();
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <Link to="/" className="brand-link">
          <Brand />
        </Link>
        <div className="workspace-label">
          WORKSPACE<span>工作空间</span>
        </div>
        <nav aria-label="主导航">
          {navigation.map((item) => (
            <Tooltip title={item.name} placement="right" key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
              >
                <Icon name={item.icon} />
                <span>{item.name}</span>
              </NavLink>
            </Tooltip>
          ))}
          {context.tenant.role === 'admin' && (
            <>
              <div className="nav-group-label">管理空间</div>
              {[
                { to: '/workflows', name: '流程设计', icon: 'flow' },
                { to: '/organization', name: '组织与权限', icon: 'users' },
                { to: '/operations', name: '事件投递', icon: 'clock' },
              ].map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
                >
                  <Icon name={item.icon} />
                  <span>{item.name}</span>
                </NavLink>
              ))}
            </>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-health">
            <span className="live-dot" />
            <span>协作，让工作有序发生</span>
          </div>
          <div className="user-card">
            <Avatar style={{ background: '#e5ecff', color: '#3868fa' }}>
              {context.session.user.name.slice(-2)}
            </Avatar>
            <div>
              <strong>{context.session.user.name}</strong>
              <small>{roleLabels[context.tenant.role]}</small>
            </div>
            <Button
              type="text"
              title="退出登录"
              aria-label="退出登录"
              icon={<Icon name="logout" size={17} />}
              onClick={() => {
                void context.logout();
              }}
            />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-label">
            工作空间 <span>/</span>{' '}
            {navigation.find((n) => n.to === location.pathname)?.name ??
              (location.pathname.includes('workflow')
                ? '流程设计'
                : location.pathname.includes('instance')
                  ? '申请详情'
                  : '团队协作')}
          </div>
          <div className="topbar-actions">
            <Select
              aria-label="切换企业"
              variant="borderless"
              value={context.tenant.id}
              onChange={context.setTenant}
              options={context.session.tenants.map((t) => ({ label: t.name, value: t.id }))}
            />
            <span className="topbar-separator" />
            <Link to="/notifications" aria-label="站内通知" className="notification-link">
              <Icon name="bell" />
            </Link>
            <Link to="/new">
              <Button type="primary" icon={<Icon name="plus" size={16} />}>
                发起申请
              </Button>
            </Link>
          </div>
        </header>
        <main className="main-content">
          <Outlet context={context} />
        </main>
        <footer className="app-footer">
          <span>FlowForge · 让协作自然发生</span>
          <span>流程清晰，工作有序。</span>
        </footer>
      </div>
    </div>
  );
}
export function App() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const [tenantId, setTenantId] = useState(localStorage.getItem('ff_tenant') ?? '');
  const sessionQuery = useQuery({
    queryKey: ['session'],
    queryFn: () => api<Session>('/session'),
    retry: false,
  });
  useEffect(() => {
    const handle = () => client.setQueryData(['session'], null);
    window.addEventListener('ff:unauthorized', handle);
    return () => window.removeEventListener('ff:unauthorized', handle);
  }, [client]);
  const session = sessionQuery.data;
  const tenant = session?.tenants.find((t) => t.id === tenantId) ?? session?.tenants[0];
  if (sessionQuery.isPending)
    return (
      <div className="full-loader">
        <Spin size="large" />
        <span>正在连接工作空间…</span>
      </div>
    );
  if (!session)
    return (
      <Login
        onLogin={async () => {
          client.clear();
          await client.fetchQuery({
            queryKey: ['session'],
            queryFn: () => api<Session>('/session'),
          });
          navigate('/');
        }}
      />
    );
  const logout = async () => {
    try {
      await mutate('/auth/logout', {});
    } catch (error) {
      message.error((error as Error).message);
      return;
    }
    sessionStorage.removeItem('ff_csrf');
    client.clear();
    client.setQueryData(['session'], null);
    navigate('/');
  };
  if (!tenant)
    return (
      <Alert
        type="warning"
        message="当前账号没有有效企业成员身份"
        action={
          <Button
            onClick={() => {
              void logout();
            }}
          >
            退出登录
          </Button>
        }
      />
    );
  const context: AppContext = {
    session,
    tenant,
    actor: {
      userId: session.user.id,
      tenantId: tenant.id,
      departmentId: tenant.departmentId,
      role: tenant.role,
      scope: tenant.scope,
      name: session.user.name,
    },
    setTenant: (id) => {
      setTenantId(id);
      localStorage.setItem('ff_tenant', id);
      navigate('/');
    },
    logout,
  };
  return (
    <Routes>
      <Route element={<Layout context={context} />}>
        <Route index element={<Dashboard />} />
        <Route path="requests" element={<RequestList view="mine" />} />
        <Route path="approvals" element={<RequestList view="pending" />} />
        <Route path="tickets" element={<RequestList view="tickets" />} />
        <Route path="escalations" element={<RequestList view="escalated" />} />
        <Route path="new" element={<NewRequest />} />
        <Route path="instances/:id" element={<InstancePage />} />
        <Route path="workflows" element={<WorkflowList />} />
        <Route path="workflows/:id" element={<WorkflowEditor />} />
        <Route path="organization" element={<OrganizationPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="operations" element={<OperationsPage />} />
        <Route
          path="*"
          element={<Alert message="页面不存在" action={<Link to="/">返回工作台</Link>} />}
        />
      </Route>
    </Routes>
  );
}
