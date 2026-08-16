import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../a11y.ts";
import { useVaultGraph, vaultGraphFailed } from "../graphCache.ts";
import { autoDir, countPhrase, t } from "../i18n.ts";
import { MetaSep } from "../metaSep.tsx";
import { useStore } from "../state.ts";
import { toast } from "../toast.ts";
import type { GraphData, GraphNode } from "../../shared/types.ts";
import { mixColors, readThemeColors } from "./graphColors.ts";

// ---------------------------------------------------------------------------
// Simulation tuning. Forces are scaled by a cooling factor ("alpha") so the
// layout settles instead of jittering forever; interaction reheats it.
// ---------------------------------------------------------------------------
const REPULSION = 20000; // pairwise inverse-square push
const REPULSE_RADIUS = 560; // cutoff (also the spatial-grid cell size)
const SPRING_K = 0.05; // pull along edges
const SPRING_REST = 235; // preferred edge length
const GRAVITY = 0.003; // gentle pull toward the origin
const FRICTION = 0.82; // velocity damping per step
/** Per-step speed cap (world px). In a 1.4k-node vault the dense start piles
 *  hundreds of repulsion contributions onto one node in a single step; without
 *  this clamp velocities compound to ~1e8, the pre-settle bounding box
 *  explodes, and fitView frames a cloud that later contracts back near the
 *  origin — leaving the whole graph offscreen (blank canvas). */
const MAX_SPEED = 40;
const ALPHA_START = 1;
const ALPHA_DECAY = 0.995;
const ALPHA_MIN = 0.015;
const ALPHA_REHEAT = 0.45;
/** Simulation steps run per frame when the reader prefers reduced motion —
 *  enough to reach rest in well under a second without blocking the tab. */
const SETTLE_STEPS_PER_FRAME = 25;
const ZOOM_MIN = 0.15;
const ZOOM_MAX = 4;

interface SimNode {
  id: string;
  title: string;
  links: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

interface SimEdge {
  a: SimNode;
  b: SimNode;
}

// ThemeColors / readThemeColors / mixColors used to be declared here and
// exported for LocalGraph to import — which made the whole force-directed
// simulation a static dependency of the backlinks panel, and so of every admin
// first paint. They live in ./graphColors.ts now (imported above), with the
// graph-token and color-scheme handling this file had; check-bundle.mjs fails
// the build if the GraphView → LocalGraph edge ever comes back.

function nodeRadius(links: number): number {
  return 4 + Math.min(10, Math.sqrt(links) * 2.4);
}

/** Pack a spatial-grid cell into one non-negative integer (see `step`). */
const GRID_BIAS = 5000;
const GRID_SPAN = GRID_BIAS * 2;
function gridKey(gx: number, gy: number): number {
  return (gx + GRID_BIAS) * GRID_SPAN + (gy + GRID_BIAS);
}

/** FNV-1a 32-bit hash — stable seed source for the initial layout. */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic initial position seeded by the note's path (not its index in
 *  the response), so the layout is stable across reloads and across notes
 *  being added/removed elsewhere in the vault. Uniform over a disc whose
 *  radius scales with vault size. */
function seedPosition(id: string, count: number): { x: number; y: number } {
  const h = hash32(id);
  const u1 = ((h >>> 16) & 0xffff) / 0x10000; // radius sample
  const u2 = (h & 0xffff) / 0x10000; // angle sample
  const outer = 46 * Math.sqrt(count + 1);
  const radius = outer * Math.sqrt(u1);
  const angle = u2 * Math.PI * 2;
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

interface Sim {
  setData(data: GraphData): void;
  zoomBy(factor: number): void;
  resetView(): void;
  destroy(): void;
}

function createSim(canvas: HTMLCanvasElement, wrap: HTMLElement): Sim {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { setData() {}, zoomBy() {}, resetView() {}, destroy() {} };
  }

  let nodes: SimNode[] = [];
  let edges: SimEdge[] = [];
  const neighbors = new Map<SimNode, Set<SimNode>>();

  let colors = readThemeColors();

  // Node fills are a blend of accent → bg by degree. Computed inline, that is
  // two hex parses, two array allocations and a template string PER NODE PER
  // FRAME — ~2,800 of them at 1,388 nodes, before the canvas re-parses each
  // resulting string. The blend is a smooth ramp, so a quantized lookup table
  // is visually identical (33 steps across a 0.35 lightness range is well
  // under a perceptible increment) and costs nothing per frame.
  const SHADES = 33;
  let shades: string[] = [];
  let orphanFill = "";
  let rimStroke = "";
  function buildPalette(): void {
    shades = Array.from({ length: SHADES }, (_, i) =>
      mixColors(colors.accent, colors.bg, 0.45 - 0.35 * (i / (SHADES - 1))),
    );
    orphanFill = mixColors(colors.accent, colors.bg, 0.62);
    rimStroke = mixColors(colors.accent, colors.bg, 0.25);
  }
  buildPalette();
  let width = 0; // CSS px
  let height = 0;
  let dpr = Math.max(1, window.devicePixelRatio || 1);

  // View transform: screen = world * k + (tx, ty), in CSS px.
  let k = 1;
  let tx = 0;
  let ty = 0;
  let viewCentered = false;

  let alpha = ALPHA_START;
  let needsDraw = true;
  let hovered: SimNode | null = null;

  // Pointer interaction state. A press becomes a drag only after 4px of
  // pointer travel; a press-and-release inside the threshold is a click.
  let dragNode: SimNode | null = null;
  let panning = false;
  let panStart = { x: 0, y: 0, tx: 0, ty: 0 };
  let downAt = { x: 0, y: 0 };
  let moved = false;
  let dragVel = { x: 0, y: 0 }; // smoothed drag velocity (world px/ms)
  let lastDrag = { x: 0, y: 0, t: 0 };

  function updateCursor() {
    // Both nodes (drag) and the background (pan) are grabbable; the hand
    // closes while either is held.
    canvas.style.cursor = dragNode || panning ? "grabbing" : "grab";
  }

  const abort = new AbortController();
  const { signal } = abort;

  const toWorld = (sx: number, sy: number) => ({
    x: (sx - tx) / k,
    y: (sy - ty) / k,
  });

  function reheat() {
    alpha = Math.max(alpha, ALPHA_REHEAT);
  }

  let pendingFit = false;

  /** Center the view on the layout's bounding box (optical centering — the
   *  spiral seed is origin-centered but the settled mass rarely is). */
  function fitView() {
    if (nodes.length === 0 || width === 0 || height === 0) {
      pendingFit = nodes.length > 0;
      k = 1;
      tx = width / 2;
      ty = height / 2;
      needsDraw = true;
      return;
    }
    pendingFit = false;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x - n.r);
      minY = Math.min(minY, n.y - n.r);
      maxX = Math.max(maxX, n.x + n.r);
      maxY = Math.max(maxY, n.y + n.r);
    }
    const pad = 64;
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    k = Math.min(
      1,
      Math.max(ZOOM_MIN, Math.min((width - pad * 2) / w, (height - pad * 2) / h)),
    );
    tx = width / 2 - ((minX + maxX) / 2) * k;
    ty = height / 2 - ((minY + maxY) / 2) * k;
    viewCentered = true;
    needsDraw = true;
  }

  function setData(data: GraphData) {
    const byId = new Map<string, SimNode>();
    nodes = data.nodes.map((n: GraphNode) => {
      const { x, y } = seedPosition(n.id, data.nodes.length);
      const sim: SimNode = {
        id: n.id,
        title: n.title,
        links: n.links,
        x,
        y,
        vx: 0,
        vy: 0,
        r: nodeRadius(n.links),
      };
      byId.set(n.id, sim);
      return sim;
    });
    edges = [];
    neighbors.clear();
    for (const e of data.edges) {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (!a || !b || a === b) continue;
      edges.push({ a, b });
      if (!neighbors.has(a)) neighbors.set(a, new Set());
      if (!neighbors.has(b)) neighbors.set(b, new Set());
      neighbors.get(a)!.add(b);
      neighbors.get(b)!.add(a);
    }
    // Pre-settle off-screen so the first frame is already a readable layout,
    // then frame it optically centered.
    alpha = ALPHA_START;
    const preSteps = nodes.length > 800 ? 60 : 140;
    for (let i = 0; i < preSteps; i++) {
      step();
      alpha *= ALPHA_DECAY;
    }
    alpha = Math.max(alpha, ALPHA_REHEAT);
    fitView();
    needsDraw = true;
  }

  // --- physics --------------------------------------------------------------

  /** One integration step: grid-bucketed repulsion, springs, gravity, damping. */
  function step() {
    // Spatial grid so repulsion is ~O(n) for the vault sizes we care about.
    //
    // The cell key is a NUMBER, not `${gx},${gy}`. At 1,388 nodes the string
    // form allocated ~14,000 strings per frame (one per insert, nine per
    // lookup) and hashed every one of them — a measurable slice of a 22 ms
    // frame, for a key that is two small integers. `GRID_BIAS` keeps the
    // packed value non-negative for coordinates within ±(BIAS·cell), which at
    // 560 px cells is ±2.8 million world pixels: far outside any layout the
    // simulation produces, and out-of-range nodes still land in *a* bucket,
    // so the worst case is a slightly wrong neighbor set, never a crash.
    const cell = REPULSE_RADIUS;
    const grid = new Map<number, SimNode[]>();
    for (const n of nodes) {
      const key = gridKey(Math.floor(n.x / cell), Math.floor(n.y / cell));
      const bucket = grid.get(key);
      if (bucket) bucket.push(n);
      else grid.set(key, [n]);
    }

    for (const n of nodes) {
      let fx = 0;
      let fy = 0;

      // Repulsion from nodes in the 3x3 cell neighborhood.
      const cx = Math.floor(n.x / cell);
      const cy = Math.floor(n.y / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const bucket = grid.get(gridKey(gx, gy));
          if (!bucket) continue;
          for (const o of bucket) {
            if (o === n) continue;
            let dx = n.x - o.x;
            let dy = n.y - o.y;
            let d2 = dx * dx + dy * dy;
            if (d2 > REPULSE_RADIUS * REPULSE_RADIUS) continue;
            if (d2 < 1) {
              // Coincident nodes: nudge apart deterministically.
              dx = (n.id < o.id ? 1 : -1) * 0.5;
              dy = 0.5;
              d2 = 0.5;
            }
            const d = Math.sqrt(d2);
            const f = Math.min(REPULSION / d2, 12);
            fx += (dx / d) * f;
            fy += (dy / d) * f;
          }
        }
      }

      // Centering gravity.
      fx -= n.x * GRAVITY;
      fy -= n.y * GRAVITY;

      n.vx += fx * alpha;
      n.vy += fy * alpha;
    }

    // Springs along edges (applied symmetrically).
    for (const { a, b } of edges) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const f = SPRING_K * (d - SPRING_REST) * alpha;
      const ux = dx / d;
      const uy = dy / d;
      a.vx += ux * f;
      a.vy += uy * f;
      b.vx -= ux * f;
      b.vy -= uy * f;
    }

    // Integrate with damping; the dragged node is pinned to the pointer.
    for (const n of nodes) {
      if (n === dragNode) {
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx *= FRICTION;
      n.vy *= FRICTION;
      const speed = Math.hypot(n.vx, n.vy);
      if (speed > MAX_SPEED) {
        n.vx *= MAX_SPEED / speed;
        n.vy *= MAX_SPEED / speed;
      }
      n.x += n.vx;
      n.y += n.vy;
    }
  }

  // --- rendering ------------------------------------------------------------

  function draw() {
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.clearRect(0, 0, width, height);

    const hoverSet = hovered
      ? new Set<SimNode>([hovered, ...(neighbors.get(hovered) ?? [])])
      : null;
    const dimAlpha = 0.15;
    // Labels appear from zoom 0.7 upward; hover always reveals them.
    const zoomLabelAlpha = k < 0.7 ? 0 : Math.min(1, (k - 0.7) / 0.35);
    const activePath = useStore.getState().openPath;
    const maxLinks = nodes.reduce((m, n) => Math.max(m, n.links), 1);

    // Edges.
    ctx!.lineWidth = 1;
    for (const { a, b } of edges) {
      const incident = hoverSet !== null && (a === hovered || b === hovered);
      ctx!.globalAlpha = hoverSet
        ? incident
          ? 0.9
          : dimAlpha
        : colors.idleEdgeAlpha;
      ctx!.strokeStyle = incident ? colors.accent : colors.idleEdge;
      ctx!.beginPath();
      ctx!.moveTo(a.x * k + tx, a.y * k + ty);
      ctx!.lineTo(b.x * k + tx, b.y * k + ty);
      ctx!.stroke();
    }

    // Nodes: gold-leaf discs, brighter with degree, with a thin rim.
    for (const n of nodes) {
      const sx = n.x * k + tx;
      const sy = n.y * k + ty;
      const rk = Math.max(2, n.r * k);
      const inFocus = hoverSet === null || hoverSet.has(n);
      const orphan = n.links === 0;
      const degree = n.links / maxLinks;

      ctx!.globalAlpha = inFocus ? 1 : dimAlpha;
      ctx!.fillStyle =
        hoverSet && hoverSet.has(n)
          ? colors.accent
          : orphan
            ? orphanFill
            : shades[Math.min(SHADES - 1, (degree * (SHADES - 1)) | 0)];
      ctx!.beginPath();
      ctx!.arc(sx, sy, rk, 0, Math.PI * 2);
      ctx!.fill();

      // 1px rim.
      ctx!.strokeStyle = rimStroke;
      ctx!.lineWidth = 1;
      ctx!.stroke();

      // Ring around the currently-open note.
      if (activePath !== null && n.id === activePath) {
        ctx!.strokeStyle = colors.accent;
        ctx!.lineWidth = 1.5;
        ctx!.beginPath();
        ctx!.arc(sx, sy, rk + 4, 0, Math.PI * 2);
        ctx!.stroke();
        ctx!.lineWidth = 1;
      }

      if (n === hovered) {
        ctx!.strokeStyle = colors.accent;
        ctx!.lineWidth = 1.5;
        ctx!.beginPath();
        ctx!.arc(sx, sy, rk + 3, 0, Math.PI * 2);
        ctx!.stroke();
        ctx!.lineWidth = 1;
      }
    }

    // Labels (drawn after all nodes so they sit on top).
    ctx!.font = `11px ${colors.fontUI}`;
    ctx!.textAlign = "center";
    ctx!.textBaseline = "top";
    for (const n of nodes) {
      const focused = hoverSet !== null && hoverSet.has(n);
      let labelAlpha = focused ? 1 : zoomLabelAlpha * (n.links === 0 ? 0.55 : 0.85);
      if (hoverSet && !focused) labelAlpha = Math.min(labelAlpha, dimAlpha);
      if (labelAlpha <= 0.02) continue;
      ctx!.globalAlpha = labelAlpha;
      ctx!.fillStyle = focused ? colors.text : colors.muted;
      // Titles are note content: each renders in its own direction, or an
      // English title in an RTL shell comes out as "?What is the Republic about".
      ctx!.direction = autoDir(n.title);
      ctx!.fillText(n.title, n.x * k + tx, n.y * k + ty + Math.max(2, n.r * k) + 5);
    }

    ctx!.globalAlpha = 1;
  }

  // --- lifecycle: rAF loop --------------------------------------------------

  let raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    // A force layout's whole entrance IS motion — eight hundred frames of
    // drift is exactly what "prefers-reduced-motion" is asking us not to do.
    // So when the reader has asked for less, those frames are spent settling
    // the layout instead of showing it: many steps per frame, nothing painted
    // until it comes to rest, and then the finished graph appears at once.
    // Interaction (drag, zoom, hover) still repaints immediately — direct
    // manipulation is the reader's own movement, not ours.
    const still = prefersReducedMotion();
    if (alpha > ALPHA_MIN && nodes.length > 0) {
      const steps = still ? SETTLE_STEPS_PER_FRAME : 1;
      for (let i = 0; i < steps && alpha > ALPHA_MIN; i++) {
        step();
        alpha *= ALPHA_DECAY;
      }
      needsDraw = needsDraw || !still || alpha <= ALPHA_MIN;
    }
    if (needsDraw) {
      draw();
      needsDraw = false;
    }
  }
  raf = requestAnimationFrame(frame);

  // --- sizing / theme -------------------------------------------------------

  function resize() {
    const rect = wrap.getBoundingClientRect();
    dpr = Math.max(1, window.devicePixelRatio || 1);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    if (pendingFit && width > 0) {
      fitView();
    } else if (!viewCentered && width > 0) {
      tx = width / 2;
      ty = height / 2;
      viewCentered = true;
    }
    needsDraw = true;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);
  resize();

  const themeObserver = new MutationObserver(() => {
    colors = readThemeColors();
    buildPalette(); // the shade table is derived from the theme, not the data
    needsDraw = true;
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  // --- interaction ----------------------------------------------------------

  function hitTest(sx: number, sy: number): SimNode | null {
    const { x, y } = toWorld(sx, sy);
    const slack = 6 / k; // keep small nodes grabbable when zoomed out
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const reach = n.r + slack;
      const dx = n.x - x;
      const dy = n.y - y;
      if (dx * dx + dy * dy <= reach * reach) return n;
    }
    return null;
  }

  function pointerPos(e: { clientX: number; clientY: number }) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  canvas.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      const p = pointerPos(e);
      downAt = p;
      moved = false;
      canvas.setPointerCapture(e.pointerId);
      const hit = hitTest(p.x, p.y);
      if (hit) {
        dragNode = hit;
        const w = toWorld(p.x, p.y);
        dragVel = { x: 0, y: 0 };
        lastDrag = { x: w.x, y: w.y, t: performance.now() };
        reheat();
      } else {
        panning = true;
        panStart = { x: p.x, y: p.y, tx, ty };
      }
      updateCursor();
    },
    { signal },
  );

  canvas.addEventListener(
    "pointermove",
    (e) => {
      const p = pointerPos(e);
      if (Math.hypot(p.x - downAt.x, p.y - downAt.y) > 4) moved = true;

      if (dragNode) {
        // Inside the click threshold the node stays put; past it the node
        // pins to the pointer and we keep a smoothed velocity for momentum.
        if (!moved) return;
        const w = toWorld(p.x, p.y);
        dragNode.x = w.x;
        dragNode.y = w.y;
        const now = performance.now();
        const dt = now - lastDrag.t;
        if (dt > 0) {
          const s = Math.min(1, dt / 50);
          dragVel.x += ((w.x - lastDrag.x) / dt - dragVel.x) * s;
          dragVel.y += ((w.y - lastDrag.y) / dt - dragVel.y) * s;
        }
        lastDrag = { x: w.x, y: w.y, t: now };
        reheat();
        needsDraw = true;
        return;
      }
      if (panning) {
        tx = panStart.tx + (p.x - panStart.x);
        ty = panStart.ty + (p.y - panStart.y);
        needsDraw = true;
        return;
      }
      const hit = hitTest(p.x, p.y);
      if (hit !== hovered) {
        hovered = hit;
        updateCursor();
        needsDraw = true;
      }
    },
    { signal },
  );

  canvas.addEventListener(
    "pointerup",
    (e) => {
      const clicked = !moved && dragNode;
      if (clicked) useStore.getState().openNote(clicked.id);
      if (dragNode && moved) {
        // Release with momentum: the smoothed drag velocity (world px/ms)
        // becomes sim velocity (world px/frame), capped so a flick glides
        // instead of launching the node across the vault.
        let vx = dragVel.x * 16.7;
        let vy = dragVel.y * 16.7;
        const cap = MAX_SPEED * 0.6;
        const speed = Math.hypot(vx, vy);
        if (speed > cap) {
          vx *= cap / speed;
          vy *= cap / speed;
        }
        dragNode.vx = vx;
        dragNode.vy = vy;
        reheat();
      }
      dragNode = null;
      panning = false;
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
      updateCursor();
      needsDraw = true;
    },
    { signal },
  );

  canvas.addEventListener(
    "pointercancel",
    () => {
      dragNode = null;
      panning = false;
      updateCursor();
      needsDraw = true;
    },
    { signal },
  );

  canvas.addEventListener(
    "pointerleave",
    () => {
      if (hovered) {
        hovered = null;
        needsDraw = true;
      }
    },
    { signal },
  );

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const p = pointerPos(e);
      const next = Math.min(
        ZOOM_MAX,
        Math.max(ZOOM_MIN, k * Math.exp(-e.deltaY * 0.0015)),
      );
      // Zoom about the cursor: keep the world point under it fixed.
      tx = p.x - ((p.x - tx) / k) * next;
      ty = p.y - ((p.y - ty) / k) * next;
      k = next;
      needsDraw = true;
    },
    { passive: false, signal },
  );

  canvas.style.cursor = "grab";
  canvas.style.touchAction = "none";

  /** Zoom about the viewport center. */
  function zoomBy(factor: number) {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k * factor));
    const cx = width / 2;
    const cy = height / 2;
    tx = cx - ((cx - tx) / k) * next;
    ty = cy - ((cy - ty) / k) * next;
    k = next;
    needsDraw = true;
  }

  function resetView() {
    fitView();
    reheat();
  }

  return {
    setData,
    zoomBy,
    resetView,
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      themeObserver.disconnect();
      abort.abort();
    },
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GraphView() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Sim | null>(null);
  const admin = useStore((s) => s.admin);
  useStore((s) => s.language); // re-render the chrome strings on language change
  const [stats, setStats] = useState<{ notes: number; links: number } | null>(
    null,
  );

  // Shared with the local graph and the visitor sidebar — one /api/graph for
  // the whole app (client/graphCache.ts), not one per consumer.
  const data = useVaultGraph();
  /** The layout is seeded from scratch by `setData`, so a refresh would fling
   *  every node back to its seed position and restart the simulation under
   *  the reader's pointer. The graph view is a snapshot for as long as it is
   *  open, exactly as it was before it shared this cache: apply the first
   *  graph that arrives, then leave the sim alone. Closing and reopening the
   *  view picks up everything that changed meanwhile. */
  const appliedRef = useRef(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const sim = createSim(canvas, wrap);
    simRef.current = sim;
    appliedRef.current = false;

    return () => {
      simRef.current = null;
      sim.destroy();
    };
  }, []);

  useEffect(() => {
    if (!data || appliedRef.current) return;
    const sim = simRef.current;
    if (!sim) return;
    appliedRef.current = true;
    setStats({ notes: data.nodes.length, links: data.edges.length });
    sim.setData(data);
  }, [data]);

  // The graph view is the one surface where a failed /api/graph leaves an
  // empty screen rather than a missing garnish, so it is the one that says so.
  const graphFailed = vaultGraphFailed();
  useEffect(() => {
    if (graphFailed && !appliedRef.current) toast(t("graphLoadFailed"));
  }, [graphFailed]);

  return (
    <div className="s-graph" ref={wrapRef} role="region" aria-label={t("graphAria")}>
      {/* A bitmap is a picture to assistive tech no matter what it depicts, so
          it is named as one. The graph is a VIEW of the vault, never its only
          route: everything in it is reachable through the tree, the search and
          the backlinks panel, all of which are keyboard-complete. */}
      <canvas
        className="s-graph__canvas"
        ref={canvasRef}
        role="img"
        aria-label={
          stats
            ? `${t("graphAria")} — ${countPhrase(stats.notes, admin ? "notes" : "publishedNotes")}, ${countPhrase(stats.links, "links")}`
            : t("graphAria")
        }
      />
      {stats?.notes === 0 &&
        (admin ? (
          <div className="s-graph__empty">{t("graphEmptyAdmin")}</div>
        ) : (
          <div className="s-graph__empty s-graph__empty--visitor">
            <span className="s-graph__empty-star" aria-hidden="true">✦</span>
            {t("graphEmptyVisitor")}
          </div>
        ))}
      {stats !== null && stats.notes > 0 && (
        <div className="s-graph__hud">
          {countPhrase(stats.notes, admin ? "notes" : "publishedNotes")}
          <MetaSep className="s-graph__hudsep" />
          {countPhrase(stats.links, "links")}
        </div>
      )}
      <div className="s-graph__controls">
        <button
          type="button"
          className="s-iconbtn"
          title={t("zoomIn")}
          aria-label={t("zoomIn")}
          onClick={() => simRef.current?.zoomBy(1.35)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button
          type="button"
          className="s-iconbtn"
          title={t("zoomOut")}
          aria-label={t("zoomOut")}
          onClick={() => simRef.current?.zoomBy(1 / 1.35)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M5 12h14" />
          </svg>
        </button>
        <button
          type="button"
          className="s-iconbtn"
          title={t("resetView")}
          aria-label={t("resetView")}
          onClick={() => simRef.current?.resetView()}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
        </button>
      </div>
    </div>
  );
}
