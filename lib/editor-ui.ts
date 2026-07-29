"use client";

import { create } from "zustand";

export type EditorTool = "select" | "draw" | "calibrate";

interface EditorUIState {
  tool: EditorTool;
  /** In-progress wall draw: first click point (image px) */
  drawStart: { x: number; y: number } | null;
  /** In-progress calibration: first click point (image px) */
  calibStart: { x: number; y: number } | null;
  /** Pending calibration line waiting for a real-world length */
  calibLine: { x1: number; y1: number; x2: number; y2: number } | null;
  analyzing: boolean;
  analysisError: string | null;

  setTool: (tool: EditorTool) => void;
  setDrawStart: (p: { x: number; y: number } | null) => void;
  setCalibStart: (p: { x: number; y: number } | null) => void;
  setCalibLine: (l: EditorUIState["calibLine"]) => void;
  setAnalyzing: (v: boolean) => void;
  setAnalysisError: (e: string | null) => void;
}

export const useEditorUI = create<EditorUIState>((set) => ({
  tool: "select",
  drawStart: null,
  calibStart: null,
  calibLine: null,
  analyzing: false,
  analysisError: null,

  setTool: (tool) => set({ tool, drawStart: null, calibStart: null, calibLine: null }),
  setDrawStart: (drawStart) => set({ drawStart }),
  setCalibStart: (calibStart) => set({ calibStart }),
  setCalibLine: (calibLine) => set({ calibLine }),
  setAnalyzing: (analyzing) => set({ analyzing }),
  setAnalysisError: (analysisError) => set({ analysisError }),
}));
