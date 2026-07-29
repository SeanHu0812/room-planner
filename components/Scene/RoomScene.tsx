"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas, ThreeEvent, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { usePlanner } from "@/lib/store";
import { roomExtentM } from "@/lib/scale";
import Walls from "./Walls";
import FurnitureItem from "./FurnitureItem";
import Inspector from "../Panels/Inspector";

type ViewRequest = "orbit" | "top" | null;

function DevProbe() {
  const state = useThree();
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      (window as unknown as Record<string, unknown>).__three = state;
    }
  });
  return null;
}

function CameraRig({
  request,
  onDone,
  extent,
}: {
  request: ViewRequest;
  onDone: () => void;
  extent: { width: number; depth: number };
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;

  useEffect(() => {
    if (!request) return;
    const dist = Math.max(extent.width, extent.depth);
    if (request === "top") {
      camera.position.set(0, dist * 1.4 + 3, 0.01);
    } else {
      camera.position.set(dist * 0.8, dist * 0.7 + 2, dist * 0.9);
    }
    camera.lookAt(0, 0, 0);
    controls?.target.set(0, 0, 0);
    controls?.update();
    onDone();
  }, [request, camera, controls, extent, onDone]);

  return null;
}

export default function RoomScene() {
  const project = usePlanner((s) => s.project);
  const assets = usePlanner((s) => s.assets);
  const selectedInstanceId = usePlanner((s) => s.selectedInstanceId);
  const setSelectedInstance = usePlanner((s) => s.setSelectedInstance);
  const updateInstance = usePlanner((s) => s.updateInstance);
  const deleteInstance = usePlanner((s) => s.deleteInstance);
  const duplicateInstance = usePlanner((s) => s.duplicateInstance);

  const plan = project.floorPlan;
  const extent = roomExtentM(plan);
  const [viewRequest, setViewRequest] = useState<ViewRequest>(null);

  // Dragging state: instance id + XZ offset between item origin and grab point
  const draggingRef = useRef<{ id: string; offset: [number, number] } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Keyboard: rotate / delete / duplicate
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      const id = usePlanner.getState().selectedInstanceId;
      if (!id) return;
      const inst = usePlanner.getState().project.instances.find((i) => i.id === id);
      if (!inst) return;
      if (e.key === "r" || e.key === "R") {
        const dir = e.shiftKey ? -1 : 1;
        updateInstance(id, { rotationY: inst.rotationY + (dir * Math.PI) / 12 });
      } else if (e.key === "Delete" || e.key === "Backspace") {
        deleteInstance(id);
      } else if ((e.key === "d" || e.key === "D") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        duplicateInstance(id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [updateInstance, deleteInstance, duplicateInstance]);

  function startDrag(instanceId: string, e: ThreeEvent<PointerEvent>) {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelectedInstance(instanceId);
    const inst = usePlanner.getState().project.instances.find((i) => i.id === instanceId);
    if (!inst) return;
    // Project the grab ray onto the floor plane to get a stable offset
    const hit = rayToFloor(e.ray);
    if (!hit) return;
    draggingRef.current = {
      id: instanceId,
      offset: [inst.position[0] - hit.x, inst.position[2] - hit.z],
    };
    setDragging(true);
  }

  function rayToFloor(ray: THREE.Ray): THREE.Vector3 | null {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const out = new THREE.Vector3();
    return ray.intersectPlane(plane, out) ? out : null;
  }

  function onFloorMove(e: ThreeEvent<PointerEvent>) {
    const drag = draggingRef.current;
    if (!drag) return;
    const hit = rayToFloor(e.ray);
    if (!hit) return;
    updateInstance(drag.id, {
      position: [hit.x + drag.offset[0], 0, hit.z + drag.offset[1]],
    });
  }

  function endDrag() {
    draggingRef.current = null;
    setDragging(false);
  }

  return (
    <div className="relative h-full w-full">
      <Canvas
        shadows
        camera={{
          position: [extent.width * 0.8, extent.width * 0.7 + 2, extent.depth * 0.9],
          fov: 50,
        }}
        onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
        onPointerMissed={() => setSelectedInstance(null)}
        onPointerUp={endDrag}
      >
        <color attach="background" args={["#111318"]} />
        <hemisphereLight args={["#dfe8ff", "#3a3226", 0.7]} />
        <ambientLight intensity={0.25} />
        <directionalLight
          position={[8, 14, 6]}
          intensity={1.6}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-20}
          shadow-camera-right={20}
          shadow-camera-top={20}
          shadow-camera-bottom={-20}
        />

        <Walls plan={plan} />

        {/* Invisible drag plane covering the whole scene */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.001, 0]}
          visible={false}
          onPointerMove={onFloorMove}
          onPointerUp={endDrag}
        >
          <planeGeometry args={[500, 500]} />
          <meshBasicMaterial />
        </mesh>

        {project.instances.map((inst) => {
          const asset = assets[inst.assetId];
          if (!asset) return null;
          return (
            <FurnitureItem
              key={inst.id}
              instance={inst}
              asset={asset}
              selected={inst.id === selectedInstanceId}
              onPointerDown={(e) => startDrag(inst.id, e)}
            />
          );
        })}

        <OrbitControls
          makeDefault
          enabled={!dragging}
          maxPolarAngle={Math.PI / 2 - 0.02}
          minDistance={1}
          maxDistance={80}
        />
        <CameraRig request={viewRequest} onDone={() => setViewRequest(null)} extent={extent} />
        <DevProbe />
      </Canvas>

      {/* View controls */}
      <div className="absolute right-3 top-3 flex gap-2">
        <button
          onClick={() => setViewRequest("orbit")}
          className="rounded-md bg-zinc-900/90 px-3 py-1.5 text-xs text-zinc-300 shadow hover:bg-zinc-800"
        >
          Perspective
        </button>
        <button
          onClick={() => setViewRequest("top")}
          className="rounded-md bg-zinc-900/90 px-3 py-1.5 text-xs text-zinc-300 shadow hover:bg-zinc-800"
        >
          Top view
        </button>
      </div>

      {/* Hint */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md bg-zinc-900/80 px-3 py-1.5 text-[11px] text-zinc-500">
        Drag furniture to move · R rotates · Delete removes · ⌘D duplicates
      </div>

      <Inspector />
    </div>
  );
}
