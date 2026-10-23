import { Alert, Button, Empty, Progress, Skeleton, Table } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, tenantPath } from './api.js';
import { useApp } from './shell.js';
import { formatDate, Icon, PageTitle, Status, TypeTag } from './components.js';
import type { Instance } from './types.js';
import { typeLabels, type ApplicationType } from '../../../packages/contracts/src/index.js';

export function Dashboard() {
  const { tenant, session } = useApp();
  const { data, error, isPending } = useQuery({
    queryKey: ['dashboard', tenant.id],
    queryFn: () =>
      api<{
        groups: { status: string; _count: number }[];
        pending: number;
        recent: Instance[];
        eventCount: number;
      }>(tenantPath(tenant.id, '/dashboard')),
    refetchInterval: 15000,
  });
  if (isPending) return <Skeleton active paragraph={{ rows: 10 }} />;
  if (error) return <Alert type="error" showIcon message={error.message} />;
  const count = (status: string) => data?.groups.find((g) => g.status === status)?._count ?? 0;
  const total = data?.groups.reduce((sum, group) => sum + group._count, 0) ?? 0;
  return (
    <>
      <PageTitle
        eyebrow="WORKSPACE / OVERVIEW"
        title="工作台"
        description={`${session.user.name}，欢迎回来。这里是你的团队协作概览。`}
        action={
          <span className="today-label">
            {new Intl.DateTimeFormat('zh-CN', {
              month: 'long',
              day: 'numeric',
              weekday: 'long',
              timeZone: 'Asia/Shanghai',
            }).format(new Date())}
          </span>
        }
      />
      <section className="overview-hero">
        <div>
          <span className="hero-kicker">
            <span className="live-dot" /> 工作正在有序流转
          </span>
          <h2>
            每一步进展，
            <br />
            都有清晰的方向。
          </h2>
          <p>跟进申请、处理待办，让团队协作持续向前。</p>
          <Link to="/approvals">
            <Button type="primary">
              查看我的待办 <Icon name="arrow" size={16} />
            </Button>
          </Link>
        </div>
        <div className="hero-flow">
          <div className="hero-flow-card done">
            <span className="flow-card-icon">
              <Icon name="file" />
            </span>
            <div>
              <strong>发起申请</strong>
              <small>一个起点，连接协作</small>
            </div>
            <span className="flow-state">✓</span>
          </div>
          <div className="hero-connector" />
          <div className="hero-flow-card current">
            <span className="flow-card-icon">
              <Icon name="users" />
            </span>
            <div>
              <strong>审批与办理</strong>
              <small>按规则，抵达正确的人</small>
            </div>
            <span className="pulse-dot" />
          </div>
          <div className="hero-connector" />
          <div className="hero-flow-card">
            <span className="flow-card-icon">
              <Icon name="check" />
            </span>
            <div>
              <strong>完成与归档</strong>
              <small>每一步，都有迹可循</small>
            </div>
            <Icon name="arrow" size={16} />
          </div>
        </div>
        <div className="hero-orbit orbit-one" />
        <div className="hero-orbit orbit-two" />
      </section>
      <section className="metric-grid">
        {[
          {
            label: '待我审批',
            value: data?.pending ?? 0,
            icon: 'check',
            color: 'blue',
            note: '需要你关注的审批事项',
            link: '/approvals',
          },
          {
            label: '流转中申请',
            value: count('RUNNING'),
            icon: 'flow',
            color: 'violet',
            note: '当前可见范围内的进行中流程',
            link: '/requests',
          },
          {
            label: '已完成流程',
            value: count('COMPLETED'),
            icon: 'file',
            color: 'green',
            note: '已完成审批或工单验收',
            link: '/requests',
          },
          {
            label: '执行记录',
            value: data?.eventCount ?? 0,
            icon: 'clock',
            color: 'orange',
            note: '已持久化的真实流转事件',
            link: '/requests',
          },
        ].map((item) => (
          <Link key={item.label} to={item.link} className="metric-card">
            <div className="metric-label">
              {item.label}
              <span className={`metric-icon ${item.color}`}>
                <Icon name={item.icon} />
              </span>
            </div>
            <strong>{item.value.toString().padStart(2, '0')}</strong>
            <span className="metric-note">
              {item.note}
              <Icon name="arrow" size={14} />
            </span>
          </Link>
        ))}
      </section>
      <div className="dashboard-columns">
        <section className="panel recent-panel">
          <div className="panel-heading">
            <div>
              <h3>最近流转</h3>
              <p>你有权查看的最新申请与办理事项</p>
            </div>
            <Link to="/requests">
              查看我的申请 <span>↗</span>
            </Link>
          </div>
          <Table
            rowKey="id"
            dataSource={data?.recent}
            pagination={false}
            locale={{ emptyText: <Empty description="还没有申请，从发起第一份申请开始" /> }}
            columns={[
              {
                title: '申请事项',
                dataIndex: 'title',
                render: (title: string, record: Instance) => (
                  <Link to={`/instances/${record.id}`} className="table-title">
                    <span className={`item-symbol symbol-${record.type.toLowerCase()}`}>
                      <Icon name={record.type === 'INCIDENT' ? 'tool' : 'file'} size={17} />
                    </span>
                    <span>
                      {title}
                      <small>
                        {record.id.slice(0, 8).toUpperCase()} · {formatDate(record.updatedAt)}
                      </small>
                    </span>
                  </Link>
                ),
              },
              {
                title: '类型',
                dataIndex: 'type',
                width: 90,
                render: (value: ApplicationType) => <TypeTag type={value} />,
              },
              {
                title: '当前状态',
                dataIndex: 'status',
                width: 115,
                render: (value: string) => <Status value={value} />,
              },
            ]}
          />
        </section>
        <section className="panel distribution-panel">
          <div className="panel-heading">
            <div>
              <h3>流程概况</h3>
              <p>当前数据访问范围</p>
            </div>
            <Icon name="flow" />
          </div>
          <div className="completion-circle">
            <Progress
              type="circle"
              percent={total ? Math.round((count('COMPLETED') / total) * 100) : 0}
              size={148}
              strokeWidth={7}
              strokeColor="#3868fa"
              trailColor="#eef2f8"
              format={(value) => (
                <span className="circle-label">
                  <strong>
                    {value}
                    <small>%</small>
                  </strong>
                  <span>流程完成率</span>
                </span>
              )}
            />
          </div>
          <div className="distribution-legend">
            {[
              ['RUNNING', '进行中', '#3868fa'],
              ['COMPLETED', '已完成', '#2cb895'],
              ['RETURNED', '待修改', '#e8a54c'],
              ['BLOCKED', '异常待处理', '#ed6879'],
            ].map(([status, label, color]) => (
              <div key={status}>
                <span>
                  <i style={{ background: color }} />
                  {label}
                </span>
                <strong>{count(status!)}</strong>
              </div>
            ))}
          </div>
          <div className="scope-note">共 {total} 份申请 · 数据按权限实时汇总</div>
        </section>
      </div>
      <section className="quick-section">
        <div className="quick-heading">
          <h3>快速发起</h3>
          <span>为每一种协作，找到合适的流程</span>
        </div>
        <div className="quick-grid">
          {(['LEAVE', 'EXPENSE', 'PURCHASE', 'INCIDENT'] as const).map((type, index) => (
            <Link key={type} to={`/new?type=${type}`} className="quick-card">
              <span className={`quick-icon quick-${index}`}>
                <Icon name={['clock', 'file', 'grid', 'tool'][index]!} />
              </span>
              <div>
                <strong>{typeLabels[type]}申请</strong>
                <small>
                  {
                    [
                      '安排休假，做好交接',
                      '提交费用，跟进报销',
                      '采购所需，高效协同',
                      '报告故障，追踪解决',
                    ][index]
                  }
                </small>
              </div>
              <Icon name="arrow" size={17} />
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
