import { describe, expect, it } from 'vitest';
import type { FlowGraph } from '../../contracts/src/index.js';
import { applicationTypes } from '../../contracts/src/index.js';
import { assertGraph, validateGraph } from './graph.js';
import { createTemplate } from './templates.js';

describe('publish-time validation', () => {
  it.each(applicationTypes)('ships a valid %s template', (type) => {
    expect(validateGraph(createTemplate(type))).toEqual([]);
  });
  const invalid = (change: (graph: FlowGraph) => void, expected: string) => {
    const graph = createTemplate('EXPENSE');
    change(graph);
    expect(validateGraph(graph).join(' ')).toContain(expected);
    expect(() => assertGraph(graph)).toThrow();
  };
  it('rejects malformed schemas and duplicate identifiers', () => {
    expect(validateGraph({ nodes: [] }).length).toBeGreaterThan(0);
    invalid((g) => g.nodes.push(g.nodes[0]!), 'ID 重复');
    invalid((g) => g.edges.push(g.edges[0]!), '连线 ID 重复');
  });
  it('requires a single start and reachable endings', () => {
    invalid((g) => {
      g.nodes = g.nodes.filter((n) => n.kind !== 'start');
    }, '开始节点');
    invalid((g) => {
      g.nodes = g.nodes.filter((n) => n.kind !== 'end');
    }, '缺少结束');
    invalid(
      (g) =>
        g.nodes.push({ id: 'orphan', kind: 'end', name: '孤立结束', position: { x: 0, y: 0 } }),
      '不可达',
    );
    invalid((g) => {
      g.edges[0]!.target = 'missing';
    }, '不存在');
  });
  it('rejects cycles, invalid degrees and ambiguous defaults', () => {
    invalid((g) => {
      g.edges[1]!.target = 'start';
    }, '环路');
    invalid(
      (g) =>
        g.edges.push({
          id: 'end-out',
          source: 'end',
          target: 'manager',
          condition: null,
          label: '',
        }),
      '结束节点不能',
    );
    invalid((g) => {
      g.edges = g.edges.filter((e) => e.source !== 'manager');
    }, '需要一条');
    invalid((g) => {
      g.edges.find((e) => e.id === 'branch-finance')!.condition = null;
    }, '默认分支');
    invalid((g) => {
      g.edges.find((e) => e.id === 'branch-finance')!.condition = {
        op: 'eq',
        field: 'secret',
        value: 'x',
      };
    }, '不支持');
  });
  it('prevents repeated countersign seats', () => {
    invalid((g) => {
      const n = g.nodes.find((n) => n.kind === 'approval')!;
      if (n.kind === 'approval')
        n.assignees = {
          kind: 'users',
          userIds: ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'],
        };
    }, '审批人重复');
  });
});
