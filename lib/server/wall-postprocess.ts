/**
 * Deterministic cleanup of AI-detected wall segments.
 * Vision models are good at topology (which walls exist) but imprecise on
 * coordinates. These passes enforce the strong priors of floor plans:
 * most walls are axis-aligned, corners are closed, and junctions meet.
 */

export interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PostprocessResult {
  walls: Seg[];
  /** Maps original wall index -> new index (or -1 if the wall was dropped) */
  indexMap: number[];
}

const AXIS_SNAP_DEG = 7;
const MIN_WALL_PX_FRACTION = 0.006; // of image diagonal

export function postprocessWalls(
  rawWalls: Seg[],
  imageWidth: number,
  imageHeight: number
): PostprocessResult {
  const diag = Math.hypot(imageWidth, imageHeight);
  const weldRadius = Math.max(8, diag * 0.009);
  const minLen = Math.max(6, diag * MIN_WALL_PX_FRACTION);

  // Work on copies; track original indices
  let walls = rawWalls.map((w, i) => ({ ...w, _i: i }));

  // 1. Drop degenerate segments
  walls = walls.filter((w) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1) >= minLen);

  snapToAxis(walls);
  weldCorners(walls, weldRadius);
  snapToAxis(walls); // welding can nudge points slightly off-axis
  attachTJunctions(walls, weldRadius);
  snapToAxis(walls);

  const indexMap = rawWalls.map(() => -1);
  walls.forEach((w, newIdx) => {
    indexMap[w._i] = newIdx;
  });

  return {
    walls: walls.map(({ x1, y1, x2, y2 }) => ({
      x1: round1(x1),
      y1: round1(y1),
      x2: round1(x2),
      y2: round1(y2),
    })),
    indexMap,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

type W = Seg & { _i: number };

/** Snap near-horizontal/vertical walls exactly onto the axis. */
function snapToAxis(walls: W[]) {
  for (const w of walls) {
    const dx = w.x2 - w.x1;
    const dy = w.y2 - w.y1;
    const angle = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI; // 0..90
    if (angle <= AXIS_SNAP_DEG) {
      const y = (w.y1 + w.y2) / 2;
      w.y1 = y;
      w.y2 = y;
    } else if (angle >= 90 - AXIS_SNAP_DEG) {
      const x = (w.x1 + w.x2) / 2;
      w.x1 = x;
      w.x2 = x;
    }
  }
}

/** Cluster endpoints within radius and move each cluster to its centroid. */
function weldCorners(walls: W[], radius: number) {
  interface Pt {
    wall: W;
    end: 1 | 2;
    x: number;
    y: number;
  }
  const pts: Pt[] = [];
  for (const w of walls) {
    pts.push({ wall: w, end: 1, x: w.x1, y: w.y1 });
    pts.push({ wall: w, end: 2, x: w.x2, y: w.y2 });
  }
  const assigned = new Set<Pt>();
  for (const p of pts) {
    if (assigned.has(p)) continue;
    const cluster = pts.filter(
      (q) => !assigned.has(q) && Math.hypot(q.x - p.x, q.y - p.y) <= radius
    );
    if (cluster.length < 2) continue;
    const cx = cluster.reduce((s, q) => s + q.x, 0) / cluster.length;
    const cy = cluster.reduce((s, q) => s + q.y, 0) / cluster.length;
    for (const q of cluster) {
      assigned.add(q);
      if (q.end === 1) {
        q.wall.x1 = cx;
        q.wall.y1 = cy;
      } else {
        q.wall.x2 = cx;
        q.wall.y2 = cy;
      }
    }
  }
}

/** Snap loose endpoints onto the body of a nearby wall (T-junctions). */
function attachTJunctions(walls: W[], radius: number) {
  for (const w of walls) {
    for (const end of [1, 2] as const) {
      const px = end === 1 ? w.x1 : w.x2;
      const py = end === 1 ? w.y1 : w.y2;
      let best: { x: number; y: number; d: number } | null = null;
      for (const other of walls) {
        if (other === w) continue;
        const proj = projectOntoSegment(px, py, other);
        if (proj && proj.d <= radius && (best === null || proj.d < best.d)) {
          best = proj;
        }
      }
      if (best) {
        if (end === 1) {
          w.x1 = best.x;
          w.y1 = best.y;
        } else {
          w.x2 = best.x;
          w.y2 = best.y;
        }
      }
    }
  }
}

function projectOntoSegment(
  px: number,
  py: number,
  s: Seg
): { x: number; y: number; d: number } | null {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1) return null;
  const t = ((px - s.x1) * dx + (py - s.y1) * dy) / len2;
  // Only true T-junctions: projection well inside the segment
  if (t < 0.05 || t > 0.95) return null;
  const x = s.x1 + t * dx;
  const y = s.y1 + t * dy;
  const d = Math.hypot(px - x, py - y);
  return { x, y, d };
}
