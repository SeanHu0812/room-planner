"use client";

import { create } from "zustand";
import {
  FloorPlan,
  FurnitureAsset,
  FurnitureInstance,
  Opening,
  Project,
  Wall,
  defaultFloorPlan,
  newId,
} from "./types";
import { saveProjectDebounced, saveAssetsDebounced } from "./persistence";

export type AppMode = "plan" | "room";

interface PlannerState {
  mode: AppMode;
  project: Project;
  /** Furniture library, keyed by asset id */
  assets: Record<string, FurnitureAsset>;
  /** Selected instance id in the 3D scene */
  selectedInstanceId: string | null;
  /** Selected wall id in the 2D editor */
  selectedWallId: string | null;
  hydrated: boolean;

  setMode: (mode: AppMode) => void;
  setHydrated: (project: Project | null, assets: Record<string, FurnitureAsset>) => void;

  // Floor plan
  setFloorPlanImage: (dataUrl: string, width: number, height: number) => void;
  setAnalysis: (walls: Wall[], openings: Opening[], pixelsPerMeter: number | null) => void;
  updateFloorPlan: (patch: Partial<FloorPlan>) => void;
  updateWall: (id: string, patch: Partial<Wall>) => void;
  addWall: (wall: Wall) => void;
  deleteWall: (id: string) => void;
  setSelectedWall: (id: string | null) => void;
  addOpening: (opening: Opening) => void;
  deleteOpening: (id: string) => void;
  resetFloorPlan: () => void;

  // Library assets
  upsertAsset: (asset: FurnitureAsset) => void;
  deleteAsset: (id: string) => void;

  // Instances
  addInstance: (assetId: string, position?: [number, number, number]) => string;
  updateInstance: (id: string, patch: Partial<FurnitureInstance>) => void;
  deleteInstance: (id: string) => void;
  duplicateInstance: (id: string) => void;
  setSelectedInstance: (id: string | null) => void;

  // Project
  setProject: (project: Project) => void;
  renameProject: (name: string) => void;
}

function emptyProject(): Project {
  return {
    id: newId(),
    name: "My Room",
    floorPlan: defaultFloorPlan(),
    instances: [],
    updatedAt: Date.now(),
  };
}

function touch(project: Project): Project {
  return { ...project, updatedAt: Date.now() };
}

export const usePlanner = create<PlannerState>((set, get) => {
  const setProjectAndSave = (project: Project) => {
    const touched = touch(project);
    set({ project: touched });
    saveProjectDebounced(touched);
  };

  return {
    mode: "plan",
    project: emptyProject(),
    assets: {},
    selectedInstanceId: null,
    selectedWallId: null,
    hydrated: false,

    setMode: (mode) => set({ mode, selectedInstanceId: null, selectedWallId: null }),

    setHydrated: (project, assets) =>
      set({
        project: project ?? emptyProject(),
        assets,
        hydrated: true,
        mode: project && project.floorPlan.walls.length > 0 ? "room" : "plan",
      }),

    setFloorPlanImage: (dataUrl, width, height) => {
      const p = get().project;
      setProjectAndSave({
        ...p,
        floorPlan: {
          ...defaultFloorPlan(),
          imageDataUrl: dataUrl,
          imageWidth: width,
          imageHeight: height,
        },
      });
    },

    setAnalysis: (walls, openings, pixelsPerMeter) => {
      const p = get().project;
      setProjectAndSave({
        ...p,
        floorPlan: {
          ...p.floorPlan,
          walls,
          openings,
          pixelsPerMeter: pixelsPerMeter ?? p.floorPlan.pixelsPerMeter,
        },
      });
    },

    updateFloorPlan: (patch) => {
      const p = get().project;
      setProjectAndSave({ ...p, floorPlan: { ...p.floorPlan, ...patch } });
    },

    updateWall: (id, patch) => {
      const p = get().project;
      setProjectAndSave({
        ...p,
        floorPlan: {
          ...p.floorPlan,
          walls: p.floorPlan.walls.map((w) => (w.id === id ? { ...w, ...patch } : w)),
        },
      });
    },

    addWall: (wall) => {
      const p = get().project;
      setProjectAndSave({
        ...p,
        floorPlan: { ...p.floorPlan, walls: [...p.floorPlan.walls, wall] },
      });
      set({ selectedWallId: wall.id });
    },

    deleteWall: (id) => {
      const p = get().project;
      setProjectAndSave({
        ...p,
        floorPlan: {
          ...p.floorPlan,
          walls: p.floorPlan.walls.filter((w) => w.id !== id),
          openings: p.floorPlan.openings.filter((o) => o.wallId !== id),
        },
      });
      if (get().selectedWallId === id) set({ selectedWallId: null });
    },

    setSelectedWall: (id) => set({ selectedWallId: id }),

    addOpening: (opening) => {
      const p = get().project;
      setProjectAndSave({
        ...p,
        floorPlan: { ...p.floorPlan, openings: [...p.floorPlan.openings, opening] },
      });
    },

    deleteOpening: (id) => {
      const p = get().project;
      setProjectAndSave({
        ...p,
        floorPlan: { ...p.floorPlan, openings: p.floorPlan.openings.filter((o) => o.id !== id) },
      });
    },

    resetFloorPlan: () => {
      const p = get().project;
      setProjectAndSave({ ...p, floorPlan: defaultFloorPlan(), instances: [] });
      set({ mode: "plan", selectedInstanceId: null, selectedWallId: null });
    },

    upsertAsset: (asset) => {
      const assets = { ...get().assets, [asset.id]: asset };
      set({ assets });
      saveAssetsDebounced(assets);
    },

    deleteAsset: (id) => {
      const assets = { ...get().assets };
      delete assets[id];
      set({ assets });
      saveAssetsDebounced(assets);
      // Remove instances that reference the deleted asset
      const p = get().project;
      const remaining = p.instances.filter((i) => i.assetId !== id);
      if (remaining.length !== p.instances.length) {
        setProjectAndSave({ ...p, instances: remaining });
      }
    },

    addInstance: (assetId, position) => {
      const p = get().project;
      const id = newId();
      const instance: FurnitureInstance = {
        id,
        assetId,
        position: position ?? [0, 0, 0],
        rotationY: 0,
      };
      setProjectAndSave({ ...p, instances: [...p.instances, instance] });
      set({ selectedInstanceId: id });
      return id;
    },

    updateInstance: (id, patch) => {
      const p = get().project;
      setProjectAndSave({
        ...p,
        instances: p.instances.map((i) => (i.id === id ? { ...i, ...patch } : i)),
      });
    },

    deleteInstance: (id) => {
      const p = get().project;
      setProjectAndSave({ ...p, instances: p.instances.filter((i) => i.id !== id) });
      if (get().selectedInstanceId === id) set({ selectedInstanceId: null });
    },

    duplicateInstance: (id) => {
      const p = get().project;
      const src = p.instances.find((i) => i.id === id);
      if (!src) return;
      const copy: FurnitureInstance = {
        ...src,
        id: newId(),
        position: [src.position[0] + 0.5, src.position[1], src.position[2] + 0.5],
      };
      setProjectAndSave({ ...p, instances: [...p.instances, copy] });
      set({ selectedInstanceId: copy.id });
    },

    setSelectedInstance: (id) => set({ selectedInstanceId: id }),

    setProject: (project) => setProjectAndSave(project),

    renameProject: (name) => {
      const p = get().project;
      setProjectAndSave({ ...p, name });
    },
  };
});
