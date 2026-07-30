"use client";

import { useRef } from "react";
import { usePlanner } from "@/lib/store";
import { useEditorUI } from "@/lib/editor-ui";
import { prepareFloorPlanImage, dataUrlToBase64 } from "@/lib/image";
import { FloorPlanAnalysis, Opening, Wall, newId } from "@/lib/types";
import { wallLengthM } from "@/lib/scale";

export default function FloorPlanPanel() {
  const project = usePlanner((s) => s.project);
  const setFloorPlanImage = usePlanner((s) => s.setFloorPlanImage);
  const setAnalysis = usePlanner((s) => s.setAnalysis);
  const updateFloorPlan = usePlanner((s) => s.updateFloorPlan);
  const setMode = usePlanner((s) => s.setMode);
  const resetFloorPlan = usePlanner((s) => s.resetFloorPlan);
  const selectedWallId = usePlanner((s) => s.selectedWallId);
  const deleteWall = usePlanner((s) => s.deleteWall);
  const addOpening = usePlanner((s) => s.addOpening);
  const deleteOpening = usePlanner((s) => s.deleteOpening);

  const tool = useEditorUI((s) => s.tool);
  const setTool = useEditorUI((s) => s.setTool);
  const analyzing = useEditorUI((s) => s.analyzing);
  const setAnalyzing = useEditorUI((s) => s.setAnalyzing);
  const analysisError = useEditorUI((s) => s.analysisError);
  const setAnalysisError = useEditorUI((s) => s.setAnalysisError);
  const analysisNotes = useEditorUI((s) => s.analysisNotes);
  const setAnalysisNotes = useEditorUI((s) => s.setAnalysisNotes);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const plan = project.floorPlan;
  const selectedWall = plan.walls.find((w) => w.id === selectedWallId) ?? null;
  const wallOpenings = selectedWall
    ? plan.openings.filter((o) => o.wallId === selectedWall.id)
    : [];

  async function handleFile(file: File) {
    setAnalysisError(null);
    const { dataUrl, width, height } = await prepareFloorPlanImage(file);
    setFloorPlanImage(dataUrl, width, height);
  }

  async function analyze() {
    if (!plan.imageDataUrl) return;
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const { base64, mediaType } = dataUrlToBase64(plan.imageDataUrl);
      const res = await fetch("/api/floorplan/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mediaType }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Analysis failed (${res.status})`);
      const analysis = json as FloorPlanAnalysis;

      const walls: Wall[] = analysis.walls.map((w) => ({ id: newId(), ...w }));
      const openings: Opening[] = analysis.openings
        .filter((o) => o.wallIndex >= 0 && o.wallIndex < walls.length)
        .map((o) => ({
          id: newId(),
          wallId: walls[o.wallIndex].id,
          type: o.type,
          t0: Math.max(0, Math.min(1, Math.min(o.t0, o.t1))),
          t1: Math.max(0, Math.min(1, Math.max(o.t0, o.t1))),
        }));
      setAnalysis(walls, openings, analysis.estimatedPixelsPerMeter);
      setAnalysisNotes(analysis.notes || null);
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 p-4">
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Floor plan image
        </h2>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
        <div className="flex gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 rounded-md bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700"
          >
            {plan.imageDataUrl ? "Replace image" : "Upload image"}
          </button>
          {plan.imageDataUrl && (
            <button
              onClick={() => {
                if (confirm("Start over? Walls and placed furniture will be cleared.")) {
                  resetFloorPlan();
                }
              }}
              className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800"
            >
              Reset
            </button>
          )}
        </div>
      </section>

      {plan.imageDataUrl && (
        <>
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              AI wall detection
            </h2>
            <button
              onClick={analyze}
              disabled={analyzing}
              className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {analyzing
                ? "Analyzing floor plan…"
                : plan.walls.length > 0
                  ? "Re-detect walls with AI"
                  : "Detect walls with AI"}
            </button>
            {analysisError && <p className="mt-2 text-xs text-red-400">{analysisError}</p>}
            {analyzing && (
              <p className="mt-2 text-xs text-zinc-500">
                Two AI passes: detection, then self-correction against an overlay. Complex plans
                can take a few minutes.
              </p>
            )}
            {analysisNotes && !analyzing && (
              <p className="mt-2 rounded bg-zinc-800/60 p-2 text-[11px] leading-relaxed text-zinc-400">
                <span className="font-medium text-zinc-300">AI notes:</span> {analysisNotes}
              </p>
            )}
            {plan.walls.length > 0 && (
              <p className="mt-2 text-xs text-zinc-500">
                {plan.walls.length} walls, {plan.openings.length} openings. Drag endpoints to fix
                them, or use the tools below.
              </p>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Tools
            </h2>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-zinc-800 p-1 text-sm">
              {(
                [
                  ["select", "Select"],
                  ["draw", "Draw wall"],
                  ["calibrate", "Scale"],
                ] as const
              ).map(([t, label]) => (
                <button
                  key={t}
                  onClick={() => setTool(t)}
                  className={`rounded-md px-2 py-1.5 transition ${
                    tool === t ? "bg-zinc-600 text-white" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-zinc-500">
              {tool === "select" &&
                "Click a wall to select it. Drag endpoints to move them, drag the middle to move the whole wall. Press Delete to remove."}
              {tool === "draw" && "Click once for the wall start, again for the end. Esc cancels."}
              {tool === "calibrate" &&
                "Click two points over a known distance (e.g. a labeled wall), then enter its real length."}
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Scale &amp; walls
            </h2>
            <div className="space-y-2 text-sm">
              <label className="flex items-center justify-between gap-2">
                <span className="text-zinc-400">Pixels per meter</span>
                <input
                  type="number"
                  min={1}
                  value={Math.round(plan.pixelsPerMeter * 100) / 100}
                  onChange={(e) =>
                    updateFloorPlan({ pixelsPerMeter: Math.max(1, Number(e.target.value) || 1) })
                  }
                  className="w-24 rounded bg-zinc-800 px-2 py-1 text-right"
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-zinc-400">Wall height (m)</span>
                <input
                  type="number"
                  step={0.1}
                  min={1}
                  max={6}
                  value={plan.wallHeightM}
                  onChange={(e) =>
                    updateFloorPlan({ wallHeightM: Math.max(1, Number(e.target.value) || 2.5) })
                  }
                  className="w-24 rounded bg-zinc-800 px-2 py-1 text-right"
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-zinc-400">Wall thickness (m)</span>
                <input
                  type="number"
                  step={0.01}
                  min={0.05}
                  max={0.5}
                  value={plan.wallThicknessM}
                  onChange={(e) =>
                    updateFloorPlan({
                      wallThicknessM: Math.max(0.05, Number(e.target.value) || 0.12),
                    })
                  }
                  className="w-24 rounded bg-zinc-800 px-2 py-1 text-right"
                />
              </label>
            </div>
          </section>

          {selectedWall && (
            <section className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Selected wall · {wallLengthM(plan, selectedWall).toFixed(2)} m
                </h2>
                <button
                  onClick={() => deleteWall(selectedWall.id)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Delete wall
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    addOpening({
                      id: newId(),
                      wallId: selectedWall.id,
                      type: "door",
                      t0: 0.4,
                      t1: 0.6,
                    })
                  }
                  className="flex-1 rounded bg-zinc-700 px-2 py-1.5 text-xs hover:bg-zinc-600"
                >
                  + Door
                </button>
                <button
                  onClick={() =>
                    addOpening({
                      id: newId(),
                      wallId: selectedWall.id,
                      type: "window",
                      t0: 0.35,
                      t1: 0.65,
                    })
                  }
                  className="flex-1 rounded bg-zinc-700 px-2 py-1.5 text-xs hover:bg-zinc-600"
                >
                  + Window
                </button>
              </div>
              {wallOpenings.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {wallOpenings.map((o) => (
                    <li
                      key={o.id}
                      className="flex items-center justify-between rounded bg-zinc-800 px-2 py-1 text-xs"
                    >
                      <span className="capitalize text-zinc-300">
                        {o.type} · {((o.t1 - o.t0) * wallLengthM(plan, selectedWall)).toFixed(2)} m
                        wide
                      </span>
                      <button
                        onClick={() => deleteOpening(o.id)}
                        className="text-red-400 hover:text-red-300"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[11px] text-zinc-500">
                Drag the door/window markers on the plan to reposition them.
              </p>
            </section>
          )}

          <section className="mt-auto">
            <button
              onClick={() => setMode("room")}
              disabled={plan.walls.length === 0}
              className="w-full rounded-md bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              Build 3D room →
            </button>
          </section>
        </>
      )}
    </div>
  );
}
