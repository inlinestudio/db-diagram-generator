import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  MarkerType
} from '@xyflow/react';
import type { Edge } from '@xyflow/react';
import dagre from 'dagre';
import { toPng } from 'html-to-image';
import type { DiagramPayload, TableSchema } from '@shared/schema';
import TableNode, { type TableNodeType } from './TableNode';

const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 40;
const MIN_NODE_WIDTH = 280;
const MAX_NODE_WIDTH = 600;
const HORIZ_PADDING = 24;
const BADGE_WIDTH = 18;
const BADGE_GAP = 4;
const NAME_BADGE_GAP = 6;
const NAME_TYPE_GAP = 12;
const HEADER_FONT = "600 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const NAME_FONT = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const TYPE_FONT = "11px ui-monospace, SFMono-Regular, monospace";

let measureCtx: CanvasRenderingContext2D | null = null;
function measureWidth(text: string, font: string): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 7;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

function computeNodeWidth(table: TableSchema, fkColumns: Set<string>): number {
  const headerText = `${table.schema ? table.schema + '.' : ''}${table.name}`;
  let widest = HORIZ_PADDING + measureWidth(headerText, HEADER_FONT);
  for (const col of table.columns) {
    let badgeCount = 0;
    if (col.isPrimaryKey) badgeCount++;
    if (fkColumns.has(col.name)) badgeCount++;
    if (col.isUnique && !col.isPrimaryKey) badgeCount++;
    const badgeW =
      badgeCount > 0 ? badgeCount * BADGE_WIDTH + (badgeCount - 1) * BADGE_GAP + NAME_BADGE_GAP : 0;
    const nameW = measureWidth(col.name, NAME_FONT);
    const typeW = measureWidth(`${col.dataType}${col.nullable ? '' : ' NOT NULL'}`, TYPE_FONT);
    const rowW = HORIZ_PADDING + badgeW + nameW + NAME_TYPE_GAP + typeW;
    if (rowW > widest) widest = rowW;
  }
  return Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, Math.ceil(widest)));
}

const nodeTypes = { table: TableNode };

type Props = { payload: DiagramPayload };

export default function Diagram(props: Props) {
  return (
    <ReactFlowProvider>
      <DiagramInner {...props} />
    </ReactFlowProvider>
  );
}

function tableKey(t: { schema: string | null; name: string }) {
  return `${t.schema ?? ''}.${t.name}`;
}

function DiagramInner({ payload }: Props) {
  const flowRef = useRef<HTMLDivElement>(null);
  const { fitView } = useReactFlow();
  const [snap, setSnap] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [filterSearch, setFilterSearch] = useState('');

  const filteredPayload = useMemo<DiagramPayload>(() => {
    if (selectedKeys.size === 0) return payload;
    const tables = payload.tables.filter((t) => selectedKeys.has(tableKey(t)));
    return { tables, rootKey: payload.rootKey };
  }, [payload, selectedKeys]);

  const { initialNodes, initialEdges } = useMemo(() => buildGraph(filteredPayload), [filteredPayload]);
  const [nodes, setNodes, onNodesChange] = useNodesState<TableNodeType>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    const id = requestAnimationFrame(() => fitView({ padding: 0.2 }));
    return () => cancelAnimationFrame(id);
  }, [initialNodes, initialEdges, setNodes, setEdges, fitView]);

  const exportPng = useCallback(async () => {
    if (!flowRef.current) return;
    const container = flowRef.current.querySelector('.react-flow') as HTMLElement | null;
    if (!container) return;

    fitView({ padding: 0.1, duration: 0 });
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

    const dataUrl = await toPng(container, {
      backgroundColor: '#ffffff',
      pixelRatio: 2,
      filter: (n) => {
        if (!(n instanceof HTMLElement)) return true;
        const cls = n.classList;
        return (
          !cls.contains('react-flow__minimap') &&
          !cls.contains('react-flow__controls') &&
          !cls.contains('react-flow__panel') &&
          !cls.contains('react-flow__attribution')
        );
      }
    });
    const link = document.createElement('a');
    link.download = 'schema.png';
    link.href = dataUrl;
    link.click();
  }, [fitView]);

  const allTables = payload.tables;
  const filterMatches = useMemo(() => {
    const q = filterSearch.trim().toLowerCase();
    if (!q) return allTables;
    return allTables.filter((t) => tableKey(t).toLowerCase().includes(q));
  }, [allTables, filterSearch]);

  const toggleKey = (k: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  return (
    <div className="diagram-wrap">
      <div className="diagram-toolbar">
        <details className="filter-dropdown">
          <summary>
            Filter:{' '}
            <strong>
              {selectedKeys.size === 0 ? 'All tables' : `${selectedKeys.size} selected`}
            </strong>
          </summary>
          <div className="filter-panel">
            <input
              type="search"
              placeholder="Search…"
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
            />
            <div className="filter-actions">
              <button
                type="button"
                className="btn-link"
                onClick={() => setSelectedKeys(new Set(allTables.map(tableKey)))}
              >
                Select all
              </button>
              <button
                type="button"
                className="btn-link"
                onClick={() => setSelectedKeys(new Set())}
              >
                Clear
              </button>
            </div>
            <ul className="filter-list">
              {filterMatches.map((t) => {
                const k = tableKey(t);
                return (
                  <li key={k}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedKeys.has(k)}
                        onChange={() => toggleKey(k)}
                      />
                      {t.schema && <span className="schema">{t.schema}.</span>}
                      <span className="name">{t.name}</span>
                    </label>
                  </li>
                );
              })}
              {filterMatches.length === 0 && <li className="empty">No tables match.</li>}
            </ul>
          </div>
        </details>
        <span className="title">
          {filteredPayload.tables.length} of {allTables.length} table
          {allTables.length === 1 ? '' : 's'}
        </span>
        <button onClick={exportPng}>Export PNG</button>
      </div>
      <div ref={flowRef} className="diagram">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          snapToGrid={snap}
          snapGrid={[20, 20]}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls>
            <ControlButton
              onClick={() => setSnap((s) => !s)}
              title={snap ? 'Snap to grid: on' : 'Snap to grid: off'}
              className={snap ? 'snap-on' : ''}
            >
              <svg
                viewBox="0 0 16 16"
                width="12"
                height="12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M2 6h12M2 10h12M6 2v12M10 2v12" />
              </svg>
            </ControlButton>
          </Controls>
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  );
}

function buildGraph(payload: DiagramPayload): { initialNodes: TableNodeType[]; initialEdges: Edge[] } {
  const seen = new Map<string, TableSchema>();
  for (const t of payload.tables) {
    const key = tableKey(t);
    if (!seen.has(key)) seen.set(key, t);
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120 });
  g.setDefaultEdgeLabel(() => ({}));

  const widths = new Map<string, number>();
  for (const [key, t] of seen) {
    const fkCols = new Set<string>();
    for (const fk of t.foreignKeys) for (const c of fk.columns) fkCols.add(c);
    const w = computeNodeWidth(t, fkCols);
    widths.set(key, w);
    g.setNode(key, { width: w, height: HEADER_HEIGHT + t.columns.length * ROW_HEIGHT });
  }

  const referencedColumnsMap = new Map<string, Set<string>>();
  const connectedFkColumnsMap = new Map<string, Set<string>>();
  const edges: Edge[] = [];
  let edgeId = 0;
  for (const [key, t] of seen) {
    for (const fk of t.foreignKeys) {
      const target = `${fk.refSchema ?? ''}.${fk.refTable}`;
      if (!seen.has(target)) continue;
      g.setEdge(key, target);
      edges.push({
        id: `e${edgeId++}`,
        source: key,
        target,
        sourceHandle: `${fk.columns[0]}-r`,
        targetHandle: `${fk.refColumns[0]}-l`,
        markerEnd: { type: MarkerType.ArrowClosed },
        label: fk.columns.length > 1 ? `(${fk.columns.join(', ')})` : undefined
      });
      if (!connectedFkColumnsMap.has(key)) connectedFkColumnsMap.set(key, new Set());
      for (const c of fk.columns) connectedFkColumnsMap.get(key)!.add(c);
      if (!referencedColumnsMap.has(target)) referencedColumnsMap.set(target, new Set());
      for (const c of fk.refColumns) referencedColumnsMap.get(target)!.add(c);
    }
  }

  dagre.layout(g);

  const nodes: TableNodeType[] = [...seen.entries()].map(([key, t]) => {
    const pos = g.node(key);
    const fkColumns = new Set<string>();
    for (const fk of t.foreignKeys) for (const c of fk.columns) fkColumns.add(c);
    const width = widths.get(key) ?? MIN_NODE_WIDTH;
    return {
      id: key,
      type: 'table',
      position: {
        x: pos.x - width / 2,
        y: pos.y - (HEADER_HEIGHT + t.columns.length * ROW_HEIGHT) / 2
      },
      data: {
        schema: t.schema,
        name: t.name,
        columns: t.columns,
        fkColumns,
        connectedFkColumns: connectedFkColumnsMap.get(key) ?? new Set(),
        referencedColumns: referencedColumnsMap.get(key) ?? new Set(),
        isRoot: payload.rootKey === key,
        width
      }
    };
  });

  return { initialNodes: nodes, initialEdges: edges };
}
