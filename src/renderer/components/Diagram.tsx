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
} from '@xyflow/react';
import type { Edge, NodeChange, NodePositionChange } from '@xyflow/react';
import { toPng } from 'html-to-image';
import type { DiagramPayload } from '@shared/schema';
import TableNode, { type TableNodeType } from './TableNode';
import CrowsFootEdge, { CrossingsCtx } from './CrowsFootEdge';
import { buildGraph, tableKey } from './diagramLayout';
import { computeCrossings, resolveCollisions, routeEdgesInGraph } from './edgeRouting';
import type { CrossPoint } from './edgeRouting';

const nodeTypes = { table: TableNode };
const edgeTypes = { crowsfoot: CrowsFootEdge };

type Props = { payload: DiagramPayload };

export default function Diagram(props: Props) {
    return (
        <ReactFlowProvider>
            <DiagramInner {...props} />
        </ReactFlowProvider>
    );
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

    const { initialNodes, initialEdges } = useMemo(
        () => buildGraph(filteredPayload),
        [filteredPayload]
    );
    const [nodes, setNodes, onNodesChange] = useNodesState<TableNodeType>(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);

    const crossings = useMemo(
        () => computeCrossings(nodes, edges),
        [nodes, edges],
    );

    useEffect(() => {
        setNodes(initialNodes);
        setEdges(initialEdges);
        const id = requestAnimationFrame(() => fitView({ padding: 0.2 }));
        return () => cancelAnimationFrame(id);
    }, [initialNodes, initialEdges, setNodes, setEdges, fitView]);

    const onNodesChangeWithEdgeFlip = useCallback((changes: NodeChange<TableNodeType>[]) => {
        onNodesChange(changes);

        const posChanges = changes.filter(
            (c): c is NodePositionChange => c.type === 'position' && (c as NodePositionChange).position != null,
        );
        if (!posChanges.length) return;

        const posMap = new Map(nodes.map(n => [n.id, n.position]));
        for (const c of posChanges) {
            if (c.position) posMap.set(c.id, c.position);
        }

        const updatedNodes = nodes.map(n => {
            const newPos = posMap.get(n.id);
            return newPos ? { ...n, position: newPos } : n;
        });

        setEdges(eds => {
            const flipped = eds.map(edge => {
                if (!edge.sourceHandle || !edge.targetHandle) return edge;
                const srcPos = posMap.get(edge.source);
                const tgtPos = posMap.get(edge.target);
                if (!srcPos || !tgtPos) return edge;
                const srcIsLeft = srcPos.x < tgtPos.x;
                const srcCol = edge.sourceHandle.replace(/-s[lr]$/, '');
                const tgtCol = edge.targetHandle.replace(/-t[lr]$/, '');
                const newSrc = `${srcCol}-s${srcIsLeft ? 'r' : 'l'}`;
                const newTgt = `${tgtCol}-t${srcIsLeft ? 'l' : 'r'}`;
                if (newSrc === edge.sourceHandle && newTgt === edge.targetHandle) return edge;
                const { vx: _v, vxManual: _m, ...restData } = (edge.data ?? {}) as Record<string, unknown>;
                return { ...edge, sourceHandle: newSrc, targetHandle: newTgt, data: restData };
            });
            return routeEdgesInGraph(updatedNodes, flipped);
        });
    }, [onNodesChange, nodes, setEdges]);

    const onNodeDragStop = useCallback((_: React.MouseEvent, _node: TableNodeType, draggedNodes: TableNodeType[]) => {
        console.debug(`[drag-stop] dragged=${draggedNodes.map(n => n.id).join(',')}`);
        const dragMap = new Map(draggedNodes.map(n => [n.id, n]));
        const merged = nodes.map(n => dragMap.has(n.id) ? { ...n, position: dragMap.get(n.id)!.position } : n);
        const resolved = resolveCollisions(merged);
        const movedIds = resolved.filter((n, i) => n.position.x !== merged[i].position.x || n.position.y !== merged[i].position.y).map(n => n.id);
        if (movedIds.length) console.debug(`[drag-stop] collision-resolved nodes: ${movedIds.join(',')}`);
        console.debug(`[drag-stop] calling routeEdgesInGraph`);
        setNodes(resolved);
        setEdges(eds => routeEdgesInGraph(resolved, eds));
    }, [nodes, setNodes, setEdges]);

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
        <CrossingsCtx.Provider value={crossings}>
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
                        onNodesChange={onNodesChangeWithEdgeFlip}
                        onEdgesChange={onEdgesChange}
                        onNodeDragStop={onNodeDragStop}
                        nodeTypes={nodeTypes}
                        edgeTypes={edgeTypes}
                        fitView
                        snapToGrid={snap}
                        snapGrid={[20, 20]}
                        elevateEdgesOnSelect
                        onEdgeClick={(e) => e.stopPropagation()}
                        proOptions={{ hideAttribution: true }}
                    >
                        <Background />
                        <Controls>
                            <ControlButton
                                onClick={() => setSnap((s) => !s)}
                                title={snap ? 'Snap to grid: on' : 'Snap to grid: off'}
                                className={snap ? 'snap-on' : ''}
                            >
                                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
                                    <path d="M2 6h12M2 10h12M6 2v12M10 2v12" />
                                </svg>
                            </ControlButton>
                        </Controls>
                        <MiniMap pannable zoomable />
                    </ReactFlow>
                </div>
            </div>
        </CrossingsCtx.Provider>
    );
}