"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";

const textureCache = new Map<string, THREE.Texture>();

/** Load a remote image as a texture through /api/proxy-image. Returns null while loading or on failure. */
export function useProxiedTexture(imageUrl: string | undefined): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(
    imageUrl ? (textureCache.get(imageUrl) ?? null) : null
  );

  useEffect(() => {
    if (!imageUrl) {
      setTexture(null);
      return;
    }
    const cached = textureCache.get(imageUrl);
    if (cached) {
      setTexture(cached);
      return;
    }
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.load(
      `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        textureCache.set(imageUrl, tex);
        if (!cancelled) setTexture(tex);
      },
      undefined,
      () => {
        if (!cancelled) setTexture(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  return texture;
}
