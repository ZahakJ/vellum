// Mini live local graph for the right panel: the open note centered with its
// direct wikilink neighbors (in + out). Data comes from /api/graph — already
// publish-scoped for visitors — and the neighborhood is derived client-side.
// Same visual language as the big graph (gold-leaf discs, token colors, label
// on hover + always for the center), gentle physics, HiDPI canvas, click to
// navigate. Collapse state persists in localStorage; the whole section stays
// fresh through SSE because the store's tree identity changes on vault events.

import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphData, GraphNode } from "../../shared/types.ts";
import { getGraph } from "../api.ts";
import { useStore } from "../state.ts";
import { mixColors, readThemeColors } from "./GraphView.tsx";

const COLLAPSED_KEY = "vellum.localgraph-collapsed";

// Physics — deliberately soft: a ~200px pane should breathe, not jitter.
const SPRING_K = 0.055; // neighbor ↔ center pull
const SPRING_REST = 68; // preferred spoke length (world px)
const XLINK_K = 0.02; // neighbor ↔ neighbor links (weaker)
const XLINK_REST = 58;
const REPULSION = 950; // pairwise inverse-square push among neighbors
const REPULSE_RADIUS = 130;
const FRICTION = 0.85;
const ALPHA_DECAY = 0.962;
const ALPHA_MIN = 0.02;
const MAX_NEIGHBORS = 24; // a hub note would otherwise become a fur ball

/** Positions survive note switches so clicking a neighbor animates gently
 *  instead of reshuffling the whole pane. Values are offsets from center. */
const lastOffsets = new Map<string, { x: number; y: number }>();

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

interface Hood {
  center: GraphNode;
  neighbors: GraphNode[]; // capped at MAX_NEIGHBORS, highest degree first
  edges: [string, string][]; // within the shown set (spokes + cross-links)
  neighborCount: number; // uncapped true count
}

function deriveHood(data: GraphData | null, centerId: string | null): Hood | null {
  if (!data || !centerId) return null;
  const center = data.nodes.find((n) => n.id === centerId);
  if (!center) return null;
  const ids = new Set<string>();
  for (const e of data.edges) {
    if (e.source === centerId && e.target !== centerId) ids.add(e.target);
    else if (e.target === centerId && e.source !== centerId) ids.add(e.source);
  }
  const neighborCount = ids.size;
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const neighbors = [...ids]
    .map((id) => byId.get(id))
    .filter((n): n is GraphNode => n !== undefined)
    .sort((a, b) => b.links - a.links || a.title.localeCompare(b.title))
    .slice(0, MAX_NEIGHBORS);
  const shown = new Set([centerId, ...neighbors.map((n) => n.id)]);
  const seen = new Set<string>();
  const edges: [string, string][] = [];
  for (const e of data.edges) {
    if (!shown.has(e.source) || !shown.has(e.target) || e.source === e.target) continue;
    const key = e.source < e.target ? `${e.source}\0${e.target}` : `${e.target}\0${e.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([e.source, e.target]);
  }
  return { center, neighbors, edges, neighborCount };
}

interface MiniNode {
  id: string;
  title: string;
  links: number;
  isCenter: boolean;
  x: number; // offset from pane center (world px)
  y: number;
  vx: number;
  vy: number;
  r: number;
}

interface MiniSim {
  setData(hood: Hood): void;
  destroy(): void;
}

function trimLabel(title: string): string {
  return title.length > 26 ? `${title.slice(0, 25)}…` : title;
}

function createMiniSim(
  canvas: HTMLCanvasElement,
  wrap: HTMLElement,
  onOpen: (id: string) => void,
): MiniSim {
  const ctx = canvas.getContext("2d");
  if (!ctx) return { setData() {}, destroy() {} };

  let nodes: MiniNode[] = [];
  let edges: [MiniNode, MiniNode][] = [];
  let colors = readThemeColors();
  let width = 0;
  let height = 0;
  let dpr = Math.max(1, window.devicePixelRatio || 1);
  let alpha = 0;
  let needsDraw = true;
  let hovered: MiniNode | null = null;

  const abort = new AbortController();
  const { signal } = abort;

  function setData(hood: Hood) {
    const golden = 2.399963;
    const all = [hood.center, ...hood.neighbors];
    nodes = all.map((n, i) => {
      const isCenter = i === 0;
      const kept = isCenter ? null : lastOffsets.get(n.id);
      const angle = i * golden - 0.6;
      const seed = {
        x: isCenter ? 0 : Math.cos(angle) * SPRING_REST * (0.85 + (i % 3) * 0.12),
        y: isCenter ? 0 : Math.sin(angle) * SPRING_REST * (0.85 + (i % 3) * 0.12),
      };
      return {
        id: n.id,
        title: n.title,
        links: n.links,
        isCenter,
        x: kept?.x ?? seed.x,
        y: kept?.y ?? seed.y,
        vx: 0,
        vy: 0,
        r: isCenter ? 7 : 3.5 + Math.min(3, Math.sqrt(n.links)),
      };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    edges = [];
    for (const [a, b] of hood.edges) {
      const na = byId.get(a);
      const nb = byId.get(b);
      if (na && nb) edges.push([na, nb]);
    }
    hovered = null;
    alpha = 1;
    needsDraw = true;
  }

  function step() {
    for (const n of nodes) {
      if (n.isCenter) continue;
      let fx = 0;
      let fy = 0;
      // Repulsion from every other shown node (tiny N — brute force is fine).
      for (const o of nodes) {
        if (o === n) continue;
        let dx = n.x - o.x;
        let dy = n.y - o.y;
        let d2 = dx * dx + dy * dy;
        if (d2 > REPULSE_RADIUS * REPULSE_RADIUS) continue;
        if (d2 < 1) {
          dx = n.id < o.id ? 0.5 : -0.5;
          dy = 0.5;
          d2 = 0.5;
        }
        const d = Math.sqrt(d2);
        const f = Math.min(REPULSION / d2, 8);
        fx += (dx / d) * f;
        fy += (dy / d) * f;
      }
      n.vx += fx * alpha;
      n.vy += fy * alpha;
    }
    // Springs: spokes to the center and cross-links between neighbors.
    for (const [a, b] of edges) {
      const spoke = a.isCenter || b.isCenter;
      const k = spoke ? SPRING_K : XLINK_K;
      const rest = spoke ? SPRING_REST : XLINK_REST;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const f = k * (d - rest) * alpha;
      const ux = dx / d;
      const uy = dy / d;
      if (!a.isCenter) {
        a.vx += ux * f;
        a.vy += uy * f;
      }
      if (!b.isCenter) {
        b.vx -= ux * f;
        b.vy -= uy * f;
      }
    }
    // Integrate, damp, and keep everything inside the little pane.
    const bx = Math.max(30, width / 2 - 16);
    const by = Math.max(24, height / 2 - 18);
    for (const n of nodes) {
      if (n.isCenter) continue;
      n.vx *= FRICTION;
      n.vy *= FRICTION;
      n.x += n.vx;
      n.y += n.vy;
      n.x = Math.max(-bx, Math.min(bx, n.x));
      n.y = Math.max(-by, Math.min(by, n.y));
      lastOffsets.set(n.id, { x: n.x, y: n.y });
    }
    if (lastOffsets.size > 800) lastOffsets.clear(); // unbounded-growth guard
  }

  function draw() {
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.clearRect(0, 0, width, height);
    const cx = width / 2;
    const cy = height / 2;

    // Edges.
    ctx!.lineWidth = 1;
    for (const [a, b] of edges) {
      const hot = hovered !== null && (a === hovered || b === hovered);
      ctx!.globalAlpha = hot ? 0.9 : colors.idleEdgeAlpha * 0.9;
      ctx!.strokeStyle = hot ? colors.accent : colors.idleEdge;
      ctx!.beginPath();
      ctx!.moveTo(cx + a.x, cy + a.y);
      ctx!.lineTo(cx + b.x, cy + b.y);
      ctx!.stroke();
    }
    ctx!.globalAlpha = 1;

    // Nodes: gold discs, center brightest with an accent ring.
    const maxLinks = nodes.reduce((m, n) => Math.max(m, n.links), 1);
    for (const n of nodes) {
      const sx = cx + n.x;
      const sy = cy + n.y;
      const degree = n.links / maxLinks;
      ctx!.fillStyle =
        n === hovered || n.isCenter
          ? mixColors(colors.accent, colors.bg, n.isCenter ? 0.08 : 0)
          : mixColors(colors.accent, colors.bg, 0.45 - 0.3 * degree);
      ctx!.beginPath();
      ctx!.arc(sx, sy, n.r, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.strokeStyle = mixColors(colors.accent, colors.bg, 0.25);
      ctx!.lineWidth = 1;
      ctx!.stroke();
      if (n.isCenter) {
        ctx!.strokeStyle = colors.accent;
        ctx!.lineWidth = 1.5;
        ctx!.beginPath();
        ctx!.arc(sx, sy, n.r + 3.5, 0, Math.PI * 2);
        ctx!.stroke();
        ctx!.lineWidth = 1;
      }
    }

    // Labels: always for the center, on hover for neighbors.
    ctx!.font = `10.5px ${colors.fontUI}`;
    ctx!.textAlign = "center";
    ctx!.textBaseline = "top";
    for (const n of nodes) {
      if (!n.isCenter && n !== hovered) continue;
      const sx = Math.max(34, Math.min(width - 34, cx + n.x));
      const sy = cy + n.y + n.r + (n.isCenter ? 6 : 4);
      ctx!.fillStyle = n.isCenter ? colors.text : colors.muted;
      ctx!.globalAlpha = 1;
      ctx!.fillText(trimLabel(n.title), sx, Math.min(sy, height - 14));
    }
    ctx!.globalAlpha = 1;
  }

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

  function resize() {
    const rect = wrap.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return; // panel collapsed
    dpr = Math.max(1, window.devicePixelRatio || 1);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
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

  function hitTest(sx: number, sy: number): MiniNode | null {
    const x = sx - width / 2;
    const y = sy - height / 2;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const reach = n.r + 5;
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
    "pointermove",
    (e) => {
      const p = pointerPos(e);
      const hit = hitTest(p.x, p.y);
      if (hit !== hovered) {
        hovered = hit;
        canvas.style.cursor = hit && !hit.isCenter ? "pointer" : "default";
        needsDraw = true;
      }
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
    "click",
    (e) => {
      const p = pointerPos(e);
      const hit = hitTest(p.x, p.y);
      if (hit && !hit.isCenter) onOpen(hit.id);
    },
    { signal },
  );

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

export default function LocalGraph() {
  const openPath = useStore((s) => s.openPath);
  const tree = useStore((s) => s.tree);
  const admin = useStore((s) => s.admin);
  const [data, setData] = useState<GraphData | null>(null);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<MiniSim | null>(null);

  // The tree object is replaced on every vault SSE event, so keying the graph
  // fetch on it keeps the neighborhood live (edits, publishes, renames).
  useEffect(() => {
    if (!tree) return;
    let cancelled = false;
    getGraph()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: unknown) => {
        console.error("vellum: loading local graph failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [tree]);

  const hood = useMemo(() => deriveHood(data, openPath), [data, openPath]);
  const isEmpty = hood !== null && hood.neighborCount === 0;

  useEffect(() => {
    if (collapsed || !hood || isEmpty) return;
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const sim = createMiniSim(canvas, wrap, (id) => useStore.getState().openNote(id));
    simRef.current = sim;
    return () => {
      simRef.current = null;
      sim.destroy();
    };
  }, [collapsed, hood === null, isEmpty]);

  useEffect(() => {
    if (hood) simRef.current?.setData(hood);
  }, [hood, collapsed]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, String(next));
    } catch {
      // storage unavailable — collapse still works for this session
    }
  };

  if (!openPath || !hood) return null;

  return (
    <section className="s-localgraph">
      <header className="s-panel-header s-localgraph__header">
        <button
          type="button"
          className="s-localgraph__toggle"
          onClick={toggle}
          aria-expanded={!collapsed}
          title={collapsed ? "Show local graph" : "Hide local graph"}
        >
          <span
            className={`s-tree__chevron${collapsed ? "" : " s-tree__chevron--open"}`}
            aria-hidden="true"
          >
            ›
          </span>
          <span className="s-panel-title">Local graph</span>
          <span className="s-panel-count">{hood.neighborCount}</span>
        </button>
      </header>
      {!collapsed &&
        (isEmpty ? (
          // A lone unlabeled disc with a 0 badge reads as broken — say why
          // the pane is quiet instead of drawing an empty sky.
          <p className="s-localgraph__empty">
            {admin
              ? "No links yet — link to or from this note with [[…]]."
              : "No published links yet."}
          </p>
        ) : (
          <div className="s-localgraph__body" ref={wrapRef}>
            <canvas className="s-localgraph__canvas" ref={canvasRef} />
          </div>
        ))}
    </section>
  );
}
