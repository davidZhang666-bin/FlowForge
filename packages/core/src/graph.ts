import { flowSchema, type FlowGraph } from '../../contracts/src/index.js';
import { validateRule } from './rules.js';

export function validateGraph(value: unknown): string[] {
  const result = flowSchema.safeParse(value);
  if (!result.success) return result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  const graph = result.data;
  const errors: string[] = [];
  const ids = new Set(graph.nodes.map((n) => n.id));
  if (ids.size !== graph.nodes.length) errors.push('节点 ID 重复');
  if (new Set(graph.edges.map((e) => e.id)).size !== graph.edges.length)
    errors.push('连线 ID 重复');
  const starts = graph.nodes.filter((n) => n.kind === 'start');
  if (starts.length !== 1) errors.push('必须有且仅有一个开始节点');
  if (!graph.nodes.some((n) => n.kind === 'end')) errors.push('缺少结束节点');
  for (const e of graph.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) errors.push(`连线 ${e.id} 引用了不存在的节点`);
    if (e.condition) errors.push(...validateRule(e.condition).map((s) => `${e.label}: ${s}`));
  }
  for (const node of graph.nodes) {
    const out = graph.edges.filter((e) => e.source === node.id);
    const incoming = graph.edges.filter((e) => e.target === node.id);
    if (node.kind === 'start' && incoming.length) errors.push('开始节点不能有入边');
    if (node.kind === 'end' && out.length) errors.push('结束节点不能有出边');
    if (node.kind === 'condition') {
      if (out.length < 2 || out.filter((e) => e.condition === null).length !== 1)
        errors.push(`${node.name} 需要条件分支和一个默认分支`);
    } else if (node.kind !== 'end' && (out.length !== 1 || out.some((e) => e.condition !== null)))
      errors.push(`${node.name} 需要一条无条件出边`);
    if (
      (node.kind === 'approval' || node.kind === 'handling') &&
      node.assignees.kind === 'users' &&
      new Set(node.assignees.userIds).size !== node.assignees.userIds.length
    )
      errors.push(`${node.name} 审批人重复`);
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(id: string): void {
    if (visiting.has(id)) {
      errors.push('流程不能包含环路');
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const e of graph.edges.filter((e) => e.source === id)) visit(e.target);
    visiting.delete(id);
    visited.add(id);
  }
  // Check disconnected cycles as well as the executable part of the graph.
  for (const node of graph.nodes) visit(node.id);
  const reachable = new Set<string>();
  function walk(id: string): void {
    if (reachable.has(id)) return;
    reachable.add(id);
    graph.edges.filter((e) => e.source === id).forEach((e) => walk(e.target));
  }
  if (starts[0]) walk(starts[0].id);
  if (graph.nodes.some((n) => !reachable.has(n.id))) errors.push('存在从开始节点不可达的节点');
  return [...new Set(errors)];
}
export function assertGraph(graph: FlowGraph): void {
  const errors = validateGraph(graph);
  if (errors.length) throw new Error(errors.join('；'));
}
