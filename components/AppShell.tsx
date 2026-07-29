"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { usePlanner } from "@/lib/store";
import { loadAssets, loadProject, exportProject, importProject } from "@/lib/persistence";
import FloorPlanPanel from "./Panels/FloorPlanPanel";
import FurniturePanel from "./Panels/FurniturePanel";
import FloorPlanEditor from "./FloorPlanEditor/FloorPlanEditor";

const RoomScene = dynamic(() => import("./Scene/RoomScene"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-zinc-500">Loading 3D scene…</div>
  ),
});

export default function AppShell() {
  const mode = usePlanner((s) => s.mode);
  const setMode = usePlanner((s) => s.setMode);
  const hydrated = usePlanner((s) => s.hydrated);
  const setHydrated = usePlanner((s) => s.setHydrated);
  const project = usePlanner((s) => s.project);
  const assets = usePlanner((s) => s.assets);
  const setProject = usePlanner((s) => s.setProject);
  const upsertAsset = usePlanner((s) => s.upsertAsset);
  const renameProject = usePlanner((s) => s.renameProject);

  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      // Console access for debugging/testing: __planner.getState()
      (window as unknown as Record<string, unknown>).__planner = usePlanner;
    }
    let cancelled = false;
    (async () => {
      const [p, a] = await Promise.all([loadProject(), loadAssets()]);
      if (!cancelled) setHydrated(p, a);
    })();
    return () => {
      cancelled = true;
    };
  }, [setHydrated]);

  const hasWalls = project.floorPlan.walls.length > 0;

  async function handleExport() {
    const blob = await exportProject(project, assets);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name.replace(/[^\w-]+/g, "_") || "room"}.roomplan`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(file: File) {
    try {
      const { project: imported, assets: importedAssets } = await importProject(file);
      for (const asset of importedAssets) upsertAsset(asset);
      setProject(imported);
      usePlanner.getState().setMode(imported.floorPlan.walls.length > 0 ? "room" : "plan");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Import failed");
    }
  }

  if (!hydrated) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">Loading project…</div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-zinc-800 bg-zinc-900 px-4">
        <span className="text-sm font-semibold tracking-wide text-emerald-400">Room Planner</span>
        <input
          value={project.name}
          onChange={(e) => renameProject(e.target.value)}
          className="w-44 rounded bg-transparent px-2 py-1 text-sm text-zinc-300 outline-none ring-zinc-700 hover:ring-1 focus:bg-zinc-800 focus:ring-1"
          aria-label="Project name"
        />
        <nav className="mx-auto flex gap-1 rounded-lg bg-zinc-800 p-1">
          <button
            onClick={() => setMode("plan")}
            className={`rounded-md px-4 py-1 text-sm transition ${
              mode === "plan" ? "bg-zinc-600 text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            1 · Floor Plan
          </button>
          <button
            onClick={() => setMode("room")}
            disabled={!hasWalls}
            title={hasWalls ? "" : "Add walls in the floor plan first"}
            className={`rounded-md px-4 py-1 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
              mode === "room" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            2 · 3D Room
          </button>
        </nav>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            Export
          </button>
          <button
            onClick={() => importInputRef.current?.click()}
            className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            Import
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".roomplan,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImport(f);
              e.target.value = "";
            }}
          />
        </div>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        <aside className="w-90 shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-900/60">
          {mode === "plan" ? <FloorPlanPanel /> : <FurniturePanel />}
        </aside>
        <main className="relative min-w-0 flex-1 bg-zinc-950">
          {mode === "plan" ? <FloorPlanEditor /> : <RoomScene />}
        </main>
      </div>
    </div>
  );
}
