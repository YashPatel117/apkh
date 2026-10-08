"use client";

import { RefObject, useEffect, useRef } from "react";
import * as THREE from "three";

export interface StageContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  /** CSS pixels of the container */
  size: { width: number; height: number };
  /** Pointer in -1..1 (y up), eased by the scene itself */
  pointer: { x: number; y: number; inside: boolean };
  reducedMotion: boolean;
  dark: boolean;
}

export interface StageScene {
  /** t = seconds since mount, dt = seconds since last frame */
  update: (t: number, dt: number) => void;
  resize?: () => void;
  theme?: (dark: boolean) => void;
  dispose: () => void;
}

interface StageOptions {
  fov?: number;
  /** Frame cap; ambient backdrops don't need 120 fps behind blurred glass */
  maxFps?: number;
  maxPixelRatio?: number;
  /** Listen to the pointer on the whole window instead of the container */
  windowPointer?: boolean;
  /** Keep rendering under reduced motion: the user drives the camera (scenes drop their own motion) */
  interactive?: boolean;
}

/**
 * Owns a WebGL canvas inside `containerRef`: sizing, pixel ratio, pausing while
 * off-screen or in a hidden tab, theme changes and disposal. Each scene only
 * builds its objects and animates them.
 */
export function useThreeStage(
  containerRef: RefObject<HTMLElement | null>,
  build: (ctx: StageContext) => StageScene,
  options: StageOptions = {},
) {
  const buildRef = useRef(build);
  buildRef.current = build;
  const { fov = 45, maxFps = 60, maxPixelRatio = 2, windowPointer = false, interactive = false } = options;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      return; // no WebGL: the page still works, just without the scene
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.setAttribute("aria-hidden", "true");
    container.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 200);
    const root = document.documentElement;
    const ctx: StageContext = {
      renderer,
      scene,
      camera,
      canvas,
      size: { width: 1, height: 1 },
      pointer: { x: 0, y: 0, inside: false },
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      dark: root.classList.contains("dark"),
    };
    const stage = buildRef.current(ctx);

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      ctx.size.width = width;
      ctx.size.height = height;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      stage.resize?.();
      if (!running) renderOnce();
    };

    const pointerTarget: HTMLElement | Window = windowPointer ? window : container;
    const onPointer = (e: Event) => {
      const p = e as PointerEvent;
      const rect = windowPointer ? { left: 0, top: 0, width: innerWidth, height: innerHeight } : container.getBoundingClientRect();
      ctx.pointer.x = ((p.clientX - rect.left) / rect.width) * 2 - 1;
      ctx.pointer.y = -(((p.clientY - rect.top) / rect.height) * 2 - 1);
      ctx.pointer.inside = true;
    };
    const onLeave = () => (ctx.pointer.inside = false);
    pointerTarget.addEventListener("pointermove", onPointer, { passive: true });
    container.addEventListener("pointerleave", onLeave);

    let prev = performance.now();
    let elapsed = 0;
    let last = 0;
    let frame = 0;
    let running = false;
    let visible = true;
    const minFrame = 1 / maxFps;

    const renderOnce = () => {
      stage.update(elapsed, 0);
      renderer.render(scene, camera);
    };

    const loop = () => {
      frame = requestAnimationFrame(loop);
      const now = performance.now();
      last += (now - prev) / 1000;
      prev = now;
      if (last < minFrame - 0.002) return;
      const step = Math.min(last, 0.1);
      last = 0;
      elapsed += step;
      stage.update(elapsed, step);
      renderer.render(scene, camera);
    };

    const sync = () => {
      const shouldRun = visible && !document.hidden && (interactive || !ctx.reducedMotion);
      if (shouldRun && !running) {
        running = true;
        prev = performance.now();
        frame = requestAnimationFrame(loop);
      } else if (!shouldRun && running) {
        running = false;
        cancelAnimationFrame(frame);
      }
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    io.observe(container);
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    document.addEventListener("visibilitychange", sync);

    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => {
      ctx.reducedMotion = motion.matches;
      sync();
      if (!running) renderOnce();
    };
    motion.addEventListener("change", onMotion);

    const themeObserver = new MutationObserver(() => {
      const dark = root.classList.contains("dark");
      if (dark === ctx.dark) return;
      ctx.dark = dark;
      stage.theme?.(dark);
      if (!running) renderOnce();
    });
    themeObserver.observe(root, { attributes: true, attributeFilter: ["class"] });

    resize();
    stage.theme?.(ctx.dark);
    renderOnce();
    sync();

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      io.disconnect();
      ro.disconnect();
      themeObserver.disconnect();
      motion.removeEventListener("change", onMotion);
      document.removeEventListener("visibilitychange", sync);
      pointerTarget.removeEventListener("pointermove", onPointer);
      container.removeEventListener("pointerleave", onLeave);
      stage.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, [containerRef, fov, maxFps, maxPixelRatio, windowPointer, interactive]);
}
