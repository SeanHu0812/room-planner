"use client";

import { usePlanner } from "./store";
import { saveGlb } from "./persistence";
import { invalidateModel } from "./glb-cache";

const activePolls = new Set<string>();
const POLL_INTERVAL_MS = 8000;

/** Kick off (or restart) Meshy image-to-3D generation for a library asset. */
export async function startGeneration(assetId: string): Promise<void> {
  const asset = usePlanner.getState().assets[assetId];
  if (!asset?.imageUrl) return;
  if (activePolls.has(assetId)) return;

  try {
    const res = await fetch("/api/furniture/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl: asset.imageUrl }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Failed to start generation");

    usePlanner.getState().upsertAsset({
      ...usePlanner.getState().assets[assetId],
      modelStatus: "generating",
      meshyTaskId: json.taskId,
    });
    pollTask(assetId, json.taskId);
  } catch (e) {
    console.error("Generation start failed:", e);
    usePlanner.getState().upsertAsset({
      ...usePlanner.getState().assets[assetId],
      modelStatus: "failed",
    });
  }
}

/** Resume polling for any assets that were mid-generation when the page last closed. */
export function resumePendingGenerations(): void {
  const assets = usePlanner.getState().assets;
  for (const asset of Object.values(assets)) {
    if (asset.modelStatus === "generating" && asset.meshyTaskId) {
      pollTask(asset.id, asset.meshyTaskId);
    }
  }
}

function pollTask(assetId: string, taskId: string): void {
  if (activePolls.has(assetId)) return;
  activePolls.add(assetId);

  const tick = async () => {
    // Asset may have been deleted meanwhile
    const asset = usePlanner.getState().assets[assetId];
    if (!asset || asset.meshyTaskId !== taskId) {
      activePolls.delete(assetId);
      return;
    }
    try {
      const res = await fetch(`/api/furniture/generate?taskId=${encodeURIComponent(taskId)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Poll failed");

      if (json.status === "SUCCEEDED" && json.modelUrl) {
        const modelRes = await fetch(
          `/api/furniture/model?url=${encodeURIComponent(json.modelUrl)}`
        );
        if (!modelRes.ok) throw new Error("Model download failed");
        const blob = await modelRes.blob();
        await saveGlb(assetId, blob);
        invalidateModel(assetId);
        activePolls.delete(assetId);
        usePlanner.getState().upsertAsset({
          ...usePlanner.getState().assets[assetId],
          modelStatus: "ready",
        });
        return;
      }
      if (json.status === "FAILED" || json.status === "CANCELED") {
        console.error("Meshy task failed:", json.error);
        activePolls.delete(assetId);
        usePlanner.getState().upsertAsset({
          ...usePlanner.getState().assets[assetId],
          modelStatus: "failed",
        });
        return;
      }
      // PENDING / IN_PROGRESS — keep polling
      setTimeout(tick, POLL_INTERVAL_MS);
    } catch (e) {
      console.error("Generation polling error:", e);
      // Transient network errors: retry a few more times via timeout
      setTimeout(tick, POLL_INTERVAL_MS * 2);
    }
  };

  setTimeout(tick, POLL_INTERVAL_MS);
}
