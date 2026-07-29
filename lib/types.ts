// Core data model for the room planner.
// 2D floor plan coordinates are in image pixel space (y down).
// 3D world coordinates are meters: x right, y up, z toward viewer (image y maps to z).

export interface Wall {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type OpeningType = "door" | "window";

export interface Opening {
  id: string;
  wallId: string;
  type: OpeningType;
  /** Start/end as fraction of wall length, 0..1, t0 < t1 */
  t0: number;
  t1: number;
}

export interface FloorPlan {
  imageDataUrl: string | null;
  imageWidth: number;
  imageHeight: number;
  walls: Wall[];
  openings: Opening[];
  /** Scale: how many image pixels equal one real meter */
  pixelsPerMeter: number;
  wallHeightM: number;
  wallThicknessM: number;
}

export const FURNITURE_CATEGORIES = [
  "sofa",
  "armchair",
  "chair",
  "table",
  "coffee_table",
  "desk",
  "bed",
  "dresser",
  "bookshelf",
  "cabinet",
  "lamp",
  "rug",
  "tv_stand",
  "other",
] as const;

export type FurnitureCategory = (typeof FURNITURE_CATEGORIES)[number];

/** All dimensions in meters. width = along the front face, depth = front-to-back, height = floor-to-top. */
export interface Dimensions {
  width: number;
  depth: number;
  height: number;
}

export type ModelStatus = "none" | "generating" | "ready" | "failed";

/** A reusable product in the furniture library (global, project-independent). */
export interface FurnitureAsset {
  id: string;
  name: string;
  brand?: string;
  price?: number;
  currency?: string;
  sourceUrl?: string;
  category: FurnitureCategory;
  dimensions: Dimensions;
  /** Original product image URL (fetched through /api/proxy-image on the client) */
  imageUrl?: string;
  modelStatus: ModelStatus;
  meshyTaskId?: string;
  createdAt: number;
}

/** A placed piece of furniture in a project. Transform only; everything else lives on the asset. */
export interface FurnitureInstance {
  id: string;
  assetId: string;
  /** World position in meters */
  position: [number, number, number];
  /** Rotation around Y in radians */
  rotationY: number;
}

export interface Project {
  id: string;
  name: string;
  floorPlan: FloorPlan;
  instances: FurnitureInstance[];
  updatedAt: number;
}

/** Result of AI floor plan analysis (image pixel coordinates). */
export interface FloorPlanAnalysis {
  walls: { x1: number; y1: number; x2: number; y2: number }[];
  openings: { wallIndex: number; type: OpeningType; t0: number; t1: number }[];
  estimatedPixelsPerMeter: number | null;
  notes: string;
}

/** Result of AI product extraction from a shopping page. */
export interface ProductExtraction {
  name: string;
  brand: string | null;
  price: number | null;
  currency: string | null;
  imageUrls: string[];
  dimensions: {
    width: number;
    depth: number;
    height: number;
    unit: "cm" | "in" | "m" | "mm";
  } | null;
  category: FurnitureCategory;
}

export function defaultFloorPlan(): FloorPlan {
  return {
    imageDataUrl: null,
    imageWidth: 0,
    imageHeight: 0,
    walls: [],
    openings: [],
    pixelsPerMeter: 100,
    wallHeightM: 2.5,
    wallThicknessM: 0.12,
  };
}

export function newId(): string {
  return crypto.randomUUID();
}

/** Convert extracted dimensions to meters. */
export function dimensionsToMeters(d: NonNullable<ProductExtraction["dimensions"]>): Dimensions {
  const factor = { cm: 0.01, in: 0.0254, m: 1, mm: 0.001 }[d.unit] ?? 0.01;
  return {
    width: d.width * factor,
    depth: d.depth * factor,
    height: d.height * factor,
  };
}
