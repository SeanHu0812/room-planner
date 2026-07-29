"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { Dimensions, FurnitureCategory } from "@/lib/types";
import { useProxiedTexture } from "@/lib/useProxiedTexture";

interface Props {
  category: FurnitureCategory;
  dimensions: Dimensions;
  imageUrl?: string;
}

interface BoxSpec {
  /** center position [x, y, z] in meters (y up, origin at floor center of footprint) */
  pos: [number, number, number];
  size: [number, number, number];
}

const CATEGORY_COLORS: Record<FurnitureCategory, string> = {
  sofa: "#8a9bae",
  armchair: "#8a9bae",
  chair: "#a58d72",
  table: "#9c7b57",
  coffee_table: "#9c7b57",
  desk: "#9c7b57",
  bed: "#b9c4d0",
  dresser: "#a58d72",
  bookshelf: "#8f7355",
  cabinet: "#a58d72",
  lamp: "#d9cfa8",
  rug: "#b56576",
  tv_stand: "#5c6670",
  other: "#9aa0a6",
};

/** Categories that are basically cuboids — the product photo goes on the front face. */
const PHOTO_FRONT_CATEGORIES: FurnitureCategory[] = [
  "dresser",
  "bookshelf",
  "cabinet",
  "tv_stand",
  "other",
];

function buildBoxes(category: FurnitureCategory, d: Dimensions): BoxSpec[] {
  const { width: W, depth: D, height: H } = d;
  const leg = Math.min(0.06, W * 0.08, D * 0.08);

  switch (category) {
    case "sofa":
    case "armchair": {
      const baseH = H * 0.45;
      const armW = Math.min(0.15, W * 0.14);
      const backD = Math.min(0.22, D * 0.3);
      return [
        { pos: [0, baseH / 2, 0], size: [W, baseH, D] }, // base + seat
        { pos: [0, H / 2, -(D - backD) / 2], size: [W, H, backD] }, // full-height back at rear
        { pos: [-(W - armW) / 2, (H * 0.72) / 2, 0], size: [armW, H * 0.72, D] },
        { pos: [(W - armW) / 2, (H * 0.72) / 2, 0], size: [armW, H * 0.72, D] },
      ];
    }
    case "chair": {
      const seatH = H * 0.45;
      const seatT = Math.min(0.08, H * 0.1);
      const backT = Math.min(0.06, D * 0.15);
      return [
        { pos: [0, seatH - seatT / 2, 0], size: [W, seatT, D] },
        { pos: [0, (seatH + H) / 2, -(D - backT) / 2], size: [W, H - seatH, backT] },
        ...legBoxes(W, D, seatH - seatT, leg),
      ];
    }
    case "table":
    case "coffee_table":
    case "desk": {
      const topT = Math.min(0.07, H * 0.15);
      return [
        { pos: [0, H - topT / 2, 0], size: [W, topT, D] },
        ...legBoxes(W, D, H - topT, Math.max(leg, 0.04)),
      ];
    }
    case "bed": {
      const frameH = H * 0.35;
      const headD = Math.min(0.1, D * 0.06);
      return [
        { pos: [0, frameH / 2, 0], size: [W, frameH, D] },
        { pos: [0, (frameH + frameH * 0.5) / 2, 0], size: [W * 0.97, frameH * 0.5, D * 0.97] }, // mattress
        { pos: [0, H / 2, -(D - headD) / 2], size: [W, H, headD] }, // headboard
      ];
    }
    case "lamp": {
      const baseH = Math.min(0.04, H * 0.05);
      const poleW = Math.min(0.05, W * 0.15);
      const shadeH = H * 0.25;
      return [
        { pos: [0, baseH / 2, 0], size: [W * 0.7, baseH, D * 0.7] },
        { pos: [0, H / 2, 0], size: [poleW, H - shadeH, poleW] },
        { pos: [0, H - shadeH / 2, 0], size: [W, shadeH, D] },
      ];
    }
    case "rug": {
      return [{ pos: [0, Math.max(H, 0.015) / 2, 0], size: [W, Math.max(H, 0.015), D] }];
    }
    default: {
      // dresser, bookshelf, cabinet, tv_stand, other: one cuboid
      return [{ pos: [0, H / 2, 0], size: [W, H, D] }];
    }
  }
}

function legBoxes(W: number, D: number, legH: number, leg: number): BoxSpec[] {
  const x = W / 2 - leg;
  const z = D / 2 - leg;
  return [
    { pos: [-x, legH / 2, -z], size: [leg, legH, leg] },
    { pos: [x, legH / 2, -z], size: [leg, legH, leg] },
    { pos: [-x, legH / 2, z], size: [leg, legH, leg] },
    { pos: [x, legH / 2, z], size: [leg, legH, leg] },
  ];
}

export default function ParametricModel({ category, dimensions, imageUrl }: Props) {
  const texture = useProxiedTexture(
    PHOTO_FRONT_CATEGORIES.includes(category) ? imageUrl : undefined
  );
  const boxes = useMemo(() => buildBoxes(category, dimensions), [category, dimensions]);
  const color = CATEGORY_COLORS[category];

  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02 }),
    [color]
  );

  return (
    <group>
      {boxes.map((b, i) => (
        <mesh key={i} position={b.pos} castShadow receiveShadow material={material}>
          <boxGeometry args={b.size} />
        </mesh>
      ))}
      {texture && (
        <mesh
          position={[0, dimensions.height / 2, dimensions.depth / 2 + 0.002]}
          castShadow={false}
        >
          <planeGeometry args={[dimensions.width, dimensions.height]} />
          <meshStandardMaterial map={texture} roughness={0.9} />
        </mesh>
      )}
    </group>
  );
}
