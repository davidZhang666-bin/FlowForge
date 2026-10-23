import { describe, expect, it } from 'vitest';
import type { Actor, InstanceCommand, Member, RequestData } from '../../contracts/src/index.js';
import { createTemplate } from './templates.js';
import { escalateOverdue, executeCommand, startProcess, type EngineContext, type ProcessState } from './engine.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const applicant: Actor = { userId: id(1), tenantId: id(100), departmentId: id(200), role: 'employee', scope: 'SELF', name: '申请人' };
const manager: Actor = { ...applicant, userId: id(2), role: 'manager', scope: 'DEPARTMENT' };
const reviewer: Actor = { ...applicant, userId: id(3), role: 'approver' };
const reviewer2: Actor = { ...reviewer, userId: id(4) };
const agent: Actor = { ...applicant, userId: id(5), role: 'agent' };
const members: Member[] = [applicant, manager, reviewer, reviewer2, agent].map(m => ({ ...m, active: true }));
let sequence = 1000;
const context = (): EngineContext => ({ now: '2026-10-23T00:00:00.000Z', id: () => id(sequence++), members });
const data: RequestData = { title: '设备采购申请', type: 'PURCHASE', amountCents: 2_000_000, leaveMinutes: 0, priority: 'NORMAL', description: '' };
const graph = createTemplate('PURCHASE');
const initial = () => startProcess(id(50), id(60), graph, data, applicant, context()).state;
const act = (state: ProcessState, actor: Actor, action: InstanceCommand['action'], extra: Partial<InstanceCommand> = {}) => executeCommand(state, graph, { expectedRevision: state.revision, action, comment: '', taskId: state.tasks.find(t => t.status === 'PENDING' && t.assigneeId === actor.userId)?.id, ...extra }, actor, context());

describe('approval aggregate', () => {
  it('waits for all countersign seats and preserves the source state', () => {
    const source = initial();
    const first = act(source, manager, 'approve');
    expect(source.revision).toBe(0); expect(source.currentNodeId).toBe('manager');
    expect(first.state.currentNodeId).toBe('finance');
    const second = act(first.state, reviewer, 'approve');
    expect(second.state.status).toBe('RUNNING');
    const final = act(second.state, reviewer2, 'approve');
    expect(final.state.status).toBe('COMPLETED');
    expect(final.events.some(e => e.type === 'process.completed')).toBe(true);
    expect(final.state.tasks.some(t => t.status === 'PENDING')).toBe(false);
    expect(() => act(final.state, reviewer, 'approve')).toThrow('流程已结束');
  });
  it('takes the default branch for low amounts', () => {
    const state = startProcess(id(50), id(60), graph, { ...data, amountCents: 100 }, applicant, context()).state;
    const result = act(state, manager, 'approve');
    expect(result.state.status).toBe('COMPLETED');
    expect(result.events.find(e => e.payload.edgeId === 'branch-end')).toBeDefined();
  });
  it('rejects unauthorized and stale decisions', () => {
    const state = initial();
    expect(() => act(state, applicant, 'approve', { taskId: state.tasks[0]!.id })).toThrow('只有当前任务');
    expect(() => executeCommand(state, graph, { action: 'approve', expectedRevision: 9, comment: '' }, manager, context())).toThrow('记录已更新');
    expect(() => act(state, manager, 'approve', { taskId: 'missing' })).toThrow('审批任务');
  });
  it('rejects and cancels peer tasks', () => {
    const state = act(initial(), manager, 'approve').state;
    const result = act(state, reviewer, 'reject', { comment: '预算不足' });
    expect(result.state.status).toBe('REJECTED');
    expect(result.state.tasks.filter(t => t.status === 'PENDING')).toHaveLength(0);
  });
  it('returns to the applicant and resubmits with the same version', () => {
    expect(() => act(initial(), manager, 'return')).toThrow('填写原因');
    const returned = act(initial(), manager, 'return', { comment: '补充明细' }).state;
    expect(returned.status).toBe('RETURNED');
    expect(() => act(returned, manager, 'resubmit', { data })).toThrow('只有申请人');
    const resubmitted = act(returned, applicant, 'resubmit', { data: { ...data, amountCents: 500 } }).state;
    expect(resubmitted.round).toBe(2); expect(resubmitted.versionId).toBe(returned.versionId);
    expect(resubmitted.tasks.filter(t => t.round === 1).every(t => t.status !== 'PENDING')).toBe(true);
    expect(act(resubmitted, manager, 'approve').state.status).toBe('COMPLETED');
    expect(() => act(returned, applicant, 'resubmit', { data: { ...data, type: 'EXPENSE' } })).toThrow('申请类型');
    expect(() => act(returned, manager, 'transfer', { targetUserId: reviewer.userId })).toThrow('退回中');
  });
  it('allows withdrawal only by applicant', () => {
    expect(() => act(initial(), manager, 'withdraw')).toThrow('只有申请人');
    expect(act(initial(), applicant, 'withdraw').state.status).toBe('WITHDRAWN');
  });
  it('transfers seats without weakening countersign or allowing self approval', () => {
    expect(() => act(initial(), manager, 'transfer', { targetUserId: applicant.userId, comment: 'x' })).toThrow('接收人');
    expect(() => act(initial(), reviewer, 'transfer', { taskId: initial().tasks[0]?.id, targetUserId: agent.userId, comment: 'x' })).toThrow();
    expect(() => act(initial(), manager, 'transfer', { targetUserId: reviewer.userId })).toThrow('填写原因');
    const state = act(initial(), manager, 'transfer', { targetUserId: agent.userId, comment: '代理处理' }).state;
    expect(act(state, agent, 'approve').state.currentNodeId).toBe('finance');
    const finance = act(initial(), manager, 'approve').state;
    expect(() => act(finance, reviewer, 'transfer', { targetUserId: reviewer2.userId, comment: 'x' })).toThrow('审批席位');
  });
  it('blocks missing assignees and permits audited recovery', () => {
    const blocked = startProcess(id(50), id(60), graph, data, applicant, { ...context(), members: [members[0]!] }).state;
    expect(blocked.status).toBe('BLOCKED');
    expect(() => act(blocked, applicant, 'assign', { targetUserId: reviewer.userId, comment: 'x' })).toThrow('管理员');
    const recovered = act(blocked, manager, 'assign', { targetUserId: reviewer.userId, comment: '恢复指派' }).state;
    expect(recovered.status).toBe('RUNNING');
    expect(recovered.tasks[0]?.assigneeId).toBe(reviewer.userId);
  });
  it('escalates once without changing pending seats', () => {
    const state = initial();
    expect(escalateOverdue(state, graph, manager, context())).toBeNull();
    const expired = { ...context(), now: '2026-10-25T00:00:00.000Z' };
    const result = escalateOverdue(state, graph, manager, expired)!;
    expect(result.state.tasks[0]?.status).toBe('PENDING'); expect(result.events).toHaveLength(1);
    expect(escalateOverdue(result.state, graph, manager, expired)).toBeNull();
    expect(escalateOverdue(act(state, applicant, 'withdraw').state, graph, manager, expired)).toBeNull();
  });
});

describe('incident lifecycle', () => {
  const incidentGraph = createTemplate('INCIDENT');
  const begin = () => startProcess(id(51), id(61), incidentGraph, { ...data, type: 'INCIDENT' }, applicant, context()).state;
  const run = (state: ProcessState, actor: Actor, action: InstanceCommand['action'], comment = '') => executeCommand(state, incidentGraph, { expectedRevision: state.revision, action, comment }, actor, context()).state;
  it('requires claim, resolution and applicant acceptance', () => {
    const state = begin();
    expect(() => run(state, applicant, 'claim')).toThrow('不能认领');
    expect(() => run(state, agent, 'resolve', 'x')).toThrow('当前处理人');
    const claimed = run(state, agent, 'claim');
    expect(() => run(claimed, agent, 'resolve')).toThrow('解决记录');
    const resolved = run(claimed, agent, 'resolve', '已更换网线');
    expect(() => run(resolved, agent, 'accept')).toThrow('只有申请人');
    expect(() => run(resolved, applicant, 'reopen')).toThrow('重开原因');
    const reopened = run(resolved, applicant, 'reopen', '仍不稳定');
    const fixed = run(reopened, agent, 'resolve', '更换交换机端口');
    expect(run(fixed, applicant, 'accept').status).toBe('COMPLETED');
    expect(run(claimed, applicant, 'withdraw').tickets[0]?.status).toBe('CANCELLED');
  });
});
