import { Position, getSmoothStepPath } from '@xyflow/react';
import type { Edge } from '@xyflow/react';
import type { TableNodeType } from './TableNode';
import { HEADER_HEIGHT, ROW_HEIGHT } from './diagramLayout';

export const CF_OFFSET = 20; // must match OFFSET in CrowsFootEdge

export const ROUTE_MARGIN = 16;
export const COLLISION_MARGIN = 10;
export const MIN_STUB = 30;

export function stubVx(vx: number, sx: number, tx: number, srcR: boolean, tgtL: boolean): number {
    if (srcR && tgtL) {
        if (sx + MIN_STUB * 2 >= tx) return (sx + tx) / 2;
        return Math.max(sx + MIN_STUB, Math.min(vx, tx - MIN_STUB));
    }
    if (!srcR && !tgtL) {
        if (tx + MIN_STUB * 2 >= sx) return (sx + tx) / 2;
        return Math.min(sx - MIN_STUB, Math.max(vx, tx + MIN_STUB));
    }
    if (srcR) return Math.max(vx, Math.max(sx, tx) + MIN_STUB);
    return Math.min(vx, Math.min(sx, tx) - MIN_STUB);
}

export function buildEdgePathD(
    sx: number, sy: number,
    tx: number, ty: number,
    srcR: boolean, tgtL: boolean,
    sourcePosition: Position, targetPosition: Position,
    vx: number | undefined, vy: number | undefined, vx2: number | undefined,
): { path: string; labelX: number; labelY: number } {
    if (vx !== undefined && vy !== undefined && vx2 !== undefined) {
        const rvx  = srcR  ? Math.max(vx,  sx + MIN_STUB) : Math.min(vx,  sx - MIN_STUB);
        const rvx2 = tgtL  ? Math.min(vx2, tx - MIN_STUB) : Math.max(vx2, tx + MIN_STUB);
        return {
            path: `M ${sx} ${sy} L ${rvx} ${sy} L ${rvx} ${vy} L ${rvx2} ${vy} L ${rvx2} ${ty} L ${tx} ${ty}`,
            labelX: (rvx + rvx2) / 2,
            labelY: vy,
        };
    }
    if (vx !== undefined) {
        const rvx = stubVx(vx, sx, tx, srcR, tgtL);
        return {
            path: `M ${sx} ${sy} L ${rvx} ${sy} L ${rvx} ${ty} L ${tx} ${ty}`,
            labelX: rvx,
            labelY: (sy + ty) / 2,
        };
    }
    const [path, labelX, labelY] = getSmoothStepPath({
        sourceX: sx, sourceY: sy, sourcePosition,
        targetX: tx, targetY: ty, targetPosition,
        borderRadius: 0,
    });
    return { path, labelX, labelY };
}

export function findVxHandle(pts: [number, number][]): { handleX: number; handleMidY: number } | null {
    for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[i + 1];
        if (Math.abs(x1 - x2) < 0.5 && Math.abs(y1 - y2) > 4) {
            return { handleX: x1, handleMidY: (y1 + y2) / 2 };
        }
    }
    return null;
}

export type CrossPoint = { x: number; y: number };

export function getHandlePos(
    nodes: TableNodeType[],
    nodeId: string,
    handleId: string,
): { x: number; y: number; pos: Position } | null {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return null;
    const colName = handleId.replace(/-[st][lr]$/, '');
    const isRight = handleId.endsWith('r');
    const idx = node.data.columns.findIndex(c => c.name === colName);
    if (idx < 0) return null;
    return {
        x: isRight ? node.position.x + node.data.width : node.position.x,
        y: node.position.y + HEADER_HEIGHT + idx * ROW_HEIGHT + ROW_HEIGHT / 2,
        pos: isRight ? Position.Right : Position.Left,
    };
}

export function parseCrossingPts(d: string): [number, number][] {
    const pts: [number, number][] = [];
    const re = /[ML]\s*([-\d.e+]+)[,\s]+([-\d.e+]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(d)) !== null) pts.push([+m[1], +m[2]]);
    return pts;
}

export function computeCrossings(nodes: TableNodeType[], edges: Edge[]): Map<string, CrossPoint[]> {
    type PathInfo = { id: string; segs: { x1: number; y1: number; x2: number; y2: number }[] };
    const infos: PathInfo[] = [];

    for (const edge of edges) {
        if (edge.type !== 'crowsfoot' || !edge.sourceHandle || !edge.targetHandle) continue;
        const src = getHandlePos(nodes, edge.source, edge.sourceHandle);
        const tgt = getHandlePos(nodes, edge.target, edge.targetHandle);
        if (!src || !tgt) continue;
        const edgeData = edge.data as { vx?: number; vy?: number; vx2?: number } | undefined;
        const vx = edgeData?.vx;
        const vy = edgeData?.vy;
        const vx2 = edgeData?.vx2;
        const srcOff = src.pos === Position.Right ? CF_OFFSET : -CF_OFFSET;
        const tgtOff = tgt.pos === Position.Left ? -CF_OFFSET : CF_OFFSET;
        const sx = src.x + srcOff, tx = tgt.x + tgtOff;
        const srcR = src.pos === Position.Right, tgtL = tgt.pos === Position.Left;
        const { path: d } = buildEdgePathD(sx, src.y, tx, tgt.y, srcR, tgtL, src.pos, tgt.pos, vx, vy, vx2);
        const pts = parseCrossingPts(d);
        const segs = [];
        for (let i = 0; i < pts.length - 1; i++) {
            segs.push({ x1: pts[i][0], y1: pts[i][1], x2: pts[i + 1][0], y2: pts[i + 1][1] });
        }
        infos.push({ id: edge.id, segs });
    }

    const result = new Map<string, CrossPoint[]>();

    for (let i = 0; i < infos.length; i++) {
        for (let j = 0; j < infos.length; j++) {
            if (i === j) continue;
            for (const sA of infos[i].segs) {
                if (Math.abs(sA.y1 - sA.y2) > 0.5) continue; // only H segs of A
                for (const sB of infos[j].segs) {
                    if (Math.abs(sB.x1 - sB.x2) > 0.5) continue; // only V segs of B
                    const x = sB.x1, y = sA.y1;
                    const loAx = Math.min(sA.x1, sA.x2), hiAx = Math.max(sA.x1, sA.x2);
                    const loBy = Math.min(sB.y1, sB.y2), hiBy = Math.max(sB.y1, sB.y2);
                    if (x > loAx && x < hiAx && y > loBy && y < hiBy) {
                        if (!result.has(infos[i].id)) result.set(infos[i].id, []);
                        result.get(infos[i].id)!.push({ x, y });
                    }
                }
            }
        }
    }

    // Deduplicate crossing points per edge
    for (const [id, pts] of result) {
        const seen = new Set<string>();
        result.set(id, pts.filter(p => {
            const k = `${Math.round(p.x)},${Math.round(p.y)}`;
            return seen.has(k) ? false : (seen.add(k), true);
        }));
    }

    return result;
}

export function resolveCollisions(nodes: TableNodeType[]): TableNodeType[] {
    type Box = { x: number; y: number; w: number; h: number; node: TableNodeType; moved: boolean };
    const m = COLLISION_MARGIN;
    const boxes: Box[] = nodes.map(n => ({
        x: n.position.x - m,
        y: n.position.y - m,
        w: n.data.width + m * 2,
        h: HEADER_HEIGHT + n.data.columns.length * ROW_HEIGHT + m * 2,
        node: n,
        moved: false,
    }));

    for (let iter = 0; iter < 50; iter++) {
        let anyMoved = false;
        for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
                const A = boxes[i], B = boxes[j];
                const dx = (A.x + A.w * 0.5) - (B.x + B.w * 0.5);
                const dy = (A.y + A.h * 0.5) - (B.y + B.h * 0.5);
                const px = (A.w + B.w) * 0.5 - Math.abs(dx);
                const py = (A.h + B.h) * 0.5 - Math.abs(dy);
                if (px > 0.5 && py > 0.5) {
                    A.moved = B.moved = anyMoved = true;
                    if (px < py) {
                        const s = dx > 0 ? 1 : -1;
                        A.x += (px / 2) * s; B.x -= (px / 2) * s;
                    } else {
                        const s = dy > 0 ? 1 : -1;
                        A.y += (py / 2) * s; B.y -= (py / 2) * s;
                    }
                }
            }
        }
        if (!anyMoved) break;
    }

    return boxes.map(box => box.moved
        ? { ...box.node, position: { x: box.x + m, y: box.y + m } }
        : box.node
    );
}

export function routeEdgesInGraph(nodes: TableNodeType[], edges: Edge[]): Edge[] {
    const bounds = new Map(nodes.map(n => [n.id, {
        x: n.position.x, y: n.position.y,
        w: n.data.width,
        h: HEADER_HEIGHT + n.data.columns.length * ROW_HEIGHT,
    }]));
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    return edges.map(edge => {
        if (!edge.sourceHandle || !edge.targetHandle) return edge;

        const edgeData = (edge.data ?? {}) as Record<string, unknown>;
        const existingVx = edgeData.vx as number | undefined;
        const existingVy = edgeData.vy as number | undefined;

        const src = bounds.get(edge.source);
        const tgt = bounds.get(edge.target);
        if (!src || !tgt) return edge;

        const srcNode = nodeMap.get(edge.source)!;
        const tgtNode = nodeMap.get(edge.target)!;
        const srcColName = edge.sourceHandle.replace(/-s[lr]$/, '');
        const tgtColName = edge.targetHandle.replace(/-t[lr]$/, '');
        const srcColIdx = srcNode.data.columns.findIndex(c => c.name === srcColName);
        const tgtColIdx = tgtNode.data.columns.findIndex(c => c.name === tgtColName);
        if (srcColIdx < 0 || tgtColIdx < 0) return edge;

        const srcIsRight = edge.sourceHandle.endsWith('r');
        const srcEdgeX = srcIsRight ? src.x + src.w : src.x;
        const tgtIsLeft = edge.targetHandle.endsWith('l');
        const tgtEdgeX = tgtIsLeft ? tgt.x : tgt.x + tgt.w;

        const srcCenterX = src.x + src.w / 2;
        const tgtCenterX = tgt.x + tgt.w / 2;
        // Derive correct handles from the actual vx position (may differ from node-relative flip)
        const handlesForVx = (vxSrc: number, vxTgt = vxSrc) => ({
            sourceHandle: `${srcColName}-s${vxSrc > srcCenterX ? 'r' : 'l'}`,
            targetHandle: `${tgtColName}-t${vxTgt < tgtCenterX ? 'l' : 'r'}`,
        });

        const srcY = src.y + HEADER_HEIGHT + srcColIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
        const tgtY = tgt.y + HEADER_HEIGHT + tgtColIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
        const minY = Math.min(srcY, tgtY) - ROUTE_MARGIN;
        const maxY = Math.max(srcY, tgtY) + ROUTE_MARGIN;

        const isClear = (vx: number): boolean => {
            const h1xMin = Math.min(srcEdgeX, vx) - ROUTE_MARGIN;
            const h1xMax = Math.max(srcEdgeX, vx) + ROUTE_MARGIN;
            const h2xMin = Math.min(vx, tgtEdgeX) - ROUTE_MARGIN;
            const h2xMax = Math.max(vx, tgtEdgeX) + ROUTE_MARGIN;
            for (const [id, b] of bounds) {
                const bx2 = b.x + b.w;
                const by2 = b.y + b.h;
                if (vx > b.x - ROUTE_MARGIN && vx < bx2 + ROUTE_MARGIN &&
                    maxY > b.y && minY < by2) {
                    return false;
                }
                if (id === edge.source || id === edge.target) continue;
                if (srcY > b.y - ROUTE_MARGIN && srcY < by2 + ROUTE_MARGIN &&
                    h1xMax > b.x && h1xMin < bx2) {
                    return false;
                }
                if (tgtY > b.y - ROUTE_MARGIN && tgtY < by2 + ROUTE_MARGIN &&
                    h2xMax > b.x && h2xMin < bx2) {
                    return false;
                }
            }
            return true;
        };

        // Keep existing 3-seg vx if still clear (skip if currently in detour mode)
        if (existingVy === undefined && existingVx !== undefined && isClear(existingVx)) {
            return edge;
        }

        const left = Math.min(srcEdgeX, tgtEdgeX);
        const right = Math.max(srcEdgeX, tgtEdgeX);
        const defaultVx = (srcEdgeX + tgtEdgeX) / 2;

        // Remove stale routing when default corridor is now clear
        if (isClear(defaultVx)) {
            if (existingVx === undefined && existingVy === undefined) return edge;
            const { vx: _v, vxManual: _m, vy: _vy, vx2: _vx2, ...rest } = edgeData;
            return { ...edge, data: rest };
        }

        // Force-reroute (3-seg) — strip all previous routing overrides
        const { vxManual: _m, vy: _vy, vx2: _vx2, ...baseData } = edgeData;
        const STEP = 10;
        for (let d = STEP; d <= (right - left) / 2; d += STEP) {
            const newVx = defaultVx + d;
            if (isClear(newVx)) return { ...edge, ...handlesForVx(newVx), data: { ...baseData, vx: newVx } };
            const newVxN = defaultVx - d;
            if (isClear(newVxN)) return { ...edge, ...handlesForVx(newVxN), data: { ...baseData, vx: newVxN } };
        }
        for (let offset = STEP; offset <= 400; offset += STEP) {
            const newVxL = left - offset;
            if (isClear(newVxL)) return { ...edge, ...handlesForVx(newVxL), data: { ...baseData, vx: newVxL } };
            const newVxR = right + offset;
            if (isClear(newVxR)) return { ...edge, ...handlesForVx(newVxR), data: { ...baseData, vx: newVxR } };
        }

        // 3-seg exhausted — try 5-segment U-detour around the trapping obstacle
        for (const [id, b] of bounds) {
            if (id === edge.source || id === edge.target) continue;
            const by2 = b.y + b.h;
            if (srcY > b.y - ROUTE_MARGIN && srcY < by2 + ROUTE_MARGIN &&
                tgtY > b.y - ROUTE_MARGIN && tgtY < by2 + ROUTE_MARGIN) {
                const bx2 = b.x + b.w;
                const detourVx1 = b.x - ROUTE_MARGIN - 5;
                const detourVx2 = bx2 + ROUTE_MARGIN + 5;
                const vy = srcY - b.y < by2 - srcY
                    ? b.y - ROUTE_MARGIN - 20
                    : by2 + ROUTE_MARGIN + 20;
                return { ...edge, ...handlesForVx(detourVx1, detourVx2), data: { ...baseData, vx: detourVx1, vy, vx2: detourVx2 } };
            }
        }

        const { vx: _v2, vxManual: _m2, vy: _vy2, vx2: _vx22, ...rest } = edgeData;
        return { ...edge, data: rest };
    });
}