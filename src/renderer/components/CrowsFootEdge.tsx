import { createContext, useContext } from 'react';
import { getSmoothStepPath, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';

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
}: EdgeProps) {
  const stroke = selected ? 'var(--accent)' : 'var(--muted)';
  const allCrossings = useContext(CrossingsCtx);

  const [rawPath, labelX, labelY] = getSmoothStepPath({
    sourceX: sourceX + OFFSET,
    sourceY,
    sourcePosition,
    targetX: targetX - OFFSET,
    targetY,
    targetPosition,
    borderRadius: 0,
  });

  const edgePath = applyJumps(rawPath, allCrossings.get(id) ?? []);

  // Crow's foot (many) at source: fan opens toward source node
  const crowsPath = [
    `M ${sourceX + 10} ${sourceY} L ${sourceX} ${sourceY - CF_SPREAD}`,
    `M ${sourceX + 10} ${sourceY} L ${sourceX} ${sourceY}`,
    `M ${sourceX + 10} ${sourceY} L ${sourceX} ${sourceY + CF_SPREAD}`,
    `M ${sourceX + 15} ${sourceY - BAR_HALF} L ${sourceX + 15} ${sourceY + BAR_HALF}`,
  ].join(' ');

  // "One" (exactly one) at target: two parallel bars toward target node
  const onePath = [
    `M ${targetX - 10} ${targetY - BAR_HALF} L ${targetX - 10} ${targetY + BAR_HALF}`,
    `M ${targetX - 15} ${targetY - BAR_HALF} L ${targetX - 15} ${targetY + BAR_HALF}`,
  ].join(' ');

  return (
    <>
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
    </>
  );
}