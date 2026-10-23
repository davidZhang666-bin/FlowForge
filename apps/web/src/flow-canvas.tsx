import { useEffect, useMemo, type DragEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useNodesState,
  type Node,
  type Connection,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { FlowGraph, FlowNode } from '../../../packages/contracts/src/index.js';
import type { Execution } from '../../../packages/core/src/index.js';
import { Icon } from './components.js';

function WorkflowNode({ data }: NodeProps) {
  const kind = String(data.kind);
  const state = String(data.state ?? 'idle');
  return (
    <div className={`workflow-node node-${kind} node-state-${state}`}>
      {kind !== 'start' && <Handle type="target" position={Position.Top} />}
      <div className="node-icon">
        <Icon
          name={
            kind === 'approval'
              ? 'users'
              : kind === 'condition'
                ? 'flow'
                : kind === 'handling'
                  ? 'tool'
                  : kind === 'end'
                    ? 'check'
                    : 'file'
          }
          size={18}
        />
      </div>
      <div className="node-copy">
        <strong>{String(data.label)}</strong>
        <small>
          {kind === 'approval'
            ? data.strategy === 'ALL'
              ? '全部同意 · 会签'
              : '任一决定 · 或签'
            : kind === 'condition'
              ? '根据条件选择路径'
              : kind === 'handling'
                ? '办理后由申请人验收'
                : kind === 'start'
                  ? '流程起点'
                  : '流程结束'}
        </small>
      </div>
      {state === 'COMPLETED' && <span className="node-check">✓</span>}
      {state === 'ACTIVE' && <span className="pulse-dot" />}
      {kind !== 'end' && <Handle type="source" position={Position.Bottom} />}
    </div>
  );
}
const nodeTypes = { workflow: WorkflowNode };
const noExecutions: Execution[] = [];
const noEdges: string[] = [];
interface Props {
  graph: FlowGraph;
  onChange?: (graph: FlowGraph) => void;
  onSelect?: (id: string) => void;
  selectedId?: string;
  executions?: Execution[];
  visitedEdges?: string[];
  onAdd?: (kind: FlowNode['kind'], position: { x: number; y: number }) => void;
}
function Canvas({
  graph,
  onChange,
  onSelect,
  selectedId,
  executions = noExecutions,
  visitedEdges = noEdges,
  onAdd,
}: Props) {
  const instance = useReactFlow();
  const [nodes, setNodes, changeNodes] = useNodesState<Node>([]);
  useEffect(() => {
    setNodes((current) => {
      const previous = new Map(current.map((node) => [node.id, node]));
      return graph.nodes.map((node) => ({
        ...previous.get(node.id),
        id: node.id,
        type: 'workflow',
        position: node.position,
        deletable: !!onChange && !['start', 'end'].includes(node.kind),
        selected: node.id === selectedId,
        data: {
          label: node.name,
          kind: node.kind,
          strategy: node.kind === 'approval' ? node.strategy : '',
          state: executions.find((e) => e.nodeId === node.id)?.status ?? 'idle',
        },
      }));
    });
  }, [graph.nodes, selectedId, executions, onChange, setNodes]);
  const edges = useMemo(
    () =>
      graph.edges.map((edge) => {
        const visited = visitedEdges.includes(edge.id);
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: edge.label,
          type: 'smoothstep',
          animated: visited,
          style: { stroke: visited ? '#2cb895' : '#bfcbdc', strokeWidth: visited ? 2.5 : 1.5 },
          labelStyle: { fill: visited ? '#188569' : '#8793a5', fontSize: 11 },
          labelBgStyle: { fill: '#f8fafc' },
          markerEnd: { type: MarkerType.ArrowClosed, color: visited ? '#2cb895' : '#bfcbdc' },
        };
      }),
    [graph.edges, visitedEdges],
  );
  const connect = (connection: Connection) => {
    if (onChange && connection.source && connection.target)
      onChange({
        ...graph,
        edges: [
          ...graph.edges,
          {
            id: crypto.randomUUID(),
            source: connection.source,
            target: connection.target,
            label: '新分支',
            condition: null,
          },
        ],
      });
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData('application/flowforge-node');
    if (['approval', 'condition', 'handling'].includes(kind))
      onAdd?.(
        kind as FlowNode['kind'],
        instance.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      );
  };
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onConnect={connect}
      onNodesChange={(changes) => {
        changeNodes(changes);
        const positions = changes.filter((c) => c.type === 'position' && c.position);
        const removed = new Set(changes.filter((c) => c.type === 'remove').map((c) => c.id));
        if (onChange && (positions.length || removed.size))
          onChange({
            ...graph,
            edges: graph.edges.filter(
              (edge) => !removed.has(edge.source) && !removed.has(edge.target),
            ),
            nodes: graph.nodes
              .filter((n) => !removed.has(n.id))
              .map((n) => {
                const change = positions.find((c) => c.type === 'position' && c.id === n.id);
                return change?.type === 'position' && change.position
                  ? { ...n, position: change.position }
                  : n;
              }),
          });
      }}
      onEdgesChange={(changes) => {
        const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id);
        if (onChange && removed.length)
          onChange({ ...graph, edges: graph.edges.filter((e) => !removed.includes(e.id)) });
      }}
      onNodeClick={(_, node) => onSelect?.(node.id)}
      onDrop={drop}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      nodesDraggable={!!onChange}
      nodesConnectable={!!onChange}
      edgesFocusable={!!onChange}
      deleteKeyCode={onChange ? ['Backspace', 'Delete'] : null}
      fitView
      fitViewOptions={{ padding: 0.22 }}
      minZoom={0.3}
      maxZoom={1.6}
      attributionPosition="bottom-right"
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#dce4ef" />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeColor={(node) => (node.data.state === 'COMPLETED' ? '#2cb895' : '#9eaff0')}
        maskColor="#edf2f780"
      />
    </ReactFlow>
  );
}
export function FlowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
