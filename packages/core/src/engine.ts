import { requestSchema, type Actor, type FlowGraph, type FlowNode, type InstanceCommand, type Member, type RequestData } from '../../contracts/src/index.js';
import { assertGraph } from './graph.js';
import { evaluateRule } from './rules.js';

export class DomainError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'DomainError'; }
}
export type ProcessStatus = 'RUNNING' | 'RETURNED' | 'BLOCKED' | 'COMPLETED' | 'REJECTED' | 'WITHDRAWN';
export interface ApprovalTask { id: string; nodeId: string; round: number; assigneeId: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'; dueAt: string; escalated: boolean; comment?: string }
export interface Ticket { id: string; nodeId: string; round: number; status: 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'CANCELLED'; assigneeId: string | null; candidateIds: string[]; dueAt: string; escalated: boolean }
export interface Execution { nodeId: string; round: number; status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED' }
export interface ProcessState {
  id: string; versionId: string; revision: number; status: ProcessStatus; applicantId: string; departmentId: string;
  data: RequestData; round: number; currentNodeId: string | null; tasks: ApprovalTask[]; tickets: Ticket[]; executions: Execution[];
}
export interface FlowEvent { id: string; type: string; actorId: string; nodeId: string | null; round: number; at: string; payload: Record<string, unknown> }
export interface EngineContext { now: string; id: () => string; members: Member[] }
export interface Transition { state: ProcessState; events: FlowEvent[] }
type ApprovalNode = Extract<FlowNode, { kind: 'approval' }>;
type Session = { state: ProcessState; graph: FlowGraph; context: EngineContext; actor: Actor; events: FlowEvent[] };

function fail(code: string, message: string): never { throw new DomainError(code, message); }
function emit(s: Session, type: string, payload: Record<string, unknown> = {}, nodeId = s.state.currentNodeId): void {
  s.events.push({ id: s.context.id(), type, actorId: s.actor.userId, nodeId, round: s.state.round, at: s.context.now, payload });
}
function current(s: Session): FlowNode {
  return s.graph.nodes.find(n => n.id === s.state.currentNodeId) ?? fail('INVALID_NODE', '当前流程节点不存在');
}
function eligible(s: Session, userId: string): boolean {
  return userId !== s.state.applicantId && s.context.members.some(m => m.userId === userId && m.active);
}
function candidates(s: Session, node: Extract<FlowNode, { kind: 'approval' | 'handling' }>): string[] {
  const spec = node.assignees;
  return [...new Set(s.context.members.filter(m => m.active && eligible(s, m.userId) && (spec.kind === 'users' ? spec.userIds.includes(m.userId) : m.role === spec.role && (spec.role !== 'manager' || m.departmentId === s.state.departmentId))).map(m => m.userId))];
}
function finishNode(s: Session): void {
  const execution = s.state.executions.find(e => e.nodeId === s.state.currentNodeId && e.round === s.state.round && e.status === 'ACTIVE');
  if (execution) execution.status = 'COMPLETED';
  emit(s, 'node.completed');
}
function cancelPending(s: Session): void {
  s.state.tasks.filter(t => t.status === 'PENDING').forEach(t => { t.status = 'CANCELLED'; });
  s.state.tickets.filter(t => !['CLOSED', 'CANCELLED'].includes(t.status)).forEach(t => { t.status = 'CANCELLED'; });
  s.state.executions.filter(e => e.status === 'ACTIVE').forEach(e => { e.status = 'CANCELLED'; });
}
function leave(s: Session): void {
  const node = current(s);
  const edges = s.graph.edges.filter(e => e.source === node.id);
  const edge = node.kind === 'condition' ? edges.find(e => e.condition && evaluateRule(e.condition, { ...s.state.data, departmentId: s.state.departmentId })) ?? edges.find(e => e.condition === null) : edges[0];
  if (!edge) fail('INVALID_GRAPH', '节点缺少可执行出边');
  emit(s, 'edge.traversed', { edgeId: edge.id, label: edge.label, condition: edge.condition });
  s.state.currentNodeId = edge.target;
}
function advance(s: Session): void {
  for (let steps = 0; steps < s.graph.nodes.length + 1; steps++) {
    const node = current(s);
    s.state.executions.push({ nodeId: node.id, round: s.state.round, status: 'ACTIVE' });
    emit(s, 'node.entered', { name: node.name, kind: node.kind });
    if (node.kind === 'end') {
      finishNode(s); s.state.status = 'COMPLETED'; emit(s, 'process.completed'); return;
    }
    if (node.kind === 'approval' || node.kind === 'handling') {
      const users = candidates(s, node);
      if (!users.length) { s.state.status = 'BLOCKED'; emit(s, 'process.blocked', { reason: '没有符合条件且非申请人的处理人' }); return; }
      const dueAt = new Date(Date.parse(s.context.now) + node.slaMinutes * 60000).toISOString();
      if (node.kind === 'approval') {
        for (const assigneeId of users) {
          const task: ApprovalTask = { id: s.context.id(), nodeId: node.id, round: s.state.round, assigneeId, status: 'PENDING', dueAt, escalated: false };
          s.state.tasks.push(task); emit(s, 'task.created', { taskId: task.id, recipientIds: [assigneeId], dueAt });
        }
      } else {
        const ticket: Ticket = { id: s.context.id(), nodeId: node.id, round: s.state.round, status: 'ASSIGNED', assigneeId: null, candidateIds: users, dueAt, escalated: false };
        s.state.tickets.push(ticket); emit(s, 'ticket.created', { ticketId: ticket.id, recipientIds: users, dueAt });
      }
      return;
    }
    finishNode(s); leave(s);
  }
  fail('INVALID_GRAPH', '流程超出最大自动流转步数');
}
function next(s: Session): void { finishNode(s); leave(s); advance(s); }
function activeTask(s: Session, command: InstanceCommand): ApprovalTask {
  const task = s.state.tasks.find(t => t.id === command.taskId && t.status === 'PENDING' && t.nodeId === s.state.currentNodeId && t.round === s.state.round);
  return task ?? fail('TASK_CLOSED', '审批任务已处理或不存在');
}
function ownerTask(s: Session, command: InstanceCommand): ApprovalTask {
  const task = activeTask(s, command);
  if (task.assigneeId !== s.actor.userId || !eligible(s, s.actor.userId)) fail('FORBIDDEN', '只有当前任务处理人可以审批，且不得自审');
  return task;
}
export const approvalStrategies: Record<ApprovalNode['strategy'], (tasks: ApprovalTask[]) => boolean> = {
  ALL: tasks => tasks.every(t => t.status === 'APPROVED'),
  ANY: tasks => tasks.some(t => t.status === 'APPROVED'),
};
const approvals = (s: Session, command: InstanceCommand): void => {
  const node = current(s);
  if (node.kind !== 'approval') fail('INVALID_ACTION', '当前不是审批节点');
  const task = ownerTask(s, command); task.comment = command.comment;
  if (command.action === 'return') {
    if (!command.comment) fail('COMMENT_REQUIRED', '退回需要填写原因');
    cancelPending(s); s.state.status = 'RETURNED'; emit(s, 'process.returned', { comment: command.comment, recipientIds: [s.state.applicantId] }); return;
  }
  task.status = command.action === 'approve' ? 'APPROVED' : 'REJECTED';
  emit(s, `task.${command.action === 'approve' ? 'approved' : 'rejected'}`, { taskId: task.id, comment: command.comment });
  if (command.action === 'reject') { cancelPending(s); s.state.status = 'REJECTED'; emit(s, 'process.rejected', { recipientIds: [s.state.applicantId] }); return; }
  const peers = s.state.tasks.filter(t => t.nodeId === node.id && t.round === s.state.round);
  if (approvalStrategies[node.strategy](peers)) { peers.filter(t => t.status === 'PENDING').forEach(t => { t.status = 'CANCELLED'; }); next(s); }
};
function canManage(s: Session): boolean { return s.actor.role === 'admin' || (s.actor.role === 'manager' && s.actor.departmentId === s.state.departmentId); }
function transfer(s: Session, command: InstanceCommand): void {
  if (!command.targetUserId || !eligible(s, command.targetUserId)) fail('INVALID_ASSIGNEE', '接收人必须是本企业有效成员，且不能是申请人');
  if (!command.comment) fail('COMMENT_REQUIRED', '转交或补充指派需要填写原因');
  if (s.state.status === 'BLOCKED') {
    if (!canManage(s)) fail('FORBIDDEN', '只有有权限的管理员可以恢复异常流程');
    const node = current(s);
    if (node.kind !== 'approval' && node.kind !== 'handling') fail('INVALID_ACTION', '当前节点不可指派');
    const dueAt = new Date(Date.parse(s.context.now) + node.slaMinutes * 60000).toISOString();
    if (node.kind === 'approval') s.state.tasks.push({ id: s.context.id(), nodeId: node.id, round: s.state.round, assigneeId: command.targetUserId, status: 'PENDING', dueAt, escalated: false });
    else s.state.tickets.push({ id: s.context.id(), nodeId: node.id, round: s.state.round, status: 'ASSIGNED', assigneeId: command.targetUserId, candidateIds: [command.targetUserId], dueAt, escalated: false });
    s.state.status = 'RUNNING'; emit(s, 'process.resumed', { recipientIds: [command.targetUserId], comment: command.comment }); return;
  }
  if (current(s).kind === 'handling') {
    const ticket = s.state.tickets.find(t => t.nodeId === s.state.currentNodeId && t.round === s.state.round && !['CLOSED', 'CANCELLED'].includes(t.status)) ?? fail('TICKET_CLOSED', '工单已关闭');
    if (ticket.assigneeId !== s.actor.userId && !canManage(s)) fail('FORBIDDEN', '无权指派该工单');
    const from = ticket.assigneeId; ticket.assigneeId = command.targetUserId; ticket.candidateIds = [command.targetUserId]; ticket.status = 'ASSIGNED';
    emit(s, 'ticket.transferred', { from, to: command.targetUserId, recipientIds: [command.targetUserId], comment: command.comment }); return;
  }
  const task = activeTask(s, command);
  if (task.assigneeId !== s.actor.userId && !canManage(s)) fail('FORBIDDEN', '无权转交该任务');
  if (s.state.tasks.some(t => t.id !== task.id && t.nodeId === task.nodeId && t.round === task.round && t.assigneeId === command.targetUserId && t.status !== 'CANCELLED')) fail('DUPLICATE_ASSIGNEE', '接收人已经拥有该节点的审批席位');
  const from = task.assigneeId; task.assigneeId = command.targetUserId;
  emit(s, 'task.transferred', { taskId: task.id, from, to: command.targetUserId, recipientIds: [command.targetUserId], comment: command.comment });
}
function ticketAction(s: Session, command: InstanceCommand): void {
  const ticket = s.state.tickets.find(t => t.nodeId === s.state.currentNodeId && t.round === s.state.round && !['CLOSED', 'CANCELLED'].includes(t.status)) ?? fail('TICKET_CLOSED', '没有待处理工单');
  const isApplicant = s.actor.userId === s.state.applicantId;
  switch (command.action) {
    case 'claim':
      if (ticket.status !== 'ASSIGNED' || (ticket.assigneeId && ticket.assigneeId !== s.actor.userId) || !ticket.candidateIds.includes(s.actor.userId) || !eligible(s, s.actor.userId)) fail('FORBIDDEN', '当前人员不能认领此工单');
      ticket.assigneeId = s.actor.userId; ticket.status = 'IN_PROGRESS'; break;
    case 'start':
      if (ticket.assigneeId !== s.actor.userId || ticket.status !== 'ASSIGNED' || !eligible(s, s.actor.userId)) fail('INVALID_ACTION', '只有处理人可以开始办理');
      ticket.status = 'IN_PROGRESS'; break;
    case 'resolve':
      if (ticket.assigneeId !== s.actor.userId || ticket.status !== 'IN_PROGRESS' || !eligible(s, s.actor.userId)) fail('FORBIDDEN', '只有当前处理人可以提交解决结果');
      if (!command.comment) fail('COMMENT_REQUIRED', '请填写解决记录');
      ticket.status = 'RESOLVED'; break;
    case 'accept':
      if (!isApplicant || ticket.status !== 'RESOLVED') fail('FORBIDDEN', '只有申请人可以验收待确认工单');
      ticket.status = 'CLOSED'; emit(s, 'ticket.accepted', { ticketId: ticket.id }); next(s); return;
    case 'reopen':
      if (!isApplicant || ticket.status !== 'RESOLVED') fail('FORBIDDEN', '只有申请人可以重开待验收工单');
      if (!command.comment) fail('COMMENT_REQUIRED', '请填写重开原因');
      ticket.status = 'IN_PROGRESS'; break;
    default: fail('INVALID_ACTION', '不支持的工单操作');
  }
  emit(s, `ticket.${command.action}`, { ticketId: ticket.id, comment: command.comment, recipientIds: command.action === 'resolve' ? [s.state.applicantId] : ticket.assigneeId ? [ticket.assigneeId] : [] });
}

export function startProcess(id: string, versionId: string, graph: FlowGraph, data: RequestData, actor: Actor, context: EngineContext): Transition {
  assertGraph(graph);
  const state: ProcessState = { id, versionId, revision: 0, status: 'RUNNING', applicantId: actor.userId, departmentId: actor.departmentId, data: requestSchema.parse(data), round: 1, currentNodeId: graph.nodes.find(n => n.kind === 'start')?.id ?? null, tasks: [], tickets: [], executions: [] };
  const s: Session = { state, graph, actor, context, events: [] };
  emit(s, 'process.submitted', { title: data.title }); advance(s); return { state, events: s.events };
}
export function executeCommand(source: ProcessState, graph: FlowGraph, command: InstanceCommand, actor: Actor, context: EngineContext): Transition {
  if (source.revision !== command.expectedRevision) fail('REVISION_CONFLICT', '记录已更新，请刷新后重试');
  if (!['RUNNING', 'RETURNED', 'BLOCKED'].includes(source.status)) fail('PROCESS_CLOSED', '流程已结束');
  const s: Session = { state: structuredClone(source), graph, actor, context, events: [] };
  if (command.action === 'withdraw') {
    if (source.applicantId !== actor.userId) fail('FORBIDDEN', '只有申请人可以撤回');
    cancelPending(s); s.state.status = 'WITHDRAWN'; emit(s, 'process.withdrawn');
  } else if (command.action === 'resubmit') {
    if (source.status !== 'RETURNED' || source.applicantId !== actor.userId || !command.data) fail('FORBIDDEN', '只有申请人可以重新提交已退回申请');
    if (command.data.type !== source.data.type) fail('INVALID_TYPE', '重提不能改变申请类型');
    s.state.data = requestSchema.parse(command.data); s.state.status = 'RUNNING'; s.state.round++;
    s.state.currentNodeId = graph.nodes.find(n => n.kind === 'start')?.id ?? null;
    emit(s, 'process.resubmitted'); advance(s);
  } else if (command.action === 'assign' || command.action === 'transfer') {
    if (source.status === 'RETURNED') fail('INVALID_ACTION', '退回中的申请不能转交');
    transfer(s, command);
  } else {
    if (source.status !== 'RUNNING') fail('INVALID_ACTION', '当前状态不允许此操作');
    if (['approve', 'reject', 'return'].includes(command.action)) approvals(s, command); else ticketAction(s, command);
  }
  s.state.revision++; return { state: s.state, events: s.events };
}

export function escalateOverdue(source: ProcessState, graph: FlowGraph, actor: Actor, context: EngineContext): Transition | null {
  if (source.status !== 'RUNNING') return null;
  const s: Session = { state: structuredClone(source), graph, actor, context, events: [] };
  const due = [...s.state.tasks.filter(t => t.status === 'PENDING'), ...s.state.tickets.filter(t => ['ASSIGNED', 'IN_PROGRESS'].includes(t.status))].filter(t => !t.escalated && Date.parse(t.dueAt) <= Date.parse(context.now));
  const supervisors = context.members.filter(m => m.active && (m.role === 'admin' || (m.role === 'manager' && m.departmentId === source.departmentId))).map(m => m.userId);
  for (const item of due) { item.escalated = true; emit(s, 'task.escalated', { itemId: item.id, dueAt: item.dueAt, recipientIds: supervisors }, item.nodeId); }
  if (!due.length) return null;
  s.state.revision++; return { state: s.state, events: s.events };
}
