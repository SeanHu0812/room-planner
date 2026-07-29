"use client";

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { loadGlb } from "./persistence";
import { Dimensions } from "./types";

const cache = new Map<string, Promise<THREE.Group | null>>();

/**
 * Load an asset's generated GLB from IndexedDB, normalized:
 * centered on origin (XZ), resting on y=0, uniformly scaled to the
 * asset's real-world dimensions (height-first, width as fallback).
 */
export function getNormalizedModel(
  assetId: string,
  dimensions: Dimensions
): Promise<THREE.Group | null> {
  let entry = cache.get(assetId);
  if (!entry) {
    entry = loadAndNormalize(assetId, dimensions);
    cache.set(assetId, entry);
  }
  return entry;
}

export function invalidateModel(assetId: string) {
  cache.delete(assetId);
}

async function loadAndNormalize(
  assetId: string,
  dims: Dimensions
): Promise<THREE.Group | null> {
  const blob = await loadGlb(assetId);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    const scene = gltf.scene;

    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    if (size.length() === 0) return null;

    // Uniform scale: match real height when the model has meaningful height,
    // otherwise match the larger horizontal extent to the larger footprint dim.
    let scale: number;
    if (size.y > Math.max(size.x, size.z) * 0.15 && dims.height > 0.02) {
      scale = dims.height / size.y;
    } else {
      const horizontal = Math.max(size.x, size.z) || 1;
      scale = Math.max(dims.width, dims.depth) / horizontal;
    }

    const wrapper = new THREE.Group();
    wrapper.add(scene);
    scene.scale.setScalar(scale);

    // Recompute bounds after scaling, then center on origin and sit on floor
    const box2 = new THREE.Box3().setFromObject(wrapper);
    const center = new THREE.Vector3();
    box2.getCenter(center);
    scene.position.x -= center.x;
    scene.position.z -= center.z;
    scene.position.y -= box2.min.y;

    wrapper.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    return wrapper;
  } catch (e) {
    console.error("Failed to load GLB for asset", assetId, e);
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
