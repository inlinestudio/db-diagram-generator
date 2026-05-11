import { useState } from 'react';
import { EdgeLabelRenderer, Position } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import { useEdgeVxDrag } from './CrowsFootEdge';
import { parseCrossingPts, buildEdgePathD, findVxHandle } from './edgeRouting';

export default function ArrowEdge({
    id, sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition, selected, label, data, markerEnd,
}: EdgeProps) {
    const stroke = selected ? 'var(--accent)' : 'var(--muted)';
    const [hovered, setHovered] = useState(false);
    const { onPointerDown: onHandlePointerDown, onPointerMove: onHandlePointerMove, onDblClick: onHandleDblClick } = useEdgeVxDrag(id);
    const edgeDataTyped = data as { vx?: number; vy?: number; vx2?: number } | undefined;
    const vx = edgeDataTyped?.vx;
    const vy = edgeDataTyped?.vy;
    const vx2 = edgeDataTyped?.vx2;

    const srcR = sourcePosition === Position.Right;
    const tgtL = targetPosition === Position.Left;

    const { path: d, labelX, labelY } = buildEdgePathD(
        sourceX, sourceY, targetX, targetY,
        srcR, tgtL,
        sourcePosition, targetPosition,
        vx, vy, vx2,
    );

    const pts = parseCrossingPts(d);
    let handleX: number | undefined, handleMidY: number | undefined;
    if (vy === undefined) {
        const h = findVxHandle(pts);
        if (h) { handleX = h.handleX; handleMidY = h.handleMidY; }
    }

    return (
        <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
            <path
                id={id}
                className="react-flow__edge-path"
                d={d}
                fill="none"
                stroke={stroke}
                strokeWidth={1.5}
                markerEnd={markerEnd}
            />
            <path d={d} fill="none" stroke="transparent" strokeWidth={20} />
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
                    <div style={{
                        position: 'absolute',
                        transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
                        fontSize: 11,
                        color: stroke,
                        pointerEvents: 'none',
                    }}>
                        {String(label)}
                    </div>
                </EdgeLabelRenderer>
            )}
        </g>
    );
}