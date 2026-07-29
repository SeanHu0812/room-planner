import { FloorPlan, Wall } from "./types";

/**
 * Conversion between floor-plan image pixel space (x right, y down)
 * and 3D world space in meters (x right, y up, z toward viewer).
 * The room is centered on the world origin.
 */

export interface PlanTransform {
  pixelsPerMeter: number;
  /** Center of the walls' bounding box, in image pixels */
  centerX: number;
  centerY: number;
}

export function computePlanTransform(plan: FloorPlan): PlanTransform {
  const { walls, pixelsPerMeter, imageWidth, imageHeight } = plan;
  if (walls.length === 0) {
    return { pixelsPerMeter, centerX: imageWidth / 2, centerY: imageHeight / 2 };
  }
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const w of walls) {
    minX = Math.min(minX, w.x1, w.x2);
    maxX = Math.max(maxX, w.x1, w.x2);
    minY = Math.min(minY, w.y1, w.y2);
    maxY = Math.max(maxY, w.y1, w.y2);
  }
  return { pixelsPerMeter, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
}

/** Image pixel point -> world [x, z] in meters */
export function pxToWorld(t: PlanTransform, x: number, y: number): [number, number] {
  return [(x - t.centerX) / t.pixelsPerMeter, (y - t.centerY) / t.pixelsPerMeter];
}

export function wallLengthPx(w: Wall): number {
  return Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
}

export function wallLengthM(plan: FloorPlan, w: Wall): number {
  return wallLengthPx(w) / plan.pixelsPerMeter;
}

/** Extent of the room footprint in meters (for floor slab & camera fit) */
export function roomExtentM(plan: FloorPlan): { width: number; depth: number } {
  const { walls, pixelsPerMeter } = plan;
  if (walls.length === 0) return { width: 10, depth: 10 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const w of walls) {
    minX = Math.min(minX, w.x1, w.x2);
    maxX = Math.max(maxX, w.x1, w.x2);
    minY = Math.min(minY, w.y1, w.y2);
    maxY = Math.max(maxY, w.y1, w.y2);
  }
  return {
    width: (maxX - minX) / pixelsPerMeter,
    depth: (maxY - minY) / pixelsPerMeter,
  };
}
