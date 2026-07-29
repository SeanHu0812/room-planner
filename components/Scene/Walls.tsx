"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { FloorPlan } from "@/lib/types";
import { computePlanTransform, pxToWorld, roomExtentM } from "@/lib/scale";

const DOOR_HEIGHT = 2.05;
const WINDOW_SILL = 0.9;
const WINDOW_HEAD = 2.1;

interface WallBox {
  pos: [number, number, number];
  size: [number, number, number];
  rotY: number;
}

/** Split every wall into boxes around its door/window openings (no CSG needed). */
function buildWallBoxes(plan: FloorPlan): WallBox[] {
  const t = computePlanTransform(plan);
  const H = plan.wallHeightM;
  const T = plan.wallThicknessM;
  const boxes: WallBox[] = [];

  for (const wall of plan.walls) {
    const [x1, z1] = pxToWorld(t, wall.x1, wall.y1);
    const [x2, z2] = pxToWorld(t, wall.x2, wall.y2);
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.01) continue;
    const angle = Math.atan2(-(z2 - z1), x2 - x1); // three.js Y-rotation

    const midAt = (t0: number, t1: number): [number, number] => {
      const tm = (t0 + t1) / 2;
      return [x1 + (x2 - x1) * tm, z1 + (z2 - z1) * tm];
    };

    const pushBox = (t0: number, t1: number, yBottom: number, yTop: number) => {
      const segLen = (t1 - t0) * len;
      const height = yTop - yBottom;
      if (segLen < 0.01 || height < 0.01) return;
      const [mx, mz] = midAt(t0, t1);
      boxes.push({
        pos: [mx, yBottom + height / 2, mz],
        size: [segLen, height, T],
        rotY: angle,
      });
    };

    // Sort and clamp openings on this wall
    const openings = plan.openings
      .filter((o) => o.wallId === wall.id)
      .map((o) => ({
        ...o,
        t0: Math.max(0, Math.min(o.t0, o.t1)),
        t1: Math.min(1, Math.max(o.t0, o.t1)),
      }))
      .sort((a, b) => a.t0 - b.t0);

    let cursor = 0;
    for (const o of openings) {
      if (o.t0 > cursor) pushBox(cursor, o.t0, 0, H); // solid segment before opening
      if (o.type === "door") {
        const top = Math.min(DOOR_HEIGHT, H - 0.01);
        pushBox(o.t0, o.t1, top, H); // lintel above door
      } else {
        pushBox(o.t0, o.t1, 0, Math.min(WINDOW_SILL, H)); // below sill
        pushBox(o.t0, o.t1, Math.min(WINDOW_HEAD, H), H); // above head
      }
      cursor = Math.max(cursor, o.t1);
    }
    if (cursor < 1) pushBox(cursor, 1, 0, H);
  }
  return boxes;
}

export default function Walls({ plan }: { plan: FloorPlan }) {
  const boxes = useMemo(() => buildWallBoxes(plan), [plan]);
  const extent = useMemo(() => roomExtentM(plan), [plan]);

  const wallMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#e8e4dc", roughness: 0.95 }),
    []
  );
  const floorMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#c9b18f", roughness: 0.9 }),
    []
  );

  const floorW = extent.width + plan.wallThicknessM * 2;
  const floorD = extent.depth + plan.wallThicknessM * 2;

  return (
    <group>
      {boxes.map((b, i) => (
        <mesh
          key={i}
          position={b.pos}
          rotation={[0, b.rotY, 0]}
          castShadow
          receiveShadow
          material={wallMaterial}
        >
          <boxGeometry args={b.size} />
        </mesh>
      ))}
      {/* Floor slab: top surface at y=0 */}
      <mesh position={[0, -0.05, 0]} receiveShadow material={floorMaterial}>
        <boxGeometry args={[floorW, 0.1, floorD]} />
      </mesh>
      {/* Surrounding ground */}
      <mesh position={[0, -0.101, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[300, 300]} />
        <meshStandardMaterial color="#1c1f24" roughness={1} />
      </mesh>
    </group>
  );
}
