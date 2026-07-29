"use client";

import { usePlanner } from "@/lib/store";
import { startGeneration } from "@/lib/generation";

/** Floating card with details/actions for the selected furniture instance. */
export default function Inspector() {
  const selectedId = usePlanner((s) => s.selectedInstanceId);
  const instance = usePlanner((s) => s.project.instances.find((i) => i.id === s.selectedInstanceId));
  const asset = usePlanner((s) => (instance ? s.assets[instance.assetId] : undefined));
  const updateInstance = usePlanner((s) => s.updateInstance);
  const deleteInstance = usePlanner((s) => s.deleteInstance);
  const duplicateInstance = usePlanner((s) => s.duplicateInstance);

  if (!selectedId || !instance || !asset) return null;

  const rotate = (dir: 1 | -1) =>
    updateInstance(instance.id, { rotationY: instance.rotationY + (dir * Math.PI) / 12 });

  return (
    <div className="absolute bottom-3 right-3 w-64 rounded-xl border border-zinc-800 bg-zinc-900/95 p-3 shadow-xl">
      <div className="mb-1 text-sm font-medium text-zinc-100">{asset.name}</div>
      <div className="text-xs text-zinc-400">
        {asset.brand && <span>{asset.brand} · </span>}
        {(asset.dimensions.width * 100).toFixed(0)}×{(asset.dimensions.depth * 100).toFixed(0)}×
        {(asset.dimensions.height * 100).toFixed(0)} cm
      </div>
      {asset.price != null && (
        <div className="mt-0.5 text-sm font-semibold text-emerald-400">
          {asset.currency ?? "$"}
          {asset.price}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-1.5 text-xs">
        <button onClick={() => rotate(-1)} className="rounded bg-zinc-800 py-1.5 hover:bg-zinc-700">
          ⟲ Rotate left
        </button>
        <button onClick={() => rotate(1)} className="rounded bg-zinc-800 py-1.5 hover:bg-zinc-700">
          ⟳ Rotate right
        </button>
        <button
          onClick={() => duplicateInstance(instance.id)}
          className="rounded bg-zinc-800 py-1.5 hover:bg-zinc-700"
        >
          Duplicate
        </button>
        <button
          onClick={() => deleteInstance(instance.id)}
          className="rounded bg-red-900/50 py-1.5 text-red-300 hover:bg-red-900"
        >
          Remove
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px]">
        {asset.sourceUrl ? (
          <a
            href={asset.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sky-400 hover:underline"
          >
            View product page →
          </a>
        ) : (
          <span />
        )}
        {asset.modelStatus === "failed" && (
          <button
            onClick={() => startGeneration(asset.id)}
            className="text-amber-400 hover:underline"
          >
            Retry 3D
          </button>
        )}
        {asset.modelStatus === "generating" && (
          <span className="animate-pulse text-amber-400">Generating 3D…</span>
        )}
      </div>
    </div>
  );
}
