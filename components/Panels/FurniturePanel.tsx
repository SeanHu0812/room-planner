"use client";

import { useEffect, useState } from "react";
import { usePlanner } from "@/lib/store";
import {
  Dimensions,
  FurnitureAsset,
  ProductExtraction,
  dimensionsToMeters,
  newId,
} from "@/lib/types";
import { startGeneration, resumePendingGenerations } from "@/lib/generation";
import { deleteGlb } from "@/lib/persistence";

type PendingProduct = {
  extraction: ProductExtraction;
  sourceUrl: string | null;
};

export default function FurniturePanel() {
  const assets = usePlanner((s) => s.assets);
  const upsertAsset = usePlanner((s) => s.upsertAsset);
  const deleteAsset = usePlanner((s) => s.deleteAsset);
  const addInstance = usePlanner((s) => s.addInstance);
  const instances = usePlanner((s) => s.project.instances);

  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPasteFallback, setShowPasteFallback] = useState(false);
  const [pastedText, setPastedText] = useState("");
  /** Product extracted but missing dimensions — waiting for manual entry */
  const [pending, setPending] = useState<PendingProduct | null>(null);
  const [manualDims, setManualDims] = useState({ width: "", depth: "", height: "" });

  useEffect(() => {
    resumePendingGenerations();
  }, []);

  function finalizeAsset(extraction: ProductExtraction, sourceUrl: string | null, dims: Dimensions) {
    const asset: FurnitureAsset = {
      id: newId(),
      name: extraction.name || "Furniture",
      brand: extraction.brand ?? undefined,
      price: extraction.price ?? undefined,
      currency: extraction.currency ?? undefined,
      sourceUrl: sourceUrl ?? undefined,
      category: extraction.category,
      dimensions: dims,
      imageUrl: extraction.imageUrls[0],
      modelStatus: extraction.imageUrls[0] ? "generating" : "none",
      createdAt: Date.now(),
    };
    upsertAsset(asset);
    addInstance(asset.id);
    if (asset.imageUrl) {
      // fire-and-forget; badge tracks progress
      startGeneration(asset.id);
    }
    setPending(null);
    setManualDims({ width: "", depth: "", height: "" });
    setUrl("");
    setPastedText("");
    setShowPasteFallback(false);
  }

  function handleExtraction(extraction: ProductExtraction, sourceUrl: string | null) {
    if (extraction.dimensions) {
      const dims = dimensionsToMeters(extraction.dimensions);
      if (dims.width > 0 && dims.depth > 0 && dims.height > 0) {
        finalizeAsset(extraction, sourceUrl, dims);
        return;
      }
    }
    // Dimensions missing — ask the user
    setPending({ extraction, sourceUrl });
  }

  async function scrape(body: { url?: string; pastedText?: string }) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/furniture/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.blocked) {
          setShowPasteFallback(true);
          setError(json.error);
        } else {
          setError(json.error ?? `Failed (${res.status})`);
        }
        return;
      }
      handleExtraction(json.product as ProductExtraction, json.sourceUrl ?? body.url ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function submitManualDims() {
    if (!pending) return;
    const w = Number(manualDims.width);
    const d = Number(manualDims.depth);
    const h = Number(manualDims.height);
    if (!(w > 0 && d > 0 && h > 0)) {
      setError("Enter all three dimensions in centimeters");
      return;
    }
    setError(null);
    finalizeAsset(pending.extraction, pending.sourceUrl, {
      width: w / 100,
      depth: d / 100,
      height: h / 100,
    });
  }

  const sortedAssets = Object.values(assets).sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="flex flex-col gap-5 p-4">
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Add from shopping link
        </h2>
        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && url && !loading) scrape({ url });
            }}
            placeholder="https://www.ikea.com/…"
            className="min-w-0 flex-1 rounded-md bg-zinc-800 px-3 py-2 text-sm placeholder:text-zinc-600"
          />
          <button
            onClick={() => scrape({ url })}
            disabled={!url || loading}
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {loading ? "…" : "Add"}
          </button>
        </div>
        {loading && (
          <p className="mt-2 animate-pulse text-xs text-zinc-500">
            Reading product page and extracting dimensions…
          </p>
        )}
        {error && <p className="mt-2 text-xs text-amber-400">{error}</p>}

        {showPasteFallback && !pending && (
          <div className="mt-3 rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
            <p className="mb-2 text-xs text-zinc-400">
              Copy everything on the product page (⌘A, ⌘C) and paste it here — the AI will extract
              the product from the text.
            </p>
            <textarea
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              rows={5}
              placeholder="Paste product page content…"
              className="w-full rounded-md bg-zinc-900 px-2 py-1.5 text-xs placeholder:text-zinc-600"
            />
            <button
              onClick={() => scrape({ url: url || undefined, pastedText })}
              disabled={pastedText.trim().length < 20 || loading}
              className="mt-2 w-full rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              Extract from pasted text
            </button>
          </div>
        )}

        {pending && (
          <div className="mt-3 rounded-lg border border-amber-600/40 bg-zinc-800/50 p-3">
            <p className="mb-1 text-sm font-medium text-zinc-200">{pending.extraction.name}</p>
            <p className="mb-2 text-xs text-zinc-400">
              No dimensions found on the page. Enter them from the product spec (in cm):
            </p>
            <div className="flex gap-2">
              {(
                [
                  ["width", "W"],
                  ["depth", "D"],
                  ["height", "H"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex flex-1 items-center gap-1 text-xs text-zinc-500">
                  {label}
                  <input
                    type="number"
                    min={1}
                    value={manualDims[key]}
                    onChange={(e) => setManualDims({ ...manualDims, [key]: e.target.value })}
                    className="w-full rounded bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200"
                  />
                </label>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={submitManualDims}
                className="flex-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
              >
                Add furniture
              </button>
              <button
                onClick={() => setPending(null)}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          My library {sortedAssets.length > 0 && `(${sortedAssets.length})`}
        </h2>
        {sortedAssets.length === 0 ? (
          <p className="text-xs leading-relaxed text-zinc-600">
            Paste a shopping link above to add your first piece. Every product you add is saved
            here so you can reuse it anytime.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {sortedAssets.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                instanceCount={instances.filter((i) => i.assetId === asset.id).length}
                onAdd={() => addInstance(asset.id, [0.3 * Math.random(), 0, 0.3 * Math.random()])}
                onDelete={async () => {
                  const count = instances.filter((i) => i.assetId === asset.id).length;
                  const msg =
                    count > 0
                      ? `Delete "${asset.name}" from your library? ${count} placed item(s) will also be removed.`
                      : `Delete "${asset.name}" from your library?`;
                  if (confirm(msg)) {
                    deleteAsset(asset.id);
                    await deleteGlb(asset.id);
                  }
                }}
                onRegenerate={() => startGeneration(asset.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AssetCard({
  asset,
  instanceCount,
  onAdd,
  onDelete,
  onRegenerate,
}: {
  asset: FurnitureAsset;
  instanceCount: number;
  onAdd: () => void;
  onDelete: () => void;
  onRegenerate: () => void;
}) {
  const statusBadge = {
    none: null,
    generating: (
      <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-400">
        generating…
      </span>
    ),
    ready: (
      <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-400">
        3D ready
      </span>
    ),
    failed: (
      <span className="rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-400">
        3D failed
      </span>
    ),
  }[asset.modelStatus];

  return (
    <div className="group flex flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
      <button onClick={onAdd} title="Add to room" className="relative block aspect-square w-full">
        {asset.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/proxy-image?url=${encodeURIComponent(asset.imageUrl)}`}
            alt={asset.name}
            className="h-full w-full bg-white object-contain"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-zinc-800 text-2xl">
            🪑
          </div>
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs font-medium text-white opacity-0 transition group-hover:opacity-100">
          + Add to room
        </span>
      </button>
      <div className="flex flex-col gap-1 p-2">
        <div className="flex items-start justify-between gap-1">
          <span className="line-clamp-2 text-xs font-medium text-zinc-200">{asset.name}</span>
          {statusBadge}
        </div>
        <span className="text-[10px] text-zinc-500">
          {(asset.dimensions.width * 100).toFixed(0)}×{(asset.dimensions.depth * 100).toFixed(0)}×
          {(asset.dimensions.height * 100).toFixed(0)} cm
          {asset.price != null && ` · ${asset.currency ?? "$"}${asset.price}`}
          {instanceCount > 0 && ` · ${instanceCount} placed`}
        </span>
        <div className="mt-1 flex gap-1 text-[10px]">
          {asset.sourceUrl && (
            <a
              href={asset.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sky-400 hover:underline"
            >
              Buy
            </a>
          )}
          {asset.modelStatus === "failed" && (
            <button onClick={onRegenerate} className="text-amber-400 hover:underline">
              Retry 3D
            </button>
          )}
          <button onClick={onDelete} className="ml-auto text-zinc-600 hover:text-red-400">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
