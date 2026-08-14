import { useEffect, useRef, useState } from "react";
import { getGraph } from "../api.ts";
import { useStore } from "../state.ts";
import { toast } from "../toast.ts";
import type { GraphData, GraphNode } from "../../shared/types.ts";

// ---------------------------------------------------------------------------
// Simulation tuning. Forces are scaled by a cooling factor ("alpha") so the
// layout settles instead of jittering forever; interaction reheats it.
// ---------------------------------------------------------------------------
const REPULSION = 3200; // pairwise inverse-square push
const REPULSE_RADIUS = 280; // cutoff (also the spatial-grid cell size)
const SPRING_K = 0.07; // pull along edges
const SPRING_REST = 110; // preferred edge length
const GRAVITY = 0.012; // gentle pull toward the origin
const FRICTION = 0.82; // velocity damping per step
const ALPHA_START = 1;
const ALPHA_DECAY = 0.995;
const ALPHA_MIN = 0.015;
const ALPHA_REHEAT = 0.45;
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

interface ThemeColors {
  text: string;
  muted: string;
  faint: string;
  accent: string;
  border: string;
  fontUI: string;
}

function readThemeColors(): ThemeColors {
  const cs = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) =>
    cs.getPropertyValue(name).trim() || fallback;
  return {
    text: token("--text", "#ddd"),
    muted: token("--text-muted", "#999"),
    faint: token("--text-faint", "#666"),
    accent: token("--accent", "#c9a227"),
    border: token("--border", "#333"),
    fontUI: token("--font-ui", "system-ui, sans-serif"),
  };
}

function nodeRadius(links: number): number {
  return 4 + Math.min(10, Math.sqrt(links) * 2.4);
}

/** Deterministic phyllotaxis seed layout — pleasant before forces kick in. */
function seedPosition(i: number): { x: number; y: number } {
  const radius = 22 * Math.sqrt(i + 1);
  const angle = (i + 1) * 2.3999632297; // golden angle
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

interface Sim {
  setData(data: GraphData): void;
  destroy(): void;
}

function createSim(canvas: HTMLCanvasElement, wrap: HTMLElement): Sim {
  const ctx = canvas.getContext("2d");
  if (!ctx) return { setData() {}, destroy() {} };

  let nodes: SimNode[] = [];
  let edges: SimEdge[] = [];
  const neighbors = new Map<SimNode, Set<SimNode>>();

  let colors = readThemeColors();
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

  // Pointer interaction state.
  let dragNode: SimNode | null = null;
  let panning = false;
  let panStart = { x: 0, y: 0, tx: 0, ty: 0 };
  let downAt = { x: 0, y: 0 };
  let moved = false;

  const abort = new AbortController();
  const { signal } = abort;

  const toWorld = (sx: number, sy: number) => ({
    x: (sx - tx) / k,
    y: (sy - ty) / k,
  });

  function reheat() {
    alpha = Math.max(alpha, ALPHA_REHEAT);
  }

  function setData(data: GraphData) {
    const byId = new Map<string, SimNode>();
    nodes = data.nodes.map((n: GraphNode, i: number) => {
      const { x, y } = seedPosition(i);
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
    alpha = ALPHA_START;
    needsDraw = true;
  }

  // --- physics --------------------------------------------------------------

  /** One integration step: grid-bucketed repulsion, springs, gravity, damping. */
  function step() {
    // Spatial grid so repulsion is ~O(n) for the vault sizes we care about.
    const cell = REPULSE_RADIUS;
    const grid = new Map<string, SimNode[]>();
    for (const n of nodes) {
      const key = `${Math.floor(n.x / cell)},${Math.floor(n.y / cell)}`;
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
          const bucket = grid.get(`${gx},${gy}`);
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
    const dimAlpha = 0.12;
    // Labels fade in as you zoom; hover always reveals them.
    const zoomLabelAlpha = Math.max(0, Math.min(1, (k - 0.85) / 0.5));

    // Edges.
    ctx!.lineWidth = 1;
    for (const { a, b } of edges) {
      const incident = hoverSet !== null && (a === hovered || b === hovered);
      ctx!.globalAlpha = hoverSet ? (incident ? 0.9 : dimAlpha) : 0.5;
      ctx!.strokeStyle = incident ? colors.accent : colors.border;
      ctx!.beginPath();
      ctx!.moveTo(a.x * k + tx, a.y * k + ty);
      ctx!.lineTo(b.x * k + tx, b.y * k + ty);
      ctx!.stroke();
    }

    // Nodes.
    for (const n of nodes) {
      const sx = n.x * k + tx;
      const sy = n.y * k + ty;
      const rk = Math.max(2, n.r * k);
      const inFocus = hoverSet === null || hoverSet.has(n);
      const orphan = n.links === 0;

      ctx!.globalAlpha = inFocus ? (orphan ? 0.45 : 1) : dimAlpha;
      ctx!.fillStyle =
        hoverSet && hoverSet.has(n)
          ? colors.accent
          : orphan
            ? colors.faint
            : colors.muted;
      ctx!.beginPath();
      ctx!.arc(sx, sy, rk, 0, Math.PI * 2);
      ctx!.fill();

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
      let labelAlpha = focused ? 1 : zoomLabelAlpha * (n.links === 0 ? 0.5 : 0.8);
      if (hoverSet && !focused) labelAlpha = Math.min(labelAlpha, dimAlpha);
      if (labelAlpha <= 0.02) continue;
      ctx!.globalAlpha = labelAlpha;
      ctx!.fillStyle = focused ? colors.text : colors.muted;
      ctx!.fillText(n.title, n.x * k + tx, n.y * k + ty + Math.max(2, n.r * k) + 5);
    }

    ctx!.globalAlpha = 1;
  }

  // --- lifecycle: rAF loop --------------------------------------------------

  let raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (alpha > ALPHA_MIN && nodes.length > 0) {
      step();
      alpha *= ALPHA_DECAY;
      needsDraw = true;
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
    if (!viewCentered && width > 0) {
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
        reheat();
      } else {
        panning = true;
        panStart = { x: p.x, y: p.y, tx, ty };
      }
    },
    { signal },
  );

  canvas.addEventListener(
    "pointermove",
    (e) => {
      const p = pointerPos(e);
      if (Math.hypot(p.x - downAt.x, p.y - downAt.y) > 4) moved = true;

      if (dragNode) {
        const w = toWorld(p.x, p.y);
        dragNode.x = w.x;
        dragNode.y = w.y;
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
        canvas.style.cursor = hit ? "pointer" : "grab";
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
      dragNode = null;
      panning = false;
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
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

  return {
    setData,
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
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    let disposed = false;
    const sim = createSim(canvas, wrap);

    getGraph()
      .then((data) => {
        if (disposed) return;
        setEmpty(data.nodes.length === 0);
        sim.setData(data);
      })
      .catch((err: unknown) => {
        console.error("GraphView: failed to load graph", err);
        toast("Could not load graph");
      });

    return () => {
      disposed = true;
      sim.destroy();
    };
  }, []);

  return (
    <div className="s-graph" ref={wrapRef}>
      <canvas className="s-graph__canvas" ref={canvasRef} />
      {empty && (
        <div className="s-graph__empty">
          No notes yet — create one and link it with [[wikilinks]].
        </div>
      )}
    </div>
  );
}
