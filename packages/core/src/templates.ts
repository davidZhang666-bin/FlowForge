import type { ApplicationType, FlowGraph, FlowNode } from '../../contracts/src/index.js';
const node = <T extends FlowNode>(value: T): T => value;
export function createTemplate(type: ApplicationType): FlowGraph {
  if (type === 'INCIDENT')
    return {
      schemaVersion: 1,
      nodes: [
        node({ id: 'start', kind: 'start', name: '故障申报', position: { x: 250, y: 0 } }),
        node({
          id: 'handling',
          kind: 'handling',
          name: '服务台办理',
          assignees: { kind: 'role', role: 'agent' },
          slaMinutes: 240,
          position: { x: 250, y: 160 },
        }),
        node({ id: 'end', kind: 'end', name: '验收完成', position: { x: 250, y: 330 } }),
      ],
      edges: [
        {
          id: 'start-handling',
          source: 'start',
          target: 'handling',
          label: '创建工单',
          condition: null,
        },
        {
          id: 'handling-end',
          source: 'handling',
          target: 'end',
          label: '申请人验收',
          condition: null,
        },
      ],
    };
  return {
    schemaVersion: 1,
    nodes: [
      { id: 'start', kind: 'start', name: '提交申请', position: { x: 260, y: 0 } },
      {
        id: 'manager',
        kind: 'approval',
        name: '部门负责人审批',
        strategy: 'ANY',
        assignees: { kind: 'role', role: 'manager' },
        slaMinutes: 1440,
        position: { x: 260, y: 130 },
      },
      {
        id: 'branch',
        kind: 'condition',
        name: type === 'LEAVE' ? '请假时长判断' : '申请金额判断',
        position: { x: 260, y: 260 },
      },
      {
        id: 'finance',
        kind: 'approval',
        name: type === 'LEAVE' ? '人事复核' : '财务会签',
        strategy: type === 'LEAVE' ? 'ANY' : 'ALL',
        assignees: { kind: 'role', role: 'approver' },
        slaMinutes: 1440,
        position: { x: 80, y: 420 },
      },
      { id: 'end', kind: 'end', name: '流程完成', position: { x: 260, y: 600 } },
    ],
    edges: [
      {
        id: 'start-manager',
        source: 'start',
        target: 'manager',
        label: '送交部门负责人',
        condition: null,
      },
      {
        id: 'manager-branch',
        source: 'manager',
        target: 'branch',
        label: '同意后判断',
        condition: null,
      },
      {
        id: 'branch-finance',
        source: 'branch',
        target: 'finance',
        label:
          type === 'LEAVE'
            ? '超过 3 个工作日'
            : type === 'PURCHASE'
              ? '金额 ≥ ¥10,000'
              : '金额 ≥ ¥5,000',
        condition: {
          op: type === 'LEAVE' ? 'gt' : 'gte',
          field: type === 'LEAVE' ? 'leaveMinutes' : 'amountCents',
          value: type === 'LEAVE' ? 1440 : type === 'PURCHASE' ? 1_000_000 : 500_000,
        },
      },
      { id: 'branch-end', source: 'branch', target: 'end', label: '默认分支', condition: null },
      { id: 'finance-end', source: 'finance', target: 'end', label: '复核通过', condition: null },
    ],
  };
}
