"use client";

import { get, set, del } from "idb-keyval";
import { FurnitureAsset, Project } from "./types";

const PROJECT_KEY = "roomplanner:project";
const ASSETS_KEY = "roomplanner:assets";
const glbKey = (assetId: string) => `roomplanner:glb:${assetId}`;

// ---- Load ----

export async function loadProject(): Promise<Project | null> {
  return (await get<Project>(PROJECT_KEY)) ?? null;
}

export async function loadAssets(): Promise<Record<string, FurnitureAsset>> {
  return (await get<Record<string, FurnitureAsset>>(ASSETS_KEY)) ?? {};
}

// ---- Save (debounced) ----

let projectTimer: ReturnType<typeof setTimeout> | null = null;
export function saveProjectDebounced(project: Project) {
  if (projectTimer) clearTimeout(projectTimer);
  projectTimer = setTimeout(() => {
    set(PROJECT_KEY, project).catch((e) => console.error("Failed to save project", e));
  }, 400);
}

let assetsTimer: ReturnType<typeof setTimeout> | null = null;
export function saveAssetsDebounced(assets: Record<string, FurnitureAsset>) {
  if (assetsTimer) clearTimeout(assetsTimer);
  assetsTimer = setTimeout(() => {
    set(ASSETS_KEY, assets).catch((e) => console.error("Failed to save assets", e));
  }, 400);
}

// ---- GLB blobs ----

export async function saveGlb(assetId: string, blob: Blob) {
  await set(glbKey(assetId), blob);
}

export async function loadGlb(assetId: string): Promise<Blob | null> {
  return (await get<Blob>(glbKey(assetId))) ?? null;
}

export async function deleteGlb(assetId: string) {
  await del(glbKey(assetId));
}

// ---- Export / import ----

interface ExportedFile {
  version: 1;
  project: Project;
  assets: FurnitureAsset[];
  /** assetId -> base64 GLB */
  glbs: Record<string, string>;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBlob(b64: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "model/gltf-binary" });
}

export async function exportProject(
  project: Project,
  assets: Record<string, FurnitureAsset>
): Promise<Blob> {
  const usedAssetIds = new Set(project.instances.map((i) => i.assetId));
  const usedAssets = Object.values(assets).filter((a) => usedAssetIds.has(a.id));
  const glbs: Record<string, string> = {};
  for (const asset of usedAssets) {
    if (asset.modelStatus === "ready") {
      const blob = await loadGlb(asset.id);
      if (blob) glbs[asset.id] = await blobToBase64(blob);
    }
  }
  const file: ExportedFile = { version: 1, project, assets: usedAssets, glbs };
  return new Blob([JSON.stringify(file)], { type: "application/json" });
}

export async function importProject(
  file: File
): Promise<{ project: Project; assets: FurnitureAsset[] }> {
  const parsed = JSON.parse(await file.text()) as ExportedFile;
  if (parsed.version !== 1 || !parsed.project?.floorPlan) {
    throw new Error("Not a valid .roomplan file");
  }
  for (const [assetId, b64] of Object.entries(parsed.glbs ?? {})) {
    await saveGlb(assetId, base64ToBlob(b64));
  }
  return { project: parsed.project, assets: parsed.assets ?? [] };
}
