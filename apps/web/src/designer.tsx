import { useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  Input,
  InputNumber,
  Select,
  Skeleton,
  Switch,
  Tabs,
  Tag,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  type FlowGraph,
  type FlowNode,
  type Rule,
  ruleSchema,
  roles,
  typeLabels,
} from '../../../packages/contracts/src/index.js';
import { validateGraph } from '../../../packages/core/src/index.js';
import { api, mutate, tenantPath } from './api.js';
import { Icon, PageTitle, roleLabels } from './components.js';
import { FlowCanvas } from './flow-canvas.js';
import { useApp } from './shell.js';
import type { Directory, Workflow } from './types.js';

export function WorkflowList() {
  const { tenant } = useApp();
  const query = useQuery({
    queryKey: ['workflows', tenant.id],
    queryFn: () => api<Workflow[]>(tenantPath(tenant.id, '/workflows')),
    enabled: tenant.role === 'admin',
  });
  if (tenant.role !== 'admin') return <Alert type="warning" message="仅企业管理员可配置流程" />;
  return (
    <>
      <PageTitle
        eyebrow="MANAGEMENT / WORKFLOWS"
        title="流程设计"
        description="把团队的审批规则，变成清晰的可执行流程。"
      />
      {query.error && <Alert type="error" message={query.error.message} />}
      <div className="workflow-grid">
        {query.isPending ? (
          <Skeleton active />
        ) : (
          query.data?.map((workflow, index) => (
            <Link
              className="panel workflow-card"
              to={`/workflows/${workflow.id}`}
              key={workflow.id}
            >
              <div className="workflow-card-top">
                <span className={`quick-icon quick-${index}`}>
                  <Icon name={workflow.type === 'INCIDENT' ? 'tool' : 'flow'} size={24} />
                </span>
                <Tag color="green">已发布 v{workflow.latestVersion}</Tag>
              </div>
              <h3>{workflow.name}</h3>
              <p>
                {workflow.draft.nodes.length} 个节点 · {typeLabels[workflow.type]}业务
              </p>
              <div className="workflow-card-mini">
                {workflow.draft.nodes.slice(0, 4).map((node, i) => (
                  <span key={node.id}>
                    {i > 0 && <i />}
                    <b className={`mini-node mini-${node.kind}`} />
                  </span>
                ))}
              </div>
              <div className="workflow-card-bottom">
                <span>草稿修订 {workflow.revision}</span>
                <strong>编辑流程 ↗</strong>
              </div>
            </Link>
          ))
        )}
      </div>
      <div className="notice-card">
        <Icon name="flow" />
        <div>
          <strong>发布版本互不影响</strong>
          <p>修改草稿并发布新版本后，新申请使用新版本，进行中的申请继续沿原版本审批。</p>
        </div>
      </div>
    </>
  );
}
function RuleFields({ rule, onChange }: { rule: Rule; onChange: (rule: Rule) => void }) {
  const [advanced, setAdvanced] = useState(false);
  const { message } = AntApp.useApp();
  if (advanced || !('field' in rule))
    return (
      <div className="rule-json">
        <label>高级条件 JSON</label>
        <Input.TextArea
          key={JSON.stringify(rule)}
          defaultValue={JSON.stringify(rule, null, 2)}
          rows={7}
          onBlur={(event) => {
            try {
              onChange(ruleSchema.parse(JSON.parse(event.target.value)));
            } catch {
              message.error('条件 JSON 格式不正确，未保存修改');
            }
          }}
        />
        <Button
          type="link"
          size="small"
          onClick={() => {
            setAdvanced(false);
            if (!('field' in rule)) onChange({ op: 'gte', field: 'amountCents', value: 500000 });
          }}
        >
          使用简单条件
        </Button>
      </div>
    );
  return (
    <>
      <Select
        aria-label="条件字段"
        value={rule.field}
        onChange={(field) =>
          onChange({
            op: 'eq',
            field,
            value: ['amountCents', 'leaveMinutes'].includes(field) ? 0 : '',
          })
        }
        options={[
          { value: 'amountCents', label: '金额（分）' },
          { value: 'leaveMinutes', label: '请假时长（分钟）' },
          { value: 'departmentId', label: '申请部门 ID' },
          { value: 'type', label: '申请类型' },
          { value: 'priority', label: '优先级' },
        ]}
      />
      <Select
        aria-label="比较规则"
        value={rule.op}
        onChange={(op) => onChange({ ...rule, op })}
        options={(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in'] as const).map((value, i) => ({
          value,
          label: ['等于', '不等于', '大于', '大于等于', '小于', '小于等于', '属于列表'][i],
        }))}
      />
      {['amountCents', 'leaveMinutes'].includes(rule.field) ? (
        <InputNumber
          aria-label="条件阈值"
          value={typeof rule.value === 'number' ? rule.value : 0}
          onChange={(value) => onChange({ ...rule, value: value ?? 0 })}
          style={{ width: '100%' }}
        />
      ) : (
        <Input
          aria-label="条件值"
          value={Array.isArray(rule.value) ? rule.value.join(',') : String(rule.value)}
          placeholder={rule.op === 'in' ? '多个值用逗号分隔' : '输入条件值'}
          onChange={(event) =>
            onChange({
              ...rule,
              value:
                rule.op === 'in'
                  ? event.target.value.split(',').map((s) => s.trim())
                  : event.target.value,
            })
          }
        />
      )}
      <Button type="link" size="small" onClick={() => setAdvanced(true)}>
        编辑组合条件 JSON
      </Button>
    </>
  );
}
function Editor({ workflow, directory }: { workflow: Workflow; directory?: Directory }) {
  const { tenant } = useApp();
  const [graph, setGraph] = useState<FlowGraph>(workflow.draft);
  const [selectedId, select] = useState<string>();
  const [tab, setTab] = useState('canvas');
  const { message } = AntApp.useApp();
  const client = useQueryClient();
  const selected = graph.nodes.find((n) => n.id === selectedId);
  const errors = validateGraph(graph);
  const update = (node: FlowNode) =>
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.map((n) => (n.id === node.id ? node : n)),
    }));
  const add = (kind: FlowNode['kind'], position = { x: 520, y: graph.nodes.length * 50 }) => {
    const base = {
      id: `n_${crypto.randomUUID().slice(0, 8)}`,
      name: kind === 'approval' ? '审批节点' : kind === 'handling' ? '办理节点' : '条件分支',
      position,
    };
    const node: FlowNode =
      kind === 'approval'
        ? {
            ...base,
            kind,
            strategy: 'ALL',
            assignees: { kind: 'role', role: 'manager' },
            slaMinutes: 1440,
          }
        : kind === 'handling'
          ? { ...base, kind, assignees: { kind: 'role', role: 'agent' }, slaMinutes: 240 }
          : { ...base, kind: 'condition' };
    setGraph((g) => ({ ...g, nodes: [...g.nodes, node] }));
    select(node.id);
  };
  const save = useMutation({
    mutationFn: async (publish: boolean) => {
      const saved = await mutate<Workflow>(
        tenantPath(tenant.id, `/workflows/${workflow.id}`),
        { graph, expectedRevision: workflow.revision },
        'PATCH',
      );
      if (publish)
        await mutate(tenantPath(tenant.id, `/workflows/${workflow.id}/publish`), {
          expectedRevision: saved.revision,
        });
    },
    onSuccess: (_, publish) => {
      message.success(publish ? '新版本已发布，已有申请继续使用原版本' : '草稿已保存');
      void client.invalidateQueries({ queryKey: ['workflow', tenant.id, workflow.id] });
      void client.invalidateQueries({ queryKey: ['workflows'] });
    },
    onError: (error) => {
      message.error(error.message);
      if (error.message.includes('已更新'))
        void client.invalidateQueries({ queryKey: ['workflow', tenant.id, workflow.id] });
    },
  });
  return (
    <>
      <PageTitle
        eyebrow="MANAGEMENT / DESIGNER"
        title={workflow.name}
        description={`当前发布 v${workflow.latestVersion} · 修改草稿后发布新版本，不影响在途申请。`}
        action={
          <div className="heading-actions">
            <Link to="/workflows">
              <Button>返回列表</Button>
            </Link>
            <Button onClick={() => save.mutate(false)} loading={save.isPending}>
              保存草稿
            </Button>
            <Button
              type="primary"
              onClick={() => save.mutate(true)}
              disabled={errors.length > 0}
              loading={save.isPending}
            >
              发布新版本
            </Button>
          </div>
        }
      />
      <div className="designer-toolbar">
        <div>
          <span className="live-dot" />
          草稿工作区 <Tag>修订 {workflow.revision}</Tag>
        </div>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            { key: 'canvas', label: '可视化画布' },
            { key: 'json', label: 'JSON 配置' },
            { key: 'versions', label: `版本历史 (${workflow.versions.length})` },
          ]}
        />
        <span>{errors.length ? `${errors.length} 项待修复` : '✓ 流程校验通过'}</span>
      </div>
      {tab === 'canvas' ? (
        <div className="designer-layout">
          <aside className="node-palette">
            <div className="property-heading">流程节点</div>
            <p>拖入画布，连接下一步</p>
            {(['approval', 'condition', 'handling'] as const).map((kind) => (
              <button
                className={`palette-item palette-${kind}`}
                draggable
                onDragStart={(event) =>
                  event.dataTransfer.setData('application/flowforge-node', kind)
                }
                onClick={() => add(kind)}
                key={kind}
              >
                <Icon
                  name={kind === 'approval' ? 'users' : kind === 'condition' ? 'flow' : 'tool'}
                />
                <span>
                  {kind === 'approval'
                    ? '审批节点'
                    : kind === 'condition'
                      ? '条件分支'
                      : '办理节点'}
                </span>
                <Icon name="plus" size={14} />
              </button>
            ))}
            <div className="palette-help">
              拖动节点底部连接点到目标节点顶部，即可创建连线。
              <br />
              <br />
              选中连线后可按 Delete 删除。
            </div>
          </aside>
          <div className="designer-canvas">
            <FlowCanvas
              graph={graph}
              onChange={setGraph}
              onSelect={select}
              selectedId={selectedId}
              onAdd={add}
            />
          </div>
          <aside className="property-panel">
            <div className="property-heading">{selected ? '节点配置' : '选择一个节点'}</div>
            {!selected ? (
              <div className="property-empty">
                <Icon name="flow" size={34} />
                <p>
                  点击画布中的节点，
                  <br />
                  配置名称、规则与处理人。
                </p>
              </div>
            ) : (
              <>
                <label>节点名称</label>
                <Input
                  aria-label="节点名称"
                  value={selected.name}
                  onChange={(event) => update({ ...selected, name: event.target.value })}
                />
                <small className="muted">{selected.id}</small>
                {(selected.kind === 'approval' || selected.kind === 'handling') && (
                  <>
                    <label>处理人来源</label>
                    <Select
                      aria-label="处理人来源"
                      value={selected.assignees.kind}
                      onChange={(kind) =>
                        update({
                          ...selected,
                          assignees:
                            kind === 'role' ? { kind, role: 'manager' } : { kind, userIds: [] },
                        })
                      }
                      options={[
                        { value: 'role', label: '按企业角色' },
                        { value: 'users', label: '指定成员' },
                      ]}
                    />
                    {selected.assignees.kind === 'role' ? (
                      <Select
                        aria-label="处理人角色"
                        value={selected.assignees.role}
                        onChange={(role) =>
                          update({ ...selected, assignees: { kind: 'role', role } })
                        }
                        options={roles.map((value) => ({ value, label: roleLabels[value] }))}
                      />
                    ) : (
                      <Select
                        aria-label="指定成员"
                        mode="multiple"
                        value={selected.assignees.userIds}
                        onChange={(userIds) =>
                          update({ ...selected, assignees: { kind: 'users', userIds } })
                        }
                        options={directory?.members
                          .filter((m) => m.active)
                          .map((m) => ({ value: m.userId, label: m.name }))}
                      />
                    )}
                    <label>超时时限（分钟）</label>
                    <InputNumber
                      aria-label="超时时限"
                      min={1}
                      max={43200}
                      value={selected.slaMinutes}
                      onChange={(value) => update({ ...selected, slaMinutes: value ?? 1440 })}
                      style={{ width: '100%' }}
                    />
                    <small className="muted">到期通知负责人，原待办和审批策略保持有效。</small>
                    {selected.kind === 'approval' && (
                      <>
                        <label>审批策略</label>
                        <Select
                          aria-label="审批策略"
                          value={selected.strategy}
                          onChange={(strategy) => update({ ...selected, strategy })}
                          options={[
                            { value: 'ALL', label: '会签 · 全部同意后通过' },
                            { value: 'ANY', label: '或签 · 第一个有效决定' },
                          ]}
                        />
                      </>
                    )}
                  </>
                )}
                {selected.kind === 'condition' && (
                  <>
                    <label>分支规则 · 按显示顺序匹配</label>
                    {graph.edges
                      .filter((e) => e.source === selected.id)
                      .map((edge) => (
                        <div className="branch-editor" key={edge.id}>
                          <Input
                            aria-label="分支名称"
                            value={edge.label}
                            onChange={(event) =>
                              setGraph((g) => ({
                                ...g,
                                edges: g.edges.map((e) =>
                                  e.id === edge.id ? { ...e, label: event.target.value } : e,
                                ),
                              }))
                            }
                          />
                          <div className="default-branch">
                            <span>默认分支</span>
                            <Switch
                              checked={edge.condition === null}
                              onChange={(value) =>
                                setGraph((g) => ({
                                  ...g,
                                  edges: g.edges.map((e) =>
                                    e.id === edge.id
                                      ? {
                                          ...e,
                                          condition: value
                                            ? null
                                            : { op: 'gte', field: 'amountCents', value: 500000 },
                                        }
                                      : e,
                                  ),
                                }))
                              }
                            />
                          </div>
                          {edge.condition && (
                            <RuleFields
                              rule={edge.condition}
                              onChange={(condition) =>
                                setGraph((g) => ({
                                  ...g,
                                  edges: g.edges.map((e) =>
                                    e.id === edge.id ? { ...e, condition } : e,
                                  ),
                                }))
                              }
                            />
                          )}
                          <small className="muted">
                            流向：{graph.nodes.find((n) => n.id === edge.target)?.name}
                          </small>
                        </div>
                      ))}
                  </>
                )}
                {!['start', 'end'].includes(selected.kind) && (
                  <Button
                    danger
                    block
                    onClick={() => {
                      setGraph((g) => ({
                        ...g,
                        nodes: g.nodes.filter((n) => n.id !== selected.id),
                        edges: g.edges.filter(
                          (e) => e.source !== selected.id && e.target !== selected.id,
                        ),
                      }));
                      select(undefined);
                    }}
                  >
                    删除节点
                  </Button>
                )}
              </>
            )}
            {errors.length > 0 && (
              <Alert
                className="graph-errors"
                type="warning"
                message="发布前请修复"
                description={
                  <ul>
                    {errors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                }
              />
            )}
          </aside>
        </div>
      ) : tab === 'json' ? (
        <section className="panel json-editor">
          <Alert
            type="info"
            message="修改 JSON 后点击应用，再保存或发布。节点位置与业务规则一并保存。"
          />
          <JsonEditor graph={graph} onApply={setGraph} />
        </section>
      ) : (
        <section className="panel version-history">
          {workflow.versions.map((version) => (
            <div className="version-row" key={version.id}>
              <span className="version-chip">v{version.number}</span>
              <div>
                <strong>已发布版本</strong>
                <p>
                  {new Date(version.publishedAt).toLocaleString('zh-CN')} ·{' '}
                  {version.graph.nodes.length} 个节点
                </p>
              </div>
              <Button
                onClick={() => {
                  setGraph(structuredClone(version.graph));
                  setTab('canvas');
                  message.info('已载入历史配置为草稿，保存发布后生成新版本');
                }}
              >
                载入为草稿
              </Button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
function JsonEditor({ graph, onApply }: { graph: FlowGraph; onApply: (graph: FlowGraph) => void }) {
  const [text, setText] = useState(JSON.stringify(graph, null, 2));
  const { message } = AntApp.useApp();
  return (
    <>
      <Input.TextArea
        aria-label="流程 JSON"
        className="json-textarea"
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={24}
      />
      <Button
        type="primary"
        onClick={() => {
          try {
            const parsed: unknown = JSON.parse(text);
            const errors = validateGraph(parsed);
            if (errors.length) {
              message.error(errors.join('；'));
              return;
            }
            onApply(parsed as FlowGraph);
            message.success('JSON 已应用到画布');
          } catch {
            message.error('JSON 语法不正确');
          }
        }}
      >
        应用配置
      </Button>
    </>
  );
}
export function WorkflowEditor() {
  const { tenant } = useApp();
  const { id = '' } = useParams();
  const query = useQuery({
    queryKey: ['workflow', tenant.id, id],
    queryFn: () => api<Workflow>(tenantPath(tenant.id, `/workflows/${id}`)),
    enabled: tenant.role === 'admin',
  });
  const directory = useQuery({
    queryKey: ['directory', tenant.id],
    queryFn: () => api<Directory>(tenantPath(tenant.id, '/directory')),
    enabled: tenant.role === 'admin',
  });
  if (tenant.role !== 'admin') return <Alert type="warning" message="仅企业管理员可配置流程" />;
  if (query.isPending) return <Skeleton active />;
  if (query.error) return <Alert type="error" message={query.error.message} />;
  return query.data ? (
    <Editor
      key={`${tenant.id}:${id}:${query.data.revision}`}
      workflow={query.data}
      directory={directory.data}
    />
  ) : null;
}
