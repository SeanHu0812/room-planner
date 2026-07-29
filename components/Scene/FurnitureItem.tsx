"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { ThreeEvent } from "@react-three/fiber";
import { FurnitureAsset, FurnitureInstance } from "@/lib/types";
import { getNormalizedModel } from "@/lib/glb-cache";
import ParametricModel from "./ParametricModel";

interface Props {
  instance: FurnitureInstance;
  asset: FurnitureAsset;
  selected: boolean;
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
}

export default function FurnitureItem({ instance, asset, selected, onPointerDown }: Props) {
  const [model, setModel] = useState<THREE.Group | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (asset.modelStatus === "ready") {
      getNormalizedModel(asset.id, asset.dimensions).then((m) => {
        if (!cancelled) setModel(m ? (m.clone(true) as THREE.Group) : null);
      });
    } else {
      setModel(null);
    }
    return () => {
      cancelled = true;
    };
  }, [asset.id, asset.modelStatus, asset.dimensions]);

  const { width: W, depth: D } = asset.dimensions;

  return (
    <group
      position={instance.position}
      rotation={[0, instance.rotationY, 0]}
      onPointerDown={onPointerDown}
    >
      {model ? (
        <primitive object={model} />
      ) : (
        <ParametricModel
          category={asset.category}
          dimensions={asset.dimensions}
          imageUrl={asset.imageUrl}
        />
      )}

      {/* Footprint outline + label when selected */}
      {selected && (
        <>
          <lineSegments position={[0, 0.015, 0]}>
            <edgesGeometry
              args={[new THREE.PlaneGeometry(W + 0.06, D + 0.06).rotateX(-Math.PI / 2)]}
            />
            <lineBasicMaterial color="#34d399" />
          </lineSegments>
          <Html
            position={[0, asset.dimensions.height + 0.25, 0]}
            center
            distanceFactor={8}
            style={{ pointerEvents: "none" }}
          >
            <div className="whitespace-nowrap rounded-md bg-zinc-900/90 px-2 py-1 text-center text-[11px] text-zinc-100 shadow-lg">
              <div className="font-medium">{asset.name}</div>
              <div className="text-zinc-400">
                {asset.dimensions.width.toFixed(2)} × {asset.dimensions.depth.toFixed(2)} ×{" "}
                {asset.dimensions.height.toFixed(2)} m
                {asset.price != null && (
                  <> · {asset.currency ?? "$"}{asset.price}</>
                )}
              </div>
            </div>
          </Html>
        </>
      )}

      {/* Generation status badge */}
      {asset.modelStatus === "generating" && (
        <Html
          position={[0, asset.dimensions.height + 0.1, 0]}
          center
          distanceFactor={8}
          style={{ pointerEvents: "none" }}
        >
          <div className="whitespace-nowrap rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-medium text-black">
            Generating 3D…
          </div>
        </Html>
      )}
    </group>
  );
}
