"use client";

import { RefObject, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { animate, type JSAnimation } from "animejs";
import { cn } from "@/lib/cn";
import { clusterColor, layoutSky, SkyLayout, StarNote } from "./constellationLayout";
import { useThreeStage } from "./useThreeStage";

export interface ConstellationApi {
  setData: (notes: StarNote[]) => void;
  /** Stars matching the current search/filter stay lit; null = no filter */
  setHighlight: (ids: Set<string> | null) => void;
  /** Notes cited by the last AI answer: beams run from the question to them */
  setBeams: (ids: string[]) => void;
  /** Dim every constellation but this one (legend hover) */
  setFocus: (category: string | null) => void;
  /** Fly to a constellation; null = the whole sky */
  flyTo: (category: string | null) => void;
  setAutoRotate: (on: boolean) => void;
}

interface ConstellationProps {
  className?: string;
  apiRef: RefObject<ConstellationApi | null>;
  /** Overlay the scene fills with constellation names */
  labelsRef: RefObject<HTMLDivElement | null>;
  /** Overlay element the scene pins to the hovered star */
  tooltipRef: RefObject<HTMLDivElement | null>;
  /** Overlay element the scene pins to the question node */
  questionRef: RefObject<HTMLDivElement | null>;
  onHover: (note: StarNote | null) => void;
  onOpen: (id: string) => void;
  onInteract?: () => void;
}

const starVertex = /* glsl */ `
  uniform float uTime;
  uniform float uIntro;
  uniform float uScale;
  uniform float uHover;
  uniform float uDim;
  uniform float uBeams;
  uniform float uStill;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aSeed;
  attribute float aIndex;
  attribute float aLit;
  attribute float aHot;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vHot;
  varying float vHover;

  void main() {
    float k = clamp(uIntro * 1.6 - aSeed * 0.6, 0.0, 1.0);
    k = 1.0 - pow(1.0 - k, 3.0);
    vec3 p = mix(position * 0.04, position, k);
    p += (1.0 - uStill) * 0.035 * vec3(sin(uTime * 0.7 + aSeed * 50.0), cos(uTime * 0.6 + aSeed * 31.0), sin(uTime * 0.8 + aSeed * 13.0));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float hover = 1.0 - step(0.5, abs(aIndex - uHover));
    float lit = mix(1.0, aLit, uDim);
    float twinkle = 0.88 + 0.12 * sin(uTime * 2.0 + aSeed * 70.0) * (1.0 - uStill);
    float hot = aHot * uBeams;
    gl_PointSize = aSize * uScale / -mv.z * twinkle * (1.0 + hover * 0.8 + hot * 0.7) * (0.6 + 0.4 * lit);
    vColor = aColor;
    vAlpha = (0.12 + 0.88 * max(lit, hot)) * k;
    vHot = hot;
    vHover = hover;
  }
`;

const starFragment = /* glsl */ `
  uniform float uTime;
  uniform float uNight;
  uniform vec3 uHotColor;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vHot;
  varying float vHover;

  void main() {
    float r = length(gl_PointCoord - 0.5);
    float core = smoothstep(0.17, 0.02, r);
    float halo = pow(smoothstep(0.5, 0.0, r), 2.4) * mix(0.25, 0.6, uNight);
    float ring = smoothstep(0.035, 0.0, abs(r - 0.36 - 0.05 * sin(uTime * 4.0))) * vHot;
    float hoverRing = smoothstep(0.03, 0.0, abs(r - 0.44)) * vHover;
    vec3 col = mix(vColor, vec3(1.0), core * 0.55 * uNight);
    col = mix(col, uHotColor, vHot * 0.55);
    float a = (core + halo + ring + hoverRing) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, min(a, 1.0));
  }
`;

const nebulaVertex = /* glsl */ `
  uniform float uIntro;
  uniform float uScale;
  uniform float uDim;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aLit;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / -mv.z * uIntro;
    vColor = aColor;
    vAlpha = mix(1.0, 0.25 + 0.75 * aLit, uDim);
  }
`;

const nebulaFragment = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    float a = exp(-r * r * 18.0) * uOpacity * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

const edgeVertex = /* glsl */ `
  uniform float uIntro;
  uniform float uDim;
  attribute vec3 aColor;
  attribute float aSeed;
  attribute float aAlpha;
  attribute float aLit;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float k = clamp(uIntro * 1.6 - aSeed * 0.6, 0.0, 1.0);
    k = 1.0 - pow(1.0 - k, 3.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(mix(position * 0.04, position, k), 1.0);
    vColor = aColor;
    vAlpha = aAlpha * k * mix(1.0, 0.1 + 0.9 * aLit, uDim);
  }
`;

const edgeFragment = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(vColor, vAlpha * uOpacity);
  }
`;

const beamVertex = /* glsl */ `
  attribute float aProgress;
  attribute float aSeed;
  varying float vProgress;
  varying float vSeed;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vProgress = aProgress;
    vSeed = aSeed;
  }
`;

const beamFragment = /* glsl */ `
  uniform float uTime;
  uniform float uReveal;
  uniform vec3 uHotColor;
  uniform float uOpacity;
  varying float vProgress;
  varying float vSeed;
  void main() {
    if (vProgress > uReveal) discard;
    float pulse = 0.0;
    for (int i = 0; i < 3; i++) {
      float head = fract(uTime * 0.45 + vSeed + float(i) / 3.0);
      pulse += smoothstep(0.07, 0.0, abs(vProgress - head));
    }
    float a = (0.28 + pulse * 0.9) * uOpacity;
    gl_FragColor = vec4(mix(uHotColor, vec3(1.0), pulse * 0.35), a);
  }
`;

export function Constellation({ className, apiRef, labelsRef, tooltipRef, questionRef, onHover, onOpen, onInteract }: ConstellationProps) {
  const ref = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onHover, onOpen, onInteract });
  handlers.current = { onHover, onOpen, onInteract };

  useThreeStage(
    ref,
    (ctx) => {
      const { scene, camera, renderer, canvas } = ctx;
      camera.fov = 50;
      camera.far = 600;
      camera.updateProjectionMatrix();

      const controls = new OrbitControls(camera, canvas);
      controls.enableDamping = true;
      controls.dampingFactor = 0.07;
      controls.rotateSpeed = 0.6;
      controls.autoRotate = !ctx.reducedMotion;
      controls.autoRotateSpeed = 0.35;
      controls.enablePan = true;
      controls.addEventListener("start", () => handlers.current.onInteract?.());

      const shared = {
        uTime: { value: 0 },
        uIntro: { value: 0 },
        uScale: { value: 600 },
        uDim: { value: 0 },
        uNight: { value: 1 },
        uHotColor: { value: new THREE.Color("#fbbf24") },
        uStill: { value: ctx.reducedMotion ? 1 : 0 },
      };
      const starUniforms = { ...shared, uHover: { value: -1 }, uBeams: { value: 0 } };
      const nebulaUniforms = { uIntro: shared.uIntro, uScale: shared.uScale, uDim: shared.uDim, uOpacity: { value: 0.12 } };
      const edgeUniforms = { uIntro: shared.uIntro, uDim: shared.uDim, uOpacity: { value: 1 } };
      const beamUniforms = { uTime: shared.uTime, uReveal: { value: 0 }, uHotColor: shared.uHotColor, uOpacity: { value: 1 } };

      const starMat = new THREE.ShaderMaterial({ uniforms: starUniforms, vertexShader: starVertex, fragmentShader: starFragment, transparent: true, depthWrite: false });
      const nebulaMat = new THREE.ShaderMaterial({ uniforms: nebulaUniforms, vertexShader: nebulaVertex, fragmentShader: nebulaFragment, transparent: true, depthWrite: false });
      const edgeMat = new THREE.ShaderMaterial({ uniforms: edgeUniforms, vertexShader: edgeVertex, fragmentShader: edgeFragment, transparent: true, depthWrite: false });
      const beamMat = new THREE.ShaderMaterial({ uniforms: beamUniforms, vertexShader: beamVertex, fragmentShader: beamFragment, transparent: true, depthWrite: false });
      const questionMat = new THREE.ShaderMaterial({
        uniforms: { ...shared, uHover: { value: -1 }, uBeams: { value: 1 } },
        vertexShader: starVertex,
        fragmentShader: starFragment,
        transparent: true,
        depthWrite: false,
      });
      const materials = [starMat, nebulaMat, edgeMat, beamMat, questionMat];

      // ── Far dust for depth
      const dustGeo = new THREE.BufferGeometry();
      const dust = new Float32Array(1400 * 3);
      for (let i = 0; i < 1400; i++) {
        const u = Math.random() * 2 - 1;
        const th = Math.random() * Math.PI * 2;
        const r = 120 + Math.random() * 140;
        const s = Math.sqrt(1 - u * u);
        dust.set([s * Math.cos(th) * r, u * r, s * Math.sin(th) * r], i * 3);
      }
      dustGeo.setAttribute("position", new THREE.BufferAttribute(dust, 3));
      const dustMat = new THREE.PointsMaterial({ size: 1.4, sizeAttenuation: false, transparent: true, depthWrite: false });
      scene.add(new THREE.Points(dustGeo, dustMat));

      const sky = new THREE.Group();
      scene.add(sky);

      // ── State rebuilt by setData
      let notes: StarNote[] = [];
      let layout: SkyLayout | null = null;
      let stars: THREE.Points | null = null;
      let nebulae: THREE.Points | null = null;
      let edges: THREE.LineSegments | null = null;
      let beams: THREE.LineSegments | null = null;
      let questionNode: THREE.Points | null = null;
      let labels: { el: HTMLElement; pos: THREE.Vector3 }[] = [];
      let highlight: Set<string> | null = null;
      let focus: string | null = null;
      let beamIds: string[] = [];
      let introDone = false;
      let hovered = -1;
      const running: JSAnimation[] = [];
      const track = (a: JSAnimation) => {
        running.push(a);
        return a;
      };

      const disposeObject = (obj: THREE.Points | THREE.LineSegments | null) => {
        if (!obj) return;
        sky.remove(obj);
        obj.geometry.dispose();
      };

      const colorFor = (clusterIndex: number) => new THREE.Color(clusterColor(layout!.clusters[clusterIndex], ctx.dark));

      const litOf = (i: number) => {
        const note = notes[i];
        const cluster = layout!.clusters[layout!.clusterOf[i]];
        return (!highlight || highlight.has(note.id)) && (!focus || cluster.name === focus) ? 1 : 0;
      };

      const refreshLit = () => {
        if (!layout || !stars) return;
        const lit = stars.geometry.getAttribute("aLit") as THREE.BufferAttribute;
        for (let i = 0; i < notes.length; i++) lit.setX(i, litOf(i));
        lit.needsUpdate = true;
        if (edges) {
          const edgeLit = edges.geometry.getAttribute("aLit") as THREE.BufferAttribute;
          const owner = edges.userData.owner as Int32Array;
          for (let v = 0; v < owner.length; v++) edgeLit.setX(v, litOf(owner[v]));
          edgeLit.needsUpdate = true;
        }
        if (nebulae) {
          const nebLit = nebulae.geometry.getAttribute("aLit") as THREE.BufferAttribute;
          layout.clusters.forEach((c, i) => nebLit.setX(i, !focus || c.name === focus ? 1 : 0));
          nebLit.needsUpdate = true;
        }
        const dim = highlight || focus ? 1 : 0;
        track(animate(shared.uDim, { value: dim, duration: ctx.reducedMotion ? 0 : 500, ease: "outQuad" }));
        labels.forEach(({ el }, i) => {
          el.style.opacity = !focus || layout!.clusters[i].name === focus ? "1" : "0.3";
        });
      };

      const recolor = () => {
        if (!layout) return;
        if (stars) {
          const attr = stars.geometry.getAttribute("aColor") as THREE.BufferAttribute;
          for (let i = 0; i < notes.length; i++) {
            const c = colorFor(layout.clusterOf[i]);
            attr.setXYZ(i, c.r, c.g, c.b);
          }
          attr.needsUpdate = true;
        }
        if (edges) {
          const attr = edges.geometry.getAttribute("aColor") as THREE.BufferAttribute;
          const owner = edges.userData.owner as Int32Array;
          for (let v = 0; v < owner.length; v++) {
            const c = colorFor(layout.clusterOf[owner[v]]);
            attr.setXYZ(v, c.r, c.g, c.b);
          }
          attr.needsUpdate = true;
        }
        if (nebulae) {
          const attr = nebulae.geometry.getAttribute("aColor") as THREE.BufferAttribute;
          layout.clusters.forEach((_, i) => {
            const c = colorFor(i);
            attr.setXYZ(i, c.r, c.g, c.b);
          });
          attr.needsUpdate = true;
        }
        labels.forEach(({ el }, i) => {
          const dot = el.querySelector<HTMLElement>("[data-dot]");
          if (dot) dot.style.background = clusterColor(layout!.clusters[i], ctx.dark);
        });
      };

      const buildBeams = () => {
        disposeObject(beams);
        disposeObject(questionNode);
        beams = null;
        questionNode = null;
        const hot = stars?.geometry.getAttribute("aHot") as THREE.BufferAttribute | undefined;
        const index = new Map(notes.map((n, i) => [n.id, i]));
        const targets = beamIds.map((id) => index.get(id)).filter((i): i is number => i !== undefined);
        if (hot) {
          for (let i = 0; i < notes.length; i++) hot.setX(i, 0);
          targets.forEach((i) => hot.setX(i, 1));
          hot.needsUpdate = true;
        }
        starUniforms.uBeams.value = targets.length ? 1 : 0;
        if (!layout || !targets.length) return;

        const q = layout.question;
        const pos = new Float32Array(targets.length * 6);
        const progress = new Float32Array(targets.length * 2);
        const seed = new Float32Array(targets.length * 2);
        targets.forEach((star, b) => {
          pos.set(q, b * 6);
          pos.set(layout!.positions.subarray(star * 3, star * 3 + 3), b * 6 + 3);
          progress.set([0, 1], b * 2);
          seed.set([b * 0.137, b * 0.137], b * 2);
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setAttribute("aProgress", new THREE.BufferAttribute(progress, 1));
        geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
        beams = new THREE.LineSegments(geo, beamMat);
        sky.add(beams);

        const qGeo = new THREE.BufferGeometry();
        qGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(q), 3));
        qGeo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array([1, 0.75, 0.2]), 3));
        qGeo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array([0.9]), 1));
        qGeo.setAttribute("aSeed", new THREE.BufferAttribute(new Float32Array([0.5]), 1));
        qGeo.setAttribute("aIndex", new THREE.BufferAttribute(new Float32Array([-5]), 1));
        qGeo.setAttribute("aLit", new THREE.BufferAttribute(new Float32Array([1]), 1));
        qGeo.setAttribute("aHot", new THREE.BufferAttribute(new Float32Array([1]), 1));
        questionNode = new THREE.Points(qGeo, questionMat);
        sky.add(questionNode);

        beamUniforms.uReveal.value = 0;
        track(animate(beamUniforms.uReveal, { value: 1, duration: ctx.reducedMotion ? 0 : 1600, ease: "inOutQuad" }));
      };

      const buildLabels = () => {
        const host = labelsRef.current;
        labels.forEach(({ el }) => el.remove());
        labels = [];
        if (!host || !layout) return;
        layout.clusters.forEach((cluster) => {
          const el = document.createElement("div");
          el.className = "star-label";
          const chip = document.createElement("span");
          chip.className =
            "flex -translate-x-1/2 -translate-y-full items-center gap-1.5 whitespace-nowrap rounded-full border border-line/60 bg-surface/70 px-2.5 py-1 text-[0.7rem] font-semibold text-fg shadow-sm backdrop-blur transition-opacity";
          const dot = document.createElement("span");
          dot.dataset.dot = "";
          dot.className = "size-1.5 rounded-full";
          dot.style.background = clusterColor(cluster, ctx.dark);
          const name = document.createElement("span");
          name.textContent = cluster.uncategorized ? (host.dataset.uncategorized ?? "—") : cluster.name;
          const count = document.createElement("span");
          count.className = "font-mono text-fg-subtle";
          count.textContent = String(cluster.count);
          chip.append(dot, name, count);
          el.append(chip);
          host.append(el);
          labels.push({ el, pos: new THREE.Vector3(cluster.center[0], cluster.center[1] + cluster.radius * 0.8 + 0.5, cluster.center[2]) });
        });
      };

      const fitDistance = () => (layout ? layout.extent * 2.1 + 4 : 12);

      const flyTo = (category: string | null, instant = false) => {
        if (!layout) return;
        const cluster = category === null ? null : layout.clusters.find((c) => c.name === category);
        const target = new THREE.Vector3(...(cluster ? cluster.center : layout.centroid));
        const distance = cluster ? cluster.radius * 3.4 + 4 : fitDistance();
        const dir = camera.position.clone().sub(controls.target).normalize();
        if (dir.lengthSq() < 0.5) dir.set(0, 0.35, 1).normalize();
        const pos = target.clone().add(dir.multiplyScalar(distance));
        if (instant || ctx.reducedMotion) {
          controls.target.copy(target);
          camera.position.copy(pos);
          controls.update();
          return;
        }
        const tween = { duration: 1500, ease: "inOutCubic" as const };
        track(animate(controls.target, { x: target.x, y: target.y, z: target.z, ...tween }));
        track(animate(camera.position, { x: pos.x, y: pos.y, z: pos.z, ...tween }));
      };

      const setData = (next: StarNote[]) => {
        notes = next;
        layout = layoutSky(notes);
        disposeObject(stars);
        disposeObject(nebulae);
        disposeObject(edges);
        hovered = -1;
        starUniforms.uHover.value = -1;
        const count = notes.length;

        // Stars
        const sizes = new Float32Array(count);
        const seeds = new Float32Array(count);
        const indices = new Float32Array(count);
        notes.forEach((note, i) => {
          sizes[i] = 0.22 + Math.min(note.weight, 6) * 0.045;
          seeds[i] = (i * 0.61803) % 1;
          indices[i] = i;
        });
        const starGeo = new THREE.BufferGeometry();
        starGeo.setAttribute("position", new THREE.BufferAttribute(layout.positions, 3));
        starGeo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        starGeo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
        starGeo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
        starGeo.setAttribute("aIndex", new THREE.BufferAttribute(indices, 1));
        starGeo.setAttribute("aLit", new THREE.BufferAttribute(new Float32Array(count).fill(1), 1));
        starGeo.setAttribute("aHot", new THREE.BufferAttribute(new Float32Array(count), 1));
        stars = new THREE.Points(starGeo, starMat);

        // Nebulae: one soft cloud per constellation
        const nc = layout.clusters.length;
        const nebGeo = new THREE.BufferGeometry();
        nebGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(layout.clusters.flatMap((c) => c.center)), 3));
        nebGeo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(nc * 3), 3));
        nebGeo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(layout.clusters.map((c) => c.radius * 3.4)), 1));
        nebGeo.setAttribute("aLit", new THREE.BufferAttribute(new Float32Array(nc).fill(1), 1));
        nebulae = new THREE.Points(nebGeo, nebulaMat);

        // Edges: every star to its constellation's heart, and notes in a folder chained together
        const segs: [number, number[], number][] = []; // [owner star, other end, alpha]
        notes.forEach((_, i) => segs.push([i, layout!.clusters[layout!.clusterOf[i]].center, 0.14]));
        const byFolder = new Map<string, number[]>();
        notes.forEach((note, i) => {
          if (!note.folderId) return;
          const list = byFolder.get(note.folderId) ?? [];
          list.push(i);
          byFolder.set(note.folderId, list);
        });
        byFolder.forEach((list) => {
          list.sort((a, b) => notes[a].updatedAt.localeCompare(notes[b].updatedAt));
          for (let k = 1; k < list.length; k++) {
            const j = list[k - 1];
            segs.push([list[k], [layout!.positions[j * 3], layout!.positions[j * 3 + 1], layout!.positions[j * 3 + 2]], 0.4]);
          }
        });
        const ePos = new Float32Array(segs.length * 6);
        const eSeed = new Float32Array(segs.length * 2);
        const eAlpha = new Float32Array(segs.length * 2);
        const owner = new Int32Array(segs.length * 2);
        segs.forEach(([star, other, alpha], s) => {
          ePos.set(layout!.positions.subarray(star * 3, star * 3 + 3), s * 6);
          ePos.set(other, s * 6 + 3);
          eSeed.set([seeds[star], seeds[star]], s * 2);
          eAlpha.set([alpha, alpha * 0.25], s * 2);
          owner.set([star, star], s * 2);
        });
        const edgeGeo = new THREE.BufferGeometry();
        edgeGeo.setAttribute("position", new THREE.BufferAttribute(ePos, 3));
        edgeGeo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(segs.length * 6), 3));
        edgeGeo.setAttribute("aSeed", new THREE.BufferAttribute(eSeed, 1));
        edgeGeo.setAttribute("aAlpha", new THREE.BufferAttribute(eAlpha, 1));
        edgeGeo.setAttribute("aLit", new THREE.BufferAttribute(new Float32Array(segs.length * 2).fill(1), 1));
        edges = new THREE.LineSegments(edgeGeo, edgeMat);
        edges.userData.owner = owner;

        sky.add(nebulae, edges, stars);
        recolor();
        buildLabels();
        refreshLit();
        buildBeams();
        controls.maxDistance = fitDistance() * 3;
        controls.minDistance = 1.5;

        if (!introDone && count) {
          introDone = true;
          const fit = fitDistance();
          const target = new THREE.Vector3(...layout.centroid);
          controls.target.copy(target);
          camera.position.copy(target).add(new THREE.Vector3(0, fit * 0.35, fit * (ctx.reducedMotion ? 1 : 2.4)));
          controls.update();
          if (ctx.reducedMotion) {
            shared.uIntro.value = 1;
          } else {
            track(animate(shared.uIntro, { value: [0, 1], duration: 2600, ease: "outQuad" }));
            const end = target.clone().add(new THREE.Vector3(0, fit * 0.35, fit));
            track(animate(camera.position, { x: end.x, y: end.y, z: end.z, duration: 2800, ease: "outExpo" }));
          }
        } else {
          shared.uIntro.value = 1;
        }
      };

      // ── Picking
      const raycaster = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      let pointerDirty = false;
      let down: { x: number; y: number } | null = null;
      const onMove = () => (pointerDirty = true);
      const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
      const onUp = (e: PointerEvent) => {
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && hovered >= 0) handlers.current.onOpen(notes[hovered].id);
        down = null;
      };
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerdown", onDown);
      canvas.addEventListener("pointerup", onUp);
      canvas.style.cursor = "grab";

      const pick = () => {
        if (!stars || !ctx.pointer.inside) return -1;
        ndc.set(ctx.pointer.x, ctx.pointer.y);
        raycaster.setFromCamera(ndc, camera);
        raycaster.params.Points.threshold = camera.position.distanceTo(controls.target) * 0.025;
        let best = -1;
        let bestDist = Infinity;
        for (const hit of raycaster.intersectObject(stars)) {
          const i = hit.index ?? -1;
          if (i < 0) continue;
          // With a filter on, dimmed stars can't be picked.
          if ((highlight || focus) && !litOf(i)) continue;
          if ((hit.distanceToRay ?? Infinity) < bestDist) {
            bestDist = hit.distanceToRay ?? Infinity;
            best = i;
          }
        }
        return best;
      };

      const v = new THREE.Vector3();
      const place = (el: HTMLElement | null, x: number, y: number, z: number) => {
        if (!el) return;
        v.set(x, y, z).project(camera);
        const hidden = v.z > 1;
        el.style.visibility = hidden ? "hidden" : "visible";
        el.style.transform = `translate(${((v.x + 1) / 2) * ctx.size.width}px, ${((1 - v.y) / 2) * ctx.size.height}px)`;
      };

      const api: ConstellationApi = {
        setData,
        setHighlight: (ids) => {
          highlight = ids;
          refreshLit();
        },
        setBeams: (ids) => {
          beamIds = ids;
          buildBeams();
        },
        setFocus: (category) => {
          if (focus === category) return;
          focus = category;
          refreshLit();
        },
        flyTo: (category) => flyTo(category),
        setAutoRotate: (on) => {
          controls.autoRotate = on && !ctx.reducedMotion;
        },
      };
      apiRef.current = api;

      return {
        update(t) {
          shared.uTime.value = t;
          controls.update();
          if (pointerDirty || controls.autoRotate) {
            pointerDirty = false;
            const next = pick();
            if (next !== hovered) {
              hovered = next;
              starUniforms.uHover.value = next;
              canvas.style.cursor = next >= 0 ? "pointer" : "grab";
              handlers.current.onHover(next >= 0 ? notes[next] : null);
            }
          }
          labels.forEach(({ el, pos }) => place(el, pos.x, pos.y, pos.z));
          if (hovered >= 0 && layout) {
            const p = layout.positions;
            place(tooltipRef.current, p[hovered * 3], p[hovered * 3 + 1], p[hovered * 3 + 2]);
          }
          if (layout && beams) place(questionRef.current, ...layout.question);
        },
        resize() {
          shared.uScale.value = (ctx.size.height * renderer.getPixelRatio()) / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        },
        theme(dark) {
          shared.uNight.value = dark ? 1 : 0;
          shared.uHotColor.value.set(dark ? "#fbbf24" : "#d97706");
          const blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
          materials.forEach((m) => {
            m.blending = blending;
            m.needsUpdate = true;
          });
          nebulaUniforms.uOpacity.value = dark ? 0.12 : 0.1;
          edgeUniforms.uOpacity.value = dark ? 1 : 0.8;
          dustMat.color.set(dark ? "#c7d2fe" : "#94a3b8");
          dustMat.opacity = dark ? 0.55 : 0.5;
          recolor();
        },
        dispose() {
          running.forEach((a) => a.pause());
          apiRef.current = null;
          canvas.removeEventListener("pointermove", onMove);
          canvas.removeEventListener("pointerdown", onDown);
          canvas.removeEventListener("pointerup", onUp);
          controls.dispose();
          labels.forEach(({ el }) => el.remove());
          [stars, nebulae, edges, beams, questionNode].forEach(disposeObject);
          dustGeo.dispose();
          dustMat.dispose();
          materials.forEach((m) => m.dispose());
        },
      };
    },
    { interactive: true, maxPixelRatio: 2 },
  );

  return <div ref={ref} className={cn("touch-none", className)} />;
}
