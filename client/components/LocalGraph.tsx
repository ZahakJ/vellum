// Mini live local graph for the right panel: the open note centered with its
// direct wikilink neighbors (in + out). Data comes from /api/graph — already
// publish-scoped for visitors — and the neighborhood is derived client-side.
// Same visual language as the big graph (gold-leaf discs, token colors, label
// on hover + always for the center), springy physics you can grab: any node
// drags with the pointer (grab/grabbing cursors), linked neighbors follow
// elastically, and release carries momentum. Click-without-drag (4px
// threshold) or double-click navigates. HiDPI canvas; the rAF loop parks
// itself when the sim has settled and nothing needs drawing, and while the
// tab is hidden. Collapse state persists in localStorage; the whole section
// stays fresh through SSE because the shared graph cache is invalidated on
// vault events (client/graphCache.ts).

import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphData, GraphNode } from "../../shared/types.ts";
import { prefersReducedMotion } from "../a11y.ts";
import { useNoteNeighborhood } from "../graphCache.ts";
import { autoDir, localeNum, t } from "../i18n.ts";
import { Lru } from "../lru.ts";
import { useStore } from "../state.ts";
import { mixColors, readThemeColors } from "./graphColors.ts";

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
const CENTER_ANCHOR_K = 0.08; // spring pulling the center disc home to (0,0)
const MAX_STEP_SPEED = 12; // per-frame speed cap so momentum can't launch nodes
const DRAG_THRESHOLD = 4; // px of pointer travel before a press becomes a drag
const MOMENTUM_SCALE = 16.7; // px/ms (pointer velocity) → px/frame (sim velocity)
const MOMENTUM_MAX = 9; // release-velocity cap (px/frame)
const PULSE_MS = 900; // one-shot center pulse on note switch

/** Positions survive note switches so clicking a neighbor animates gently
 *  instead of reshuffling the whole pane. Values are offsets from center. */
/** Where each node last settled, so revisiting a note redraws the same shape
 *  instead of exploding from the seed again. Bounded LRU rather than the old
 *  "clear the whole map at 800": eviction should cost the OLDEST note its
 *  remembered layout, not every note its layout at once. */
const lastOffsets = new Lru<{ x: number; y: number }>({ max: 800 });

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
  const adj = new Map<MiniNode, Set<MiniNode>>();
  let colors = readThemeColors();
  let width = 0;
  let height = 0;
  let dpr = Math.max(1, window.devicePixelRatio || 1);
  let alpha = 0;
  let needsDraw = true;
  let hovered: MiniNode | null = null;

  // Drag interaction state. A press becomes a drag only after 4px of travel;
  // a press-and-release inside the threshold is a click (navigation).
  let pressed: MiniNode | null = null;
  let dragging: MiniNode | null = null;
  let downAt = { x: 0, y: 0 };
  let dragVel = { x: 0, y: 0 }; // smoothed pointer velocity, px/ms
  let lastDrag = { x: 0, y: 0, t: 0 };

  // One-shot pulse ring around the center on note switch.
  let pulseT0 = 0;
  let lastCenterId: string | null = null;

  const abort = new AbortController();
  const { signal } = abort;

  function setData(hood: Hood) {
    const golden = 2.399963;
    const all = [hood.center, ...hood.neighbors];
    const prevDragging = dragging;
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
    adj.clear();
    for (const [a, b] of hood.edges) {
      const na = byId.get(a);
      const nb = byId.get(b);
      if (na && nb) {
        edges.push([na, nb]);
        if (!adj.has(na)) adj.set(na, new Set());
        if (!adj.has(nb)) adj.set(nb, new Set());
        adj.get(na)!.add(nb);
        adj.get(nb)!.add(na);
      }
    }
    hovered = null;
    // Re-bind an in-flight drag across SSE refreshes so the node doesn't
    // snap out from under the pointer.
    if (prevDragging) {
      const nd = byId.get(prevDragging.id);
      if (nd) {
        nd.x = prevDragging.x;
        nd.y = prevDragging.y;
        dragging = nd;
        pressed = nd;
      } else {
        dragging = null;
        pressed = null;
      }
    }
    if (hood.center.id !== lastCenterId) {
      lastCenterId = hood.center.id;
      // The pulse ring is pure delight — it carries nothing the panel does
      // not already say — so a reader who asked for less motion never sees it.
      pulseT0 = prefersReducedMotion() ? 0 : performance.now();
    }
    alpha = 1;
    needsDraw = true;
    // Reduced motion: settle the little constellation before it is ever
    // painted, so it arrives placed instead of springing into position.
    if (prefersReducedMotion()) {
      while (alpha > ALPHA_MIN) {
        step();
        alpha *= ALPHA_DECAY;
      }
    }
    wake();
  }

  function step() {
    for (const n of nodes) {
      if (n === dragging) continue;
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
      // The center isn't pinned any more (so dragging it tugs the whole
      // hood), but a home spring keeps it settling back to the middle.
      if (n.isCenter) {
        fx -= n.x * CENTER_ANCHOR_K * 12;
        fy -= n.y * CENTER_ANCHOR_K * 12;
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
      if (a !== dragging) {
        a.vx += ux * f;
        a.vy += uy * f;
      }
      if (b !== dragging) {
        b.vx -= ux * f;
        b.vy -= uy * f;
      }
    }
    // Integrate, damp, and keep everything inside the little pane.
    const bx = Math.max(30, width / 2 - 16);
    const by = Math.max(24, height / 2 - 18);
    for (const n of nodes) {
      if (n === dragging) continue;
      n.vx *= FRICTION;
      n.vy *= FRICTION;
      const speed = Math.hypot(n.vx, n.vy);
      if (speed > MAX_STEP_SPEED) {
        n.vx *= MAX_STEP_SPEED / speed;
        n.vy *= MAX_STEP_SPEED / speed;
      }
      n.x += n.vx;
      n.y += n.vy;
      n.x = Math.max(-bx, Math.min(bx, n.x));
      n.y = Math.max(-by, Math.min(by, n.y));
      if (!n.isCenter) lastOffsets.set(n.id, { x: n.x, y: n.y });
    }
  }

  function draw() {
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.clearRect(0, 0, width, height);
    const cx = width / 2;
    const cy = height / 2;
    const active = dragging ?? hovered;
    const hoverSet = active
      ? new Set<MiniNode>([active, ...(adj.get(active) ?? [])])
      : null;
    const softAlpha = 0.28;

    // Edges: incident to the active node glow accent; the rest soften.
    ctx!.lineWidth = 1;
    for (const [a, b] of edges) {
      const hot = active !== null && (a === active || b === active);
      ctx!.globalAlpha = hoverSet
        ? hot
          ? 0.9
          : softAlpha * 0.6
        : colors.idleEdgeAlpha * 0.9;
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
      const inFocus = hoverSet === null || hoverSet.has(n);
      ctx!.globalAlpha = inFocus ? 1 : softAlpha;
      ctx!.fillStyle =
        n === active || n.isCenter
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
    ctx!.globalAlpha = 1;

    // One-shot pulse ring on note switch: an accent ring breathes outward
    // from the center disc and fades.
    if (pulseT0 > 0) {
      const t = (performance.now() - pulseT0) / PULSE_MS;
      if (t >= 1) {
        pulseT0 = 0;
      } else {
        const center = nodes[0];
        if (center) {
          const ease = 1 - (1 - t) * (1 - t);
          ctx!.globalAlpha = 0.5 * (1 - t);
          ctx!.strokeStyle = colors.accent;
          ctx!.lineWidth = 1.5;
          ctx!.beginPath();
          ctx!.arc(cx + center.x, cy + center.y, center.r + 4 + 15 * ease, 0, Math.PI * 2);
          ctx!.stroke();
          ctx!.lineWidth = 1;
          ctx!.globalAlpha = 1;
        }
      }
    }

    // Labels: always for the center, on hover/drag for neighbors.
    ctx!.font = `10.5px ${colors.fontUI}`;
    ctx!.textAlign = "center";
    ctx!.textBaseline = "top";
    for (const n of nodes) {
      if (!n.isCenter && n !== active) continue;
      const sx = Math.max(34, Math.min(width - 34, cx + n.x));
      const sy = cy + n.y + n.r + (n.isCenter ? 6 : 4);
      const label = trimLabel(n.title);
      const ly = Math.min(sy, height - 14);
      // Note-derived text: own direction, not the chrome's (see autoDir).
      ctx!.direction = autoDir(label);
      ctx!.globalAlpha = 1;
      // Subtle bg-colored halo so the label stays legible when a settled
      // neighbor disc drifts underneath it.
      ctx!.lineJoin = "round";
      ctx!.lineWidth = 3;
      ctx!.strokeStyle = colors.bg;
      ctx!.globalAlpha = 0.8;
      ctx!.strokeText(label, sx, ly);
      ctx!.globalAlpha = 1;
      ctx!.lineWidth = 1;
      ctx!.fillStyle = n.isCenter ? colors.text : colors.muted;
      ctx!.fillText(label, sx, ly);
    }
    ctx!.globalAlpha = 1;
  }

  // rAF loop that parks itself: when the sim has settled, nothing is being
  // dragged, no pulse is running, and no draw is pending, we stop scheduling
  // frames. Anything that changes state calls wake(). The whole loop also
  // stays parked while the document is hidden.
  let raf = 0;
  let running = false;
  function frame() {
    const pulsing = pulseT0 > 0;
    const simActive = (alpha > ALPHA_MIN || dragging !== null) && nodes.length > 0;
    if (simActive) {
      step();
      if (!dragging) alpha *= ALPHA_DECAY;
      needsDraw = true;
    }
    if (pulsing) needsDraw = true;
    if (needsDraw) {
      draw();
      needsDraw = false;
    }
    if (simActive || pulsing || pulseT0 > 0) {
      raf = requestAnimationFrame(frame);
    } else {
      running = false;
      raf = 0;
    }
  }
  function wake() {
    if (running || document.hidden) return;
    running = true;
    raf = requestAnimationFrame(frame);
  }
  wake();

  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) {
        if (running) {
          cancelAnimationFrame(raf);
          running = false;
          raf = 0;
        }
      } else {
        needsDraw = true;
        wake();
      }
    },
    { signal },
  );

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
    wake();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);
  resize();

  const themeObserver = new MutationObserver(() => {
    colors = readThemeColors();
    needsDraw = true;
    wake();
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

  function updateCursor() {
    canvas.style.cursor = pressed ? "grabbing" : hovered ? "grab" : "default";
  }

  canvas.style.touchAction = "none";

  canvas.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      const p = pointerPos(e);
      const hit = hitTest(p.x, p.y);
      if (!hit) return;
      pressed = hit;
      downAt = p;
      dragVel = { x: 0, y: 0 };
      lastDrag = { x: p.x, y: p.y, t: performance.now() };
      canvas.setPointerCapture(e.pointerId);
      updateCursor();
    },
    { signal },
  );

  canvas.addEventListener(
    "pointermove",
    (e) => {
      const p = pointerPos(e);
      if (pressed) {
        if (
          !dragging &&
          Math.hypot(p.x - downAt.x, p.y - downAt.y) > DRAG_THRESHOLD
        ) {
          dragging = pressed;
        }
        if (dragging) {
          // Pin the node to the pointer (world = screen offset here, k=1),
          // clamped to the pane, and keep a smoothed pointer velocity for
          // momentum on release.
          const bx = Math.max(30, width / 2 - 16);
          const by = Math.max(24, height / 2 - 18);
          dragging.x = Math.max(-bx, Math.min(bx, p.x - width / 2));
          dragging.y = Math.max(-by, Math.min(by, p.y - height / 2));
          dragging.vx = 0;
          dragging.vy = 0;
          const now = performance.now();
          const dt = now - lastDrag.t;
          if (dt > 0) {
            const s = Math.min(1, dt / 50);
            dragVel.x += ((p.x - lastDrag.x) / dt - dragVel.x) * s;
            dragVel.y += ((p.y - lastDrag.y) / dt - dragVel.y) * s;
          }
          lastDrag = { x: p.x, y: p.y, t: now };
          alpha = Math.max(alpha, 0.5); // keep neighbors elastic while held
          needsDraw = true;
          wake();
        }
        return;
      }
      const hit = hitTest(p.x, p.y);
      if (hit !== hovered) {
        hovered = hit;
        updateCursor();
        needsDraw = true;
        wake();
      }
    },
    { signal },
  );

  canvas.addEventListener(
    "pointerup",
    (e) => {
      const wasDragging = dragging !== null;
      if (dragging) {
        // Release with momentum: hand the smoothed pointer velocity to the sim.
        let vx = dragVel.x * MOMENTUM_SCALE;
        let vy = dragVel.y * MOMENTUM_SCALE;
        const speed = Math.hypot(vx, vy);
        if (speed > MOMENTUM_MAX) {
          vx *= MOMENTUM_MAX / speed;
          vy *= MOMENTUM_MAX / speed;
        }
        dragging.vx = vx;
        dragging.vy = vy;
        alpha = Math.max(alpha, 0.6); // let it glide and settle
      }
      const clicked = pressed;
      pressed = null;
      dragging = null;
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
      const p = pointerPos(e);
      hovered = hitTest(p.x, p.y);
      updateCursor();
      needsDraw = true;
      wake();
      if (!wasDragging && clicked && !clicked.isCenter) onOpen(clicked.id);
    },
    { signal },
  );

  canvas.addEventListener(
    "pointercancel",
    () => {
      pressed = null;
      dragging = null;
      updateCursor();
      needsDraw = true;
      wake();
    },
    { signal },
  );

  canvas.addEventListener(
    "dblclick",
    (e) => {
      const p = pointerPos(e);
      const hit = hitTest(p.x, p.y);
      if (hit && !hit.isCenter) onOpen(hit.id);
    },
    { signal },
  );

  canvas.addEventListener(
    "pointerleave",
    () => {
      if (hovered) {
        hovered = null;
        updateCursor();
        needsDraw = true;
        wake();
      }
    },
    { signal },
  );

  return {
    setData,
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      running = false;
      ro.disconnect();
      themeObserver.disconnect();
      abort.abort();
    },
  };
}

export default function LocalGraph() {
  const openPath = useStore((s) => s.openPath);
  const admin = useStore((s) => s.admin);
  useStore((s) => s.language); // re-render the chrome strings on language change
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<MiniSim | null>(null);

  // Just this note's neighborhood, sliced server-side (`/api/graph?around=`).
  // This panel used to download the ENTIRE vault graph — 534 kB on the
  // 1,388-note fixture, ~4 MB on a 10k-note vault — on every app open and
  // again on every vault event, in order to draw a dozen nodes.
  //
  // Fetched even while COLLAPSED, deliberately: the collapsed header still
  // shows the neighbor count, and it is the only way back into the pane, so
  // gating the fetch on `!collapsed` made a collapsed local graph disappear
  // from the panel entirely. That gate was worth considering when the fetch
  // was the whole vault graph; against a ~3 kB slice it buys nothing and
  // costs the reader the control.
  const data = useNoteNeighborhood(openPath);

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
          title={t(collapsed ? "showLocalGraph" : "hideLocalGraph")}
        >
          <span
            className={`s-tree__chevron${collapsed ? "" : " s-tree__chevron--open"}`}
            aria-hidden="true"
          >
            ›
          </span>
          <span className="s-panel-title">{t("localGraph")}</span>
          <span className="s-panel-count">{localeNum(hood.neighborCount)}</span>
        </button>
      </header>
      {!collapsed &&
        (isEmpty ? (
          // A lone unlabeled disc with a 0 badge reads as broken — say why
          // the pane is quiet instead of drawing an empty sky.
          <p className="s-localgraph__empty">
            {t(admin ? "noLinksYet" : "noPublishedLinks")}
          </p>
        ) : (
          <div className="s-localgraph__body" ref={wrapRef}>
            <canvas
              className="s-localgraph__canvas"
              ref={canvasRef}
              role="img"
              aria-label={t("localGraphAria")}
            />
            {/* The canvas is a picture that happens to be navigable with a
                mouse. This is the same neighbourhood as a list of real
                buttons: silent and out of the way until something focuses
                it, then it unfolds under the canvas so a sighted keyboard
                reader can see where they are. */}
            <nav className="s-localgraph__alt" aria-label={t("linkedNotesAria")}>
              {hood.neighbors.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className="s-localgraph__altitem"
                  dir="auto"
                  onClick={() => useStore.getState().openNote(n.id)}
                >
                  {n.title}
                </button>
              ))}
            </nav>
          </div>
        ))}
    </section>
  );
}
