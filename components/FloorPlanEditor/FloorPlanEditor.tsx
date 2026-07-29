"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePlanner } from "@/lib/store";
import { useEditorUI } from "@/lib/editor-ui";
import { prepareFloorPlanImage } from "@/lib/image";
import { Wall, newId } from "@/lib/types";

interface View {
  cx: number;
  cy: number;
  /** image pixels per screen pixel */
  scale: number;
}

type DragState =
  | { kind: "pan"; startClient: [number, number]; startView: View }
  | { kind: "endpoint"; wallId: string; end: 1 | 2 }
  | { kind: "wall"; wallId: string; startImg: [number, number]; startWall: Wall }
  | { kind: "opening"; openingId: string; wallId: string }
  | null;

const SNAP_SCREEN_PX = 12;
const ANGLE_SNAP_DEG = 8;

export default function FloorPlanEditor() {
  const project = usePlanner((s) => s.project);
  const setFloorPlanImage = usePlanner((s) => s.setFloorPlanImage);
  const updateWall = usePlanner((s) => s.updateWall);
  const addWall = usePlanner((s) => s.addWall);
  const deleteWall = usePlanner((s) => s.deleteWall);
  const selectedWallId = usePlanner((s) => s.selectedWallId);
  const setSelectedWall = usePlanner((s) => s.setSelectedWall);
  const updateFloorPlan = usePlanner((s) => s.updateFloorPlan);

  const tool = useEditorUI((s) => s.tool);
  const setTool = useEditorUI((s) => s.setTool);
  const drawStart = useEditorUI((s) => s.drawStart);
  const setDrawStart = useEditorUI((s) => s.setDrawStart);
  const calibStart = useEditorUI((s) => s.calibStart);
  const setCalibStart = useEditorUI((s) => s.setCalibStart);

  const plan = project.floorPlan;

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ cx: 0, cy: 0, scale: 1 });
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const dragRef = useRef<DragState>(null);
  const movedRef = useRef(false);

  // Track container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Fit view when a new image loads
  const imageKey = plan.imageDataUrl?.slice(0, 64) ?? "";
  useEffect(() => {
    if (!plan.imageWidth || !size.w || !size.h) return;
    const scale = Math.max(plan.imageWidth / size.w, plan.imageHeight / size.h) * 1.05;
    setView({ cx: plan.imageWidth / 2, cy: plan.imageHeight / 2, scale });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageKey, plan.imageWidth, plan.imageHeight]);

  const clientToImage = useCallback(
    (clientX: number, clientY: number): [number, number] => {
      const rect = svgRef.current!.getBoundingClientRect();
      return [
        view.cx + (clientX - rect.left - rect.width / 2) * view.scale,
        view.cy + (clientY - rect.top - rect.height / 2) * view.scale,
      ];
    },
    [view]
  );

  /** Snap a point to nearby wall endpoints, then optionally to 45° increments from an anchor. */
  const snapPoint = useCallback(
    (
      p: [number, number],
      opts: { excludeWallId?: string; anchor?: [number, number] }
    ): [number, number] => {
      const threshold = SNAP_SCREEN_PX * view.scale;
      let best: [number, number] | null = null;
      let bestDist = threshold;
      for (const w of plan.walls) {
        if (w.id === opts.excludeWallId) continue;
        for (const cand of [
          [w.x1, w.y1],
          [w.x2, w.y2],
        ] as [number, number][]) {
          const d = Math.hypot(cand[0] - p[0], cand[1] - p[1]);
          if (d < bestDist) {
            bestDist = d;
            best = cand;
          }
        }
      }
      if (best) return best;

      if (opts.anchor) {
        const [ax, ay] = opts.anchor;
        const dx = p[0] - ax;
        const dy = p[1] - ay;
        const dist = Math.hypot(dx, dy);
        if (dist > 1) {
          const angle = Math.atan2(dy, dx);
          const step = Math.PI / 4;
          const snapped = Math.round(angle / step) * step;
          if (Math.abs(angle - snapped) < (ANGLE_SNAP_DEG * Math.PI) / 180) {
            return [ax + dist * Math.cos(snapped), ay + dist * Math.sin(snapped)];
          }
        }
      }
      return p;
    },
    [plan.walls, view.scale]
  );

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedWallId) {
        deleteWall(selectedWallId);
      }
      if (e.key === "Escape") {
        setDrawStart(null);
        setCalibStart(null);
        setSelectedWall(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedWallId, deleteWall, setDrawStart, setCalibStart, setSelectedWall]);

  function onWheel(e: React.WheelEvent) {
    const rect = svgRef.current!.getBoundingClientRect();
    const factor = Math.exp(e.deltaY * 0.0015);
    const newScale = Math.min(Math.max(view.scale * factor, 0.05), 50);
    const sx = e.clientX - rect.left - rect.width / 2;
    const sy = e.clientY - rect.top - rect.height / 2;
    // Keep the image point under the cursor fixed
    const px = view.cx + sx * view.scale;
    const py = view.cy + sy * view.scale;
    setView({ cx: px - sx * newScale, cy: py - sy * newScale, scale: newScale });
  }

  function onBackgroundPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const p = clientToImage(e.clientX, e.clientY);
    movedRef.current = false;

    if (tool === "draw") {
      const snapped = snapPoint(p, {
        anchor: drawStart ? [drawStart.x, drawStart.y] : undefined,
      });
      if (!drawStart) {
        setDrawStart({ x: snapped[0], y: snapped[1] });
      } else {
        if (Math.hypot(snapped[0] - drawStart.x, snapped[1] - drawStart.y) > 2) {
          addWall({ id: newId(), x1: drawStart.x, y1: drawStart.y, x2: snapped[0], y2: snapped[1] });
        }
        setDrawStart(null);
      }
      return;
    }

    if (tool === "calibrate") {
      if (!calibStart) {
        setCalibStart({ x: p[0], y: p[1] });
      } else {
        const distPx = Math.hypot(p[0] - calibStart.x, p[1] - calibStart.y);
        setCalibStart(null);
        if (distPx > 2) {
          const input = window.prompt(
            "Real-world length of the line you just drew, in meters (e.g. 3.5):"
          );
          const meters = Number(input);
          if (input && meters > 0) {
            updateFloorPlan({ pixelsPerMeter: distPx / meters });
            setTool("select");
          }
        }
      }
      return;
    }

    // select tool: start panning
    dragRef.current = { kind: "pan", startClient: [e.clientX, e.clientY], startView: view };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = clientToImage(e.clientX, e.clientY);
    setCursor(p);
    const drag = dragRef.current;
    if (!drag) return;
    movedRef.current = true;

    if (drag.kind === "pan") {
      const dx = (e.clientX - drag.startClient[0]) * drag.startView.scale;
      const dy = (e.clientY - drag.startClient[1]) * drag.startView.scale;
      setView({ ...drag.startView, cx: drag.startView.cx - dx, cy: drag.startView.cy - dy });
    } else if (drag.kind === "endpoint") {
      const wall = plan.walls.find((w) => w.id === drag.wallId);
      if (!wall) return;
      const anchor: [number, number] =
        drag.end === 1 ? [wall.x2, wall.y2] : [wall.x1, wall.y1];
      const snapped = snapPoint(p, { excludeWallId: wall.id, anchor });
      updateWall(
        wall.id,
        drag.end === 1 ? { x1: snapped[0], y1: snapped[1] } : { x2: snapped[0], y2: snapped[1] }
      );
    } else if (drag.kind === "wall") {
      const dx = p[0] - drag.startImg[0];
      const dy = p[1] - drag.startImg[1];
      updateWall(drag.wallId, {
        x1: drag.startWall.x1 + dx,
        y1: drag.startWall.y1 + dy,
        x2: drag.startWall.x2 + dx,
        y2: drag.startWall.y2 + dy,
      });
    } else if (drag.kind === "opening") {
      const wall = plan.walls.find((w) => w.id === drag.wallId);
      const opening = plan.openings.find((o) => o.id === drag.openingId);
      if (!wall || !opening) return;
      const len2 = (wall.x2 - wall.x1) ** 2 + (wall.y2 - wall.y1) ** 2;
      if (len2 < 1) return;
      const t =
        ((p[0] - wall.x1) * (wall.x2 - wall.x1) + (p[1] - wall.y1) * (wall.y2 - wall.y1)) / len2;
      const width = opening.t1 - opening.t0;
      const t0 = Math.min(Math.max(t - width / 2, 0), 1 - width);
      const openings = plan.openings.map((o) =>
        o.id === opening.id ? { ...o, t0, t1: t0 + width } : o
      );
      updateFloorPlan({ openings });
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const drag = dragRef.current;
    dragRef.current = null;
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {
      // pointer capture may not be set
    }
    // Click on empty background without moving = deselect
    if (drag?.kind === "pan" && !movedRef.current && tool === "select") {
      setSelectedWall(null);
    }
  }

  async function handleDrop(file: File) {
    const { dataUrl, width, height } = await prepareFloorPlanImage(file);
    setFloorPlanImage(dataUrl, width, height);
  }

  // ---- No image yet: dropzone ----
  if (!plan.imageDataUrl) {
    return (
      <div
        className="flex h-full items-center justify-center p-8"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f?.type.startsWith("image/")) handleDrop(f);
        }}
      >
        <label className="flex max-w-md cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-zinc-700 p-12 text-center hover:border-emerald-600 hover:bg-zinc-900">
          <span className="text-4xl">🏠</span>
          <span className="text-lg font-medium text-zinc-200">Upload a floor plan</span>
          <span className="text-sm text-zinc-500">
            Drop an image here or click to browse. AI will detect the walls, then you can fix them
            and set the scale before building your 3D room.
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleDrop(f);
            }}
          />
        </label>
      </div>
    );
  }

  const vbW = size.w * view.scale;
  const vbH = size.h * view.scale;
  const viewBox = `${view.cx - vbW / 2} ${view.cy - vbH / 2} ${vbW} ${vbH}`;
  const thicknessPx = Math.max(plan.wallThicknessM * plan.pixelsPerMeter, 2);
  const s = view.scale; // shorthand for screen-constant sizes

  return (
    <div ref={containerRef} className="h-full w-full overflow-hidden">
      <svg
        ref={svgRef}
        viewBox={viewBox}
        className="h-full w-full touch-none select-none"
        style={{ cursor: tool === "select" ? "default" : "crosshair" }}
        onWheel={onWheel}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <image
          href={plan.imageDataUrl}
          x={0}
          y={0}
          width={plan.imageWidth}
          height={plan.imageHeight}
          opacity={0.55}
        />

        {/* Walls */}
        {plan.walls.map((w) => {
          const selected = w.id === selectedWallId;
          return (
            <g key={w.id}>
              <line
                x1={w.x1}
                y1={w.y1}
                x2={w.x2}
                y2={w.y2}
                stroke={selected ? "#f59e0b" : "#3b82f6"}
                strokeWidth={thicknessPx}
                strokeLinecap="round"
                opacity={0.75}
              />
              {/* Fat invisible hit area */}
              <line
                x1={w.x1}
                y1={w.y1}
                x2={w.x2}
                y2={w.y2}
                stroke="transparent"
                strokeWidth={Math.max(thicknessPx, 16 * s)}
                strokeLinecap="round"
                style={{ cursor: tool === "select" ? "move" : undefined }}
                onPointerDown={(e) => {
                  if (tool !== "select" || e.button !== 0) return;
                  e.stopPropagation();
                  setSelectedWall(w.id);
                  movedRef.current = false;
                  dragRef.current = {
                    kind: "wall",
                    wallId: w.id,
                    startImg: clientToImage(e.clientX, e.clientY),
                    startWall: { ...w },
                  };
                  (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId);
                }}
              />
            </g>
          );
        })}

        {/* Openings */}
        {plan.openings.map((o) => {
          const w = plan.walls.find((wl) => wl.id === o.wallId);
          if (!w) return null;
          const lerp = (t: number): [number, number] => [
            w.x1 + (w.x2 - w.x1) * t,
            w.y1 + (w.y2 - w.y1) * t,
          ];
          const [ax, ay] = lerp(o.t0);
          const [bx, by] = lerp(o.t1);
          return (
            <line
              key={o.id}
              x1={ax}
              y1={ay}
              x2={bx}
              y2={by}
              stroke={o.type === "door" ? "#f97316" : "#22d3ee"}
              strokeWidth={thicknessPx * 1.15}
              strokeLinecap="butt"
              style={{ cursor: "grab" }}
              onPointerDown={(e) => {
                if (tool !== "select" || e.button !== 0) return;
                e.stopPropagation();
                setSelectedWall(o.wallId);
                dragRef.current = { kind: "opening", openingId: o.id, wallId: o.wallId };
                (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId);
              }}
            />
          );
        })}

        {/* Endpoints of selected wall (draggable) + others (small) */}
        {tool === "select" &&
          plan.walls.map((w) => {
            const selected = w.id === selectedWallId;
            const r = (selected ? 7 : 3.5) * s;
            return (
              <g key={`pts-${w.id}`}>
                {([1, 2] as const).map((end) => (
                  <circle
                    key={end}
                    cx={end === 1 ? w.x1 : w.x2}
                    cy={end === 1 ? w.y1 : w.y2}
                    r={r}
                    fill={selected ? "#fbbf24" : "#93c5fd"}
                    stroke="#0a0a0a"
                    strokeWidth={1.5 * s}
                    style={{ cursor: "grab" }}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.stopPropagation();
                      setSelectedWall(w.id);
                      dragRef.current = { kind: "endpoint", wallId: w.id, end };
                      (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(
                        e.pointerId
                      );
                    }}
                  />
                ))}
              </g>
            );
          })}

        {/* Draw preview */}
        {tool === "draw" && drawStart && cursor && (
          <line
            x1={drawStart.x}
            y1={drawStart.y}
            x2={cursor[0]}
            y2={cursor[1]}
            stroke="#34d399"
            strokeWidth={thicknessPx}
            strokeDasharray={`${8 * s} ${6 * s}`}
            opacity={0.8}
            pointerEvents="none"
          />
        )}

        {/* Calibration preview */}
        {tool === "calibrate" && calibStart && cursor && (
          <g pointerEvents="none">
            <line
              x1={calibStart.x}
              y1={calibStart.y}
              x2={cursor[0]}
              y2={cursor[1]}
              stroke="#e879f9"
              strokeWidth={3 * s}
              strokeDasharray={`${6 * s} ${5 * s}`}
            />
            <circle cx={calibStart.x} cy={calibStart.y} r={5 * s} fill="#e879f9" />
          </g>
        )}
      </svg>

      {/* Scale readout */}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-zinc-900/90 px-3 py-1.5 text-xs text-zinc-400">
        Scale: {plan.pixelsPerMeter.toFixed(1)} px/m · {plan.walls.length} walls
      </div>
    </div>
  );
}
