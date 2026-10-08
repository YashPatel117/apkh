import { hash01 } from "@/lib/motion";

/** One note as the sky sees it. */
export interface StarNote {
  id: string;
  title: string;
  category: string;
  folderId: string | null;
  updatedAt: string;
  /** Rough "mass": longer notes and attachments make brighter stars */
  weight: number;
}

export interface Cluster {
  name: string;
  /** Empty category ("" → shown as Uncategorized) */
  uncategorized: boolean;
  count: number;
  colorIndex: number;
  center: [number, number, number];
  radius: number;
}

export interface SkyLayout {
  clusters: Cluster[];
  /** Same order as the notes passed in */
  positions: Float32Array;
  clusterOf: Int32Array;
  /** Middle of all stars, where the camera looks */
  centroid: [number, number, number];
  /** Rough radius of the whole sky */
  extent: number;
  /** Where the question sits when an AI answer draws its beams */
  question: [number, number, number];
}

// Two palettes, matched hue for hue: glowing in the night sky, inked on the star chart.
const NIGHT = ["#38bdf8", "#a78bfa", "#fbbf24", "#34d399", "#f472b6", "#60a5fa", "#fb923c", "#2dd4bf", "#c084fc", "#facc15", "#f87171", "#4ade80"];
const CHART = ["#0369a1", "#6d28d9", "#b45309", "#047857", "#be185d", "#1d4ed8", "#c2410c", "#0f766e", "#7e22ce", "#a16207", "#b91c1c", "#15803d"];
const NEUTRAL = { night: "#94a3b8", chart: "#475569" };

export function clusterColor(cluster: Pick<Cluster, "colorIndex" | "uncategorized">, dark: boolean) {
  if (cluster.uncategorized) return dark ? NEUTRAL.night : NEUTRAL.chart;
  const palette = dark ? NIGHT : CHART;
  return palette[cluster.colorIndex % palette.length];
}

/** Biggest categories first, so colours stay put as small ones come and go. */
export function groupByCategory(notes: StarNote[]) {
  const counts = new Map<string, number>();
  for (const note of notes) counts.set(note.category.trim(), (counts.get(note.category.trim()) ?? 0) + 1);
  let colorIndex = 0;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count, uncategorized: !name, colorIndex: name ? colorIndex++ : -1 }));
}

/** Fibonacci sphere: evenly spread cluster centres. */
function fibonacci(i: number, n: number, radius: number): [number, number, number] {
  const y = 1 - ((i + 0.5) / n) * 2;
  const r = Math.sqrt(1 - y * y);
  const theta = Math.PI * (3 - Math.sqrt(5)) * i;
  return [Math.cos(theta) * r * radius, y * radius * 0.7, Math.sin(theta) * r * radius];
}

export function layoutSky(notes: StarNote[]): SkyLayout {
  const groups = groupByCategory(notes);
  const n = groups.length;
  const skyRadius = n <= 1 ? 0 : 3.2 + Math.sqrt(n) * 1.9;
  const clusters: Cluster[] = groups.map((g, i) => ({
    ...g,
    center: n <= 1 ? [0, 0, 0] : fibonacci(i, n, skyRadius),
    radius: 0.8 + Math.sqrt(g.count) * 0.42,
  }));
  const index = new Map(clusters.map((c, i) => [c.name, i]));

  const positions = new Float32Array(notes.length * 3);
  const clusterOf = new Int32Array(notes.length);
  const centroid: [number, number, number] = [0, 0, 0];
  notes.forEach((note, i) => {
    const c = index.get(note.category.trim()) ?? 0;
    const cluster = clusters[c];
    clusterOf[i] = c;
    // Stable spot inside the cluster's ball, a little denser toward the core.
    const u = hash01(note.id, 1) * 2 - 1;
    const theta = hash01(note.id, 2) * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = cluster.radius * (0.25 + 0.75 * Math.cbrt(hash01(note.id, 3)));
    positions[i * 3] = cluster.center[0] + s * Math.cos(theta) * r;
    positions[i * 3 + 1] = cluster.center[1] + u * r * 0.8;
    positions[i * 3 + 2] = cluster.center[2] + s * Math.sin(theta) * r;
    for (let k = 0; k < 3; k++) centroid[k] += positions[i * 3 + k] / Math.max(1, notes.length);
  });

  const extent = skyRadius + Math.max(1, ...clusters.map((c) => c.radius));
  const question: [number, number, number] = n <= 1 ? [0, (clusters[0]?.radius ?? 1) + 2.6, 0] : [centroid[0], centroid[1], centroid[2]];
  return { clusters, positions, clusterOf, centroid, extent, question };
}
