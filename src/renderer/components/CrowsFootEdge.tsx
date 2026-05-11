import { createContext, useContext, useState, useCallback } from 'react';
import { getSmoothStepPath, EdgeLabelRenderer, useReactFlow, Position, type EdgeProps } from '@xyflow/react';

const OFFSET = 20;
const CF_SPREAD = 7;
const BAR_HALF = 7;
const JUMP_R = 6;

type Point = { x: number; y: number };
export const CrossingsCtx = createContext<Map<string, Point[]>>(new Map());

function parsePts(d: string): [number, number][] {
    const pts: [number, number][] = [];
    const re = /[ML]\s*([-\d.e+]+)[,\s]+([-\d.e+]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(d)) !== null) pts.push([+m[1], +m[2]]);
    return pts;
}

function applyJumps(d: string, crosses: Point[]): string {
    if (!crosses.length) return d;
    const pts = parsePts(d);
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
    const { setEdges, screenToFlowPosition, getNodes } = useReactFlow();
    const [hovered, setHovered] = useState(false);

    const vx = (data as { vx?: number } | undefined)?.vx;

    const srcOff = sourcePosition === Position.Right ? OFFSET : -OFFSET;
    const tgtOff = targetPosition === Position.Left ? -OFFSET : OFFSET;

    let rawPath: string;
    let labelX: number, labelY: number;

    if (vx !== undefined) {
        const sx = sourceX + srcOff, tx = targetX + tgtOff;
        rawPath = `M ${sx} ${sourceY} L ${vx} ${sourceY} L ${vx} ${targetY} L ${tx} ${targetY}`;
        labelX = vx;
        labelY = (sourceY + targetY) / 2;
    } else {
        [rawPath, labelX, labelY] = getSmoothStepPath({
            sourceX: sourceX + srcOff,
            sourceY,
            sourcePosition,
            targetX: targetX + tgtOff,
            targetY,
            targetPosition,
            borderRadius: 0,
        });
    }

    const edgePath = applyJumps(rawPath, allCrossings.get(id) ?? []);

    // Find the first substantial vertical segment for the drag handle
    const pts = parsePts(rawPath);
    let handleX: number | undefined, handleMidY: number | undefined;
    for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[i + 1];
        if (Math.abs(x1 - x2) < 0.5 && Math.abs(y1 - y2) > 4) {
            handleX = x1;
            handleMidY = (y1 + y2) / 2;
            break;
        }
    }

    const onHandlePointerDown = useCallback((e: React.PointerEvent<SVGCircleElement>) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
    }, []);

    const onHandlePointerMove = useCallback((e: React.PointerEvent<SVGCircleElement>) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const newVx = screenToFlowPosition({ x: e.clientX, y: e.clientY }).x;
        setEdges(eds => eds.map(ed => {
            if (ed.id !== id) return ed;
            const newData = { ...(ed.data ?? {}), vx: newVx };
            if (!ed.sourceHandle || !ed.targetHandle) return { ...ed, data: newData };
            const nodes = getNodes();
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
        }));
    }, [id, setEdges, screenToFlowPosition, getNodes]);

    const onHandleDblClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setEdges(eds => eds.map(ed => {
            if (ed.id !== id) return ed;
            const { vx: _removed, ...rest } = (ed.data ?? {}) as Record<string, unknown>;
            return { ...ed, data: rest };
        }));
    }, [id, setEdges]);

    // Crow's foot (many) at source — direction depends on which side the handle is on
    const cSign = sourcePosition === Position.Right ? 1 : -1;
    const crowsPath = [
        `M ${sourceX + 10 * cSign} ${sourceY} L ${sourceX} ${sourceY - CF_SPREAD}`,
        `M ${sourceX + 10 * cSign} ${sourceY} L ${sourceX} ${sourceY}`,
        `M ${sourceX + 10 * cSign} ${sourceY} L ${sourceX} ${sourceY + CF_SPREAD}`,
        `M ${sourceX + 15 * cSign} ${sourceY - BAR_HALF} L ${sourceX + 15 * cSign} ${sourceY + BAR_HALF}`,
    ].join(' ');

    // "One" (exactly one) at target
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
