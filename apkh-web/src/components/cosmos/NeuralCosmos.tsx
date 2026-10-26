"use client";

import { useRef } from "react";
import * as THREE from "three";
import { animate, type JSAnimation } from "animejs";
import { seeded } from "@/lib/motion";
import { onCosmos } from "@/lib/cosmosBus";
import { cn } from "@/lib/cn";
import { lineFragment, lineVertex, pointFragment, pointVertex } from "./shaders";
import { useThreeStage } from "./useThreeStage";

/**
 * "mind"  — two-lobed constellation that assembles from scattered fragments and
 *           (optionally) unwinds into a galaxy as the page scrolls. Landing + auth.
 * "field" — a wide, quiet star field behind the app. It "thinks" while the AI answers.
 */
type Variant = "mind" | "field";

interface NeuralCosmosProps {
  variant?: Variant;
  className?: string;
  /** Morph mind → galaxy over the first ~1.2 screens of window scroll */
  scrollMorph?: boolean;
  /** Clicking anywhere sends a shockwave through the stars */
  shockOnClick?: boolean;
  /** Shift the shape sideways (world units) to sit beside text */
  offsetX?: number;
}

const PALETTE = {
  dark: { a: "#7dd3fc", b: "#a78bfa", hot: "#fbbf24", line: "#818cf8" },
  light: { a: "#2563eb", b: "#7c3aed", hot: "#ea580c", line: "#6366f1" },
};

function gaussian(rand: () => number) {
  return Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());
}

function buildMind(count: number, rand: () => number) {
  const brain = new Float32Array(count * 3);
  const scatter = new Float32Array(count * 3);
  const galaxy = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // ── Brain: two ellipsoid lobes with folded (gyri-like) surfaces
    const side = i % 2 ? 1 : -1;
    const u = rand() * 2 - 1;
    const theta = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    let x = s * Math.cos(theta);
    const y = u;
    const z = s * Math.sin(theta);
    if (side * x < -0.55) x = -side * 0.55 + (x + side * 0.55) * 0.25; // flatten the inner face
    const fold = 1 + 0.07 * Math.sin(theta * 9 + u * 7) * Math.cos(u * 11 + theta * 3);
    const depth = rand() < 0.82 ? 0.94 + rand() * 0.06 : 0.35 + rand() * 0.55;
    const r = fold * depth;
    brain[i * 3] = (x * 0.82 + side * 0.86) * r;
    brain[i * 3 + 1] = y * 1.02 * r - (Math.abs(z) > 0.8 ? 0.08 : 0);
    brain[i * 3 + 2] = z * 1.42 * r;

    // ── Scatter: loose fragments drifting in a deep slab
    scatter[i * 3] = (rand() - 0.5) * 16;
    scatter[i * 3 + 1] = (rand() - 0.5) * 10;
    scatter[i * 3 + 2] = (rand() - 0.5) * 9 - 2;

    // ── Galaxy: four-armed spiral, flat in the spin plane (the group tilts it toward the camera)
    // Dense bright core, four tight arms winding out
    const radius = Math.pow(rand(), 1.5) * 3.9 + 0.08;
    const arm = (i % 4) * (Math.PI / 2);
    const angle = arm + radius * 1.75 + gaussian(rand) * (0.16 / Math.max(radius, 0.45));
    const gx = Math.cos(angle) * radius + gaussian(rand) * 0.05;
    const gz = Math.sin(angle) * radius + gaussian(rand) * 0.05;
    const gy = gaussian(rand) * 0.07 * (1 - radius / 4.5);
    galaxy[i * 3] = gx;
    galaxy[i * 3 + 1] = gy;
    galaxy[i * 3 + 2] = gz;
  }
  return { position: brain, scatter, galaxy };
}

function buildField(count: number, rand: () => number) {
  const position = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    position[i * 3] = (rand() - 0.5) * 22;
    position[i * 3 + 1] = (rand() - 0.5) * 13;
    position[i * 3 + 2] = -rand() * 9 - 1;
  }
  return { position, scatter: position, galaxy: position };
}

/** Each of the first `pool` stars links to its nearest neighbours within `maxDist`. */
function buildEdges(pos: Float32Array, pool: number, perNode: number, maxDist: number) {
  const pairs: [number, number][] = [];
  const seen = new Set<number>();
  const max2 = maxDist * maxDist;
  for (let i = 0; i < pool; i++) {
    const near: { j: number; d: number }[] = [];
    for (let j = 0; j < pool; j++) {
      if (i === j) continue;
      const dx = pos[i * 3] - pos[j * 3];
      const dy = pos[i * 3 + 1] - pos[j * 3 + 1];
      const dz = pos[i * 3 + 2] - pos[j * 3 + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < max2) near.push({ j, d });
    }
    near.sort((a, b) => a.d - b.d);
    for (const { j } of near.slice(0, perNode)) {
      const key = i < j ? i * 100000 + j : j * 100000 + i;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([i, j]);
    }
  }
  return pairs;
}

export function NeuralCosmos({ variant = "mind", className, scrollMorph = false, shockOnClick = false, offsetX = 0 }: NeuralCosmosProps) {
  const ref = useRef<HTMLDivElement>(null);
  const field = variant === "field";

  useThreeStage(
    ref,
    (ctx) => {
      const { scene, camera, renderer } = ctx;
      const rand = seeded(field ? 7 : 42);
      const small = ctx.size.width < 640 || window.innerWidth < 640;
      const count = field ? (small ? 380 : 720) : small ? 1400 : 2400;
      const shape = field ? buildField(count, rand) : buildMind(count, rand);

      const seeds = new Float32Array(count);
      const sizes = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        seeds[i] = rand();
        sizes[i] = (field ? 120 : 26) * (0.45 + Math.pow(rand(), 3) * 1.6);
      }

      const uniforms = {
        uTime: { value: 0 },
        uAssemble: { value: field || ctx.reducedMotion ? 1 : 0 },
        uGalaxy: { value: 0 },
        uDrift: { value: field ? 0.22 : 0.03 },
        uPulse: { value: 0 },
        uPulseRadius: { value: 0 },
        uPixelRatio: { value: renderer.getPixelRatio() },
        uSize: { value: 1 },
        uOpacity: { value: field ? 0.55 : 0.95 },
        uColorA: { value: new THREE.Color() },
        uColorB: { value: new THREE.Color() },
        uColorHot: { value: new THREE.Color() },
        uLineColor: { value: new THREE.Color() },
        uLineOpacity: { value: field ? 0.08 : 0.16 },
        uFire: { value: field ? 0.08 : 0.35 },
        uFireSpeed: { value: field ? 0.12 : 0.32 },
      };

      // ── Stars
      const pointGeo = new THREE.BufferGeometry();
      pointGeo.setAttribute("position", new THREE.BufferAttribute(shape.position, 3));
      pointGeo.setAttribute("aScatter", new THREE.BufferAttribute(shape.scatter, 3));
      pointGeo.setAttribute("aGalaxy", new THREE.BufferAttribute(shape.galaxy, 3));
      pointGeo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
      pointGeo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
      const pointMat = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: pointVertex,
        fragmentShader: pointFragment,
        transparent: true,
        depthWrite: false,
      });
      const points = new THREE.Points(pointGeo, pointMat);

      // ── Synapses (edges carry travelling sparks)
      const pool = Math.min(count, field ? count : small ? 600 : 900);
      const pairs = buildEdges(shape.position, pool, field ? 2 : 3, field ? 1.25 : 0.42);
      const lineCount = pairs.length * 2;
      const lPos = new Float32Array(lineCount * 3);
      const lScatter = new Float32Array(lineCount * 3);
      const lGalaxy = new Float32Array(lineCount * 3);
      const lSeed = new Float32Array(lineCount);
      const lProgress = new Float32Array(lineCount);
      const lEdge = new Float32Array(lineCount);
      pairs.forEach(([a, b], e) => {
        const edgeSeed = rand();
        [a, b].forEach((node, k) => {
          const v = e * 2 + k;
          for (let c = 0; c < 3; c++) {
            lPos[v * 3 + c] = shape.position[node * 3 + c];
            lScatter[v * 3 + c] = shape.scatter[node * 3 + c];
            lGalaxy[v * 3 + c] = shape.galaxy[node * 3 + c];
          }
          lSeed[v] = seeds[node];
          lProgress[v] = k;
          lEdge[v] = edgeSeed;
        });
      });
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute("position", new THREE.BufferAttribute(lPos, 3));
      lineGeo.setAttribute("aScatter", new THREE.BufferAttribute(lScatter, 3));
      lineGeo.setAttribute("aGalaxy", new THREE.BufferAttribute(lGalaxy, 3));
      lineGeo.setAttribute("aSeed", new THREE.BufferAttribute(lSeed, 1));
      lineGeo.setAttribute("aProgress", new THREE.BufferAttribute(lProgress, 1));
      lineGeo.setAttribute("aEdge", new THREE.BufferAttribute(lEdge, 1));
      const lineMat = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: lineVertex,
        fragmentShader: lineFragment,
        transparent: true,
        depthWrite: false,
      });
      const lines = new THREE.LineSegments(lineGeo, lineMat);

      const group = new THREE.Group();
      group.add(lines, points);
      scene.add(group);
      camera.position.set(0, field ? 0 : 0.35, field ? 6 : 6.4);
      camera.lookAt(0, 0, 0);

      const running: JSAnimation[] = [];
      const track = (a: JSAnimation) => {
        running.push(a);
        return a;
      };

      // Fragments gather into a mind on first paint.
      if (!field && !ctx.reducedMotion) {
        track(animate(uniforms.uAssemble, { value: [0, 1], duration: 2800, delay: 150, ease: "inOutExpo" }));
      }

      const shockwave = () => {
        if (ctx.reducedMotion) return;
        track(animate(uniforms.uPulseRadius, { value: [0.2, field ? 14 : 5.2], duration: field ? 2200 : 1500, ease: "outCubic" }));
        track(animate(uniforms.uPulse, { value: [1, 0], duration: field ? 2200 : 1500, ease: "inQuad" }));
      };

      let thinking = false;
      const offBus = onCosmos((signal) => {
        if (signal === "pulse") shockwave();
        if (signal === "think-start") {
          thinking = true;
          shockwave();
        }
        if (signal === "think-end") thinking = false;
      });

      const onClick = (e: PointerEvent) => {
        if (e.button === 0) shockwave();
      };
      if (shockOnClick) window.addEventListener("pointerdown", onClick);

      const rot = { x: 0, y: 0 };
      let wide = false;
      // Behind text on narrow screens the mind steps back so copy stays readable.
      const applyLook = () => {
        const p = ctx.dark ? PALETTE.dark : PALETTE.light;
        uniforms.uColorA.value.set(p.a);
        uniforms.uColorB.value.set(p.b);
        uniforms.uColorHot.value.set(p.hot);
        uniforms.uLineColor.value.set(p.line);
        const blending = ctx.dark ? THREE.AdditiveBlending : THREE.NormalBlending;
        pointMat.blending = blending;
        lineMat.blending = blending;
        pointMat.needsUpdate = true;
        lineMat.needsUpdate = true;
        const dim = !field && !wide ? 0.55 : 1;
        uniforms.uOpacity.value = (field ? (ctx.dark ? 0.75 : 0.5) : ctx.dark ? 0.95 : 0.8) * dim;
        uniforms.uLineOpacity.value = (field ? (ctx.dark ? 0.05 : 0.04) : ctx.dark ? 0.16 : 0.12) * dim;
      };
      const baseFire = uniforms.uFire.value;
      const baseSpeed = uniforms.uFireSpeed.value;

      return {
        update(t, dt) {
          uniforms.uTime.value = t;
          const k = 1 - Math.pow(0.04, dt || 1); // frame-rate independent easing

          // Thinking: more synapses fire, faster.
          uniforms.uFire.value += ((thinking ? 0.85 : baseFire) - uniforms.uFire.value) * k;
          uniforms.uFireSpeed.value += ((thinking ? baseSpeed * 2.4 : baseSpeed) - uniforms.uFireSpeed.value) * k;

          if (scrollMorph) {
            const progress = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 1.2)));
            uniforms.uGalaxy.value += (progress - uniforms.uGalaxy.value) * k;
          }

          const px = ctx.pointer.inside || field ? ctx.pointer.x : 0;
          const py = ctx.pointer.inside || field ? ctx.pointer.y : 0;
          rot.x += (py * (field ? 0.06 : 0.25) - rot.x) * k;
          rot.y += (px * (field ? 0.1 : 0.45) - rot.y) * k;
          const spin = field ? t * 0.012 : t * 0.08;
          // Euler XYZ: the spin turns the disk within its own plane, then the X tilt shows its face.
          group.rotation.set(rot.x + uniforms.uGalaxy.value * 1.0, spin + rot.y, 0);
          // Beside the copy on wide screens (the hero text, then the Constellation card).
          group.position.x = wide ? offsetX : 0;
          if (!field) camera.position.z = 6.4 + uniforms.uGalaxy.value * 0.6;
        },
        resize() {
          uniforms.uPixelRatio.value = renderer.getPixelRatio();
          wide = ctx.size.width >= 1024;
          if (!field) {
            uniforms.uSize.value = ctx.size.width < 640 ? 0.8 : 1;
            group.scale.setScalar(ctx.size.width < 640 ? 0.78 : 1);
          }
          applyLook();
        },
        theme() {
          applyLook();
        },
        dispose() {
          running.forEach((a) => a.pause());
          offBus();
          if (shockOnClick) window.removeEventListener("pointerdown", onClick);
          pointGeo.dispose();
          lineGeo.dispose();
          pointMat.dispose();
          lineMat.dispose();
        },
      };
    },
    { maxFps: field ? 30 : 60, maxPixelRatio: field ? 1.25 : 2, windowPointer: true },
  );

  return <div ref={ref} aria-hidden className={cn("pointer-events-none", className)} />;
}
