import dagre from 'dagre';
import { MarkerType } from '@xyflow/react';
import type { Edge } from '@xyflow/react';
import type { DiagramPayload, TableSchema } from '@shared/schema';
import type { TableNodeType } from './TableNode';
import { routeEdgesInGraph } from './edgeRouting';

export const ROW_HEIGHT = 28;
export const HEADER_HEIGHT = 40;
export const MIN_NODE_WIDTH = 280;
export const MAX_NODE_WIDTH = 600;
export const HORIZ_PADDING = 24;
export const BADGE_WIDTH = 18;
export const BADGE_GAP = 4;
export const NAME_BADGE_GAP = 6;
export const NAME_TYPE_GAP = 12;
export const HEADER_FONT = "600 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
export const NAME_FONT = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
export const TYPE_FONT = "11px ui-monospace, SFMono-Regular, monospace";

let measureCtx: CanvasRenderingContext2D | null = null;
export function measureWidth(text: string, font: string): number {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    if (!measureCtx) return text.length * 7;
    measureCtx.font = font;
    return measureCtx.measureText(text).width;
}

export function buildUqLabelsAndGroups(uniqueConstraints: string[][]): {
    labels: Map<string, string>;
    groups: Map<string, string[]>;
} {
    const labels = new Map<string, string>();
    const groups = new Map<string, string[]>();
    let compositeIdx = 0;
    for (const group of uniqueConstraints) {
        const isComposite = group.length > 1;
        if (isComposite) compositeIdx++;
        const label = isComposite ? `UQK${compositeIdx}` : 'UQK';
        for (const col of group) labels.set(col, label);
        if (isComposite) groups.set(label, group);
    }
    return { labels, groups };
}

export function badgePx(label: string): number {
    return label.length <= 2 ? BADGE_WIDTH : BADGE_WIDTH + 6;
}

export function computeNodeWidth(table: TableSchema, fkColumns: Set<string>, uqLabels: Map<string, string>): number {
    const headerText = `${table.schema ? table.schema + '.' : ''}${table.name}`;
    let widest = HORIZ_PADDING + measureWidth(headerText, HEADER_FONT);
    for (const col of table.columns) {
        const badges: string[] = [];
        if (col.isPrimaryKey) badges.push('PK');
        if (fkColumns.has(col.name)) badges.push('FK');
        const uqLabel = uqLabels.get(col.name);
        if (uqLabel && !col.isPrimaryKey) badges.push(uqLabel);
        const badgesW = badges.length > 0
            ? badges.reduce((s, b) => s + badgePx(b), 0) + (badges.length - 1) * BADGE_GAP + NAME_BADGE_GAP
            : 0;
        const nameW = measureWidth(col.name, NAME_FONT);
        const typeW = measureWidth(`${col.dataType}${col.nullable ? '' : ' NOT NULL'}`, TYPE_FONT);
        const rowW = HORIZ_PADDING + badgesW + nameW + NAME_TYPE_GAP + typeW;
        if (rowW > widest) widest = rowW;
    }
    return Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, Math.ceil(widest)));
}

export function tableKey(t: { schema: string | null; name: string }): string {
    return `${t.schema ?? ''}.${t.name}`;
}

export function buildGraph(payload: DiagramPayload, crowsFoot: boolean): { initialNodes: TableNodeType[]; initialEdges: Edge[] } {
    const seen = new Map<string, TableSchema>();
    for (const t of payload.tables) {
        const key = tableKey(t);
        if (!seen.has(key)) seen.set(key, t);
    }

    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120 });
    g.setDefaultEdgeLabel(() => ({}));

    const uqDataMap = new Map<string, { labels: Map<string, string>; groups: Map<string, string[]> }>();
    for (const [key, t] of seen) {
        uqDataMap.set(key, buildUqLabelsAndGroups(t.uniqueConstraints ?? []));
    }

    const widths = new Map<string, number>();
    for (const [key, t] of seen) {
        const fkCols = new Set<string>();
        for (const fk of t.foreignKeys) for (const c of fk.columns) fkCols.add(c);
        const w = computeNodeWidth(t, fkCols, uqDataMap.get(key)!.labels);
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
                sourceHandle: `${fk.columns[0]}-sr`,
                targetHandle: `${fk.refColumns[0]}-tl`,
                type: crowsFoot ? 'crowsfoot' : 'arrow',
                markerEnd: crowsFoot ? undefined : { type: MarkerType.ArrowClosed },
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
                width,
                uqLabels: uqDataMap.get(key)!.labels,
                uqGroups: uqDataMap.get(key)!.groups,
            }
        };
    });

    return { initialNodes: nodes, initialEdges: routeEdgesInGraph(nodes, edges) };
}