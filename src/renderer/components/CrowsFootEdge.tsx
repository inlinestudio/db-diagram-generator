import { createContext, useContext, useState, useCallback } from 'react';
import { EdgeLabelRenderer, useReactFlow, Position, type EdgeProps } from '@xyflow/react';
import { routeEdgesInGraph, parseCrossingPts, buildEdgePathD, findVxHandle } from './edgeRouting';
import type { TableNodeType } from './TableNode';

const OFFSET = 20;
const CF_SPREAD = 7;
const BAR_HALF = 7;
const JUMP_R = 6;

type Point = { x: number; y: number };
export const CrossingsCtx = createContext<Map<string, Point[]>>(new Map());

// Remove intermediate collinear points on horizontal runs so that a degenerate
// path like M sx sy L vx sy L vx sy L tx sy (sy==ty) is treated as one segment.
function mergeCollinearH(pts: [number, number][]): [number, number][] {
    if (pts.length < 3) return pts;
    const out: [number, number][] = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
        const prev = out[out.length - 1];
        const curr = pts[i];
        const next = pts[i + 1];
        if (Math.abs(prev[1] - curr[1]) < 0.5 && Math.abs(curr[1] - next[1]) < 0.5) continue;
        out.push(curr);
    }
    out.push(pts[pts.length - 1]);
    return out;
}

function applyJumps(d: string, crosses: Point[]): string {
    if (!crosses.length) return d;
    const pts = mergeCollinearH(parseCrossingPts(d));
    if (pts.length < 2) return d;
    let out = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[i + 1];
        if (Math.abs(y1 - y2) > 0.5) {
            out += ` L ${x2} ${y2}`;
            continue;
        }
        const dir = x2 > x1 ? 1 : -1;
        const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
        const hits = crosses
            .filter(c => c.x > lo + JUMP_R && c.x < hi - JUMP_R && Math.abs(c.y - y1) < 1)
            .sort((a, b) => dir * (a.x - b.x));
        for (const c of hits) {
            out += ` L ${c.x - dir * JUMP_R} ${y1}`;
            out += ` A ${JUMP_R} ${JUMP_R} 0 0 ${dir > 0 ? 0 : 1} ${c.x + dir * JUMP_R} ${y1}`;
        }
        out += ` L ${x2} ${y2}`;
    }
    return out;
}

export function useEdgeVxDrag(id: string) {
    const { setEdges, screenToFlowPosition, getNodes } = useReactFlow();

    const onPointerDown = useCallback((e: React.PointerEvent<SVGCircleElement>) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
    }, []);

    const onPointerMove = useCallback((e: React.PointerEvent<SVGCircleElement>) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const rawVx = screenToFlowPosition({ x: e.clientX, y: e.clientY }).x;
        const nodes = getNodes() as TableNodeType[];
        setEdges(eds => {
            // Push vx away from other edges' vx — coincident V segments break arch detection
            const MIN_VX_SEP = 14; // > 2 * JUMP_R = 12
            const newVx = eds.reduce((v, ed) => {
                if (ed.id === id) return v;
                const ov = (ed.data as { vx?: number } | undefined)?.vx;
                if (ov === undefined) return v;
                return Math.abs(v - ov) < MIN_VX_SEP ? ov + (v >= ov ? MIN_VX_SEP : -MIN_VX_SEP) : v;
            }, rawVx);
            const updated = eds.map(ed => {
                if (ed.id !== id) return ed;
                const newData = { ...(ed.data ?? {}), vx: newVx, vxManual: true };
                if (!ed.sourceHandle || !ed.targetHandle) return { ...ed, data: newData };
                const srcNode = nodes.find(n => n.id === ed.source);
                const tgtNode = nodes.find(n => n.id === ed.target);
                if (!srcNode || !tgtNode) return { ...ed, data: newData };
                const srcW = (srcNode.data as { width?: number }).width ?? (srcNode.measured?.width ?? 0);
                const tgtW = (tgtNode.data as { width?: number }).width ?? (tgtNode.measured?.width ?? 0);
                const srcCx = srcNode.position.x + srcW / 2;
                const tgtCx = tgtNode.position.x + tgtW / 2;
                const srcCol = ed.sourceHandle.replace(/-s[lr]$/, '');
                const tgtCol = ed.targetHandle.replace(/-t[lr]$/, '');
                const newSrcHandle = `${srcCol}-s${srcCx < newVx ? 'r' : 'l'}`;
                const newTgtHandle = `${tgtCol}-t${tgtCx > newVx ? 'l' : 'r'}`;
                return { ...ed, data: newData, sourceHandle: newSrcHandle, targetHandle: newTgtHandle };
            });
            return routeEdgesInGraph(nodes, updated);
        });
    }, [id, setEdges, screenToFlowPosition, getNodes]);

    const onDblClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setEdges(eds => eds.map(ed => {
            if (ed.id !== id) return ed;
            const { vx: _v, vxManual: _m, ...rest } = (ed.data ?? {}) as Record<string, unknown>;
            return { ...ed, data: rest };
        }));
    }, [id, setEdges]);

    return { onPointerDown, onPointerMove, onDblClick };
}

export default function CrowsFootEdge({
    id,
    sourceX, sourceY,
    targetX, targetY,
    sourcePosition, targetPosition,
    selected,
    label,
    data,
}: EdgeProps) {
    const stroke = selected ? 'var(--accent)' : 'var(--muted)';
    const allCrossings = useContext(CrossingsCtx);
    const [hovered, setHovered] = useState(false);
    const { onPointerDown: onHandlePointerDown, onPointerMove: onHandlePointerMove, onDblClick: onHandleDblClick } = useEdgeVxDrag(id);

    const edgeDataTyped = data as { vx?: number; vy?: number; vx2?: number } | undefined;
    const vx = edgeDataTyped?.vx;
    const vy = edgeDataTyped?.vy;
    const vx2 = edgeDataTyped?.vx2;

    const srcOff = sourcePosition === Position.Right ? OFFSET : -OFFSET;
    const tgtOff = targetPosition === Position.Left ? -OFFSET : OFFSET;
    const srcR = srcOff > 0, tgtL = tgtOff < 0;
    const { path: rawPath, labelX, labelY } = buildEdgePathD(
        sourceX + srcOff, sourceY,
        targetX + tgtOff, targetY,
        srcR, tgtL,
        sourcePosition, targetPosition,
        vx, vy, vx2,
    );

    const edgePath = applyJumps(rawPath, allCrossings.get(id) ?? []);

    const pts = parseCrossingPts(rawPath);
    let handleX: number | undefined, handleMidY: number | undefined;
    // No drag handle in 5-seg detour mode — vx alone doesn't describe the path
    if (vy === undefined) {
        const h = findVxHandle(pts);
        if (h) { handleX = h.handleX; handleMidY = h.handleMidY; }
    }

    const cSign = sourcePosition === Position.Right ? 1 : -1;
    const crowsPath = [
        `M ${sourceX + 10 * cSign} ${sourceY} L ${sourceX} ${sourceY - CF_SPREAD}`,
        `M ${sourceX + 10 * cSign} ${sourceY} L ${sourceX} ${sourceY}`,
        `M ${sourceX + 10 * cSign} ${sourceY} L ${sourceX} ${sourceY + CF_SPREAD}`,
        `M ${sourceX + 15 * cSign} ${sourceY - BAR_HALF} L ${sourceX + 15 * cSign} ${sourceY + BAR_HALF}`,
    ].join(' ');

    const oSign = targetPosition === Position.Left ? -1 : 1;
    const onePath = [
        `M ${targetX + 10 * oSign} ${targetY - BAR_HALF} L ${targetX + 10 * oSign} ${targetY + BAR_HALF}`,
        `M ${targetX + 15 * oSign} ${targetY - BAR_HALF} L ${targetX + 15 * oSign} ${targetY + BAR_HALF}`,
    ].join(' ');

    return (
        <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
            <path
                id={id}
                className="react-flow__edge-path"
                d={edgePath}
                fill="none"
                stroke={stroke}
                strokeWidth={1.5}
            />
            <path d={edgePath} fill="none" stroke="transparent" strokeWidth={20} />
            <path d={crowsPath} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" />
            <path d={onePath} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" />
            {(hovered || selected) && handleX !== undefined && handleMidY !== undefined && (
                <circle
                    cx={handleX}
                    cy={handleMidY}
                    r={5}
                    fill={stroke}
                    stroke="var(--bg)"
                    strokeWidth={1.5}
                    style={{ cursor: 'ew-resize', pointerEvents: 'all' }}
                    onPointerDown={onHandlePointerDown}
                    onPointerMove={onHandlePointerMove}
                    onDoubleClick={onHandleDblClick}
                />
            )}
            {label && (
                <EdgeLabelRenderer>
                    <div
                        style={{
                            position: 'absolute',
                            transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
                            fontSize: 11,
                            color: stroke,
                            pointerEvents: 'none',
                        }}
                    >
                        {String(label)}
                    </div>
                </EdgeLabelRenderer>
            )}
        </g>
    );
}