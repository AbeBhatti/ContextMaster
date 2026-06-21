import { useEffect, useRef, useState } from "react";

export interface GraphNodeInput {
  id: string;
  size: number;
}

export interface GraphEdgeInput {
  a: string;
  b: string;
  strength: number;
}

export interface NodePosition {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface ForceOpts {
  width: number;
  height: number;
  repel?: number;
  spring?: number;
  damping?: number;
  centerPull?: number;
  restPad?: number;
}

export function useForceLayout(
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
  opts: ForceOpts
) {
  const dimsRef = useRef({
    width: opts.width,
    height: opts.height,
    repel: opts.repel ?? 16000,
    spring: opts.spring ?? 0.04,
    damping: opts.damping ?? 0.82,
    centerPull: opts.centerPull ?? 0.004,
    restPad: opts.restPad ?? 130,
  });
  dimsRef.current = {
    width: opts.width,
    height: opts.height,
    repel: opts.repel ?? 16000,
    spring: opts.spring ?? 0.04,
    damping: opts.damping ?? 0.82,
    centerPull: opts.centerPull ?? 0.004,
    restPad: opts.restPad ?? 130,
  };

  const stateRef = useRef<Record<string, NodePosition>>({});
  const draggingRef = useRef<{ id: string } | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastSizeRef = useRef({ w: 0, h: 0 });
  const [, setTick] = useState(0);

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const nodeKey = nodes.map((n) => n.id).join("|");

  useEffect(() => {
    if (opts.width <= 0 || opts.height <= 0) return;
    const sizeChangedFromZero =
      lastSizeRef.current.w === 0 && opts.width > 0;
    lastSizeRef.current = { w: opts.width, h: opts.height };
    const cx = opts.width / 2;
    const cy = opts.height / 2;
    const prev = stateRef.current;
    const next: Record<string, NodePosition> = {};
    nodes.forEach((n, i) => {
      const p = prev[n.id];
      if (p && !sizeChangedFromZero) {
        next[n.id] = p;
      } else {
        const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
        const r = Math.min(opts.width, opts.height) * 0.22;
        next[n.id] = {
          x: cx + Math.cos(a) * r + (Math.random() - 0.5) * 30,
          y: cy + Math.sin(a) * r + (Math.random() - 0.5) * 30,
          vx: 0,
          vy: 0,
        };
      }
    });
    stateRef.current = next;
    setTick((t) => t + 1);
  }, [nodeKey, opts.width, opts.height, nodes]);

  useEffect(() => {
    let frame = 0;
    let lastTickAt = 0;
    const TARGET_FRAME_MS = 1000 / 60;
    const step = (now: number) => {
      const ns = stateRef.current;
      const d = dimsRef.current;
      if (!ns || d.width <= 0 || d.height <= 0) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      // Throttle to ~60Hz so 120/144Hz displays (common in Chrome) don't
      // run the physics simulation at 2-3× speed compared to 60Hz Safari.
      if (now - lastTickAt < TARGET_FRAME_MS - 1) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      lastTickAt = now;
      const ids = Object.keys(ns);
      for (let i = 0; i < ids.length; i++) {
        const a = ns[ids[i]];
        for (let j = i + 1; j < ids.length; j++) {
          const b = ns[ids[j]];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) d2 = 1;
          const f = d.repel / d2;
          const dd = Math.sqrt(d2);
          const fx = (dx / dd) * f;
          const fy = (dy / dd) * f;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }
      const sizeOf = (id: string) =>
        nodesRef.current.find((n) => n.id === id)?.size ?? 60;
      edgesRef.current.forEach((e) => {
        const a = ns[e.a];
        const b = ns[e.b];
        if (!a || !b) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dd = Math.sqrt(dx * dx + dy * dy) || 1;
        const rest = sizeOf(e.a) + sizeOf(e.b) + d.restPad;
        const f = (dd - rest) * d.spring * (e.strength || 0.5);
        const fx = (dx / dd) * f;
        const fy = (dy / dd) * f;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      });
      const cx = d.width / 2;
      const cy = d.height / 2;
      ids.forEach((id) => {
        const n = ns[id];
        n.vx += (cx - n.x) * d.centerPull;
        n.vy += (cy - n.y) * d.centerPull;
        n.vx *= d.damping;
        n.vy *= d.damping;
        if (draggingRef.current?.id !== id) {
          n.x += n.vx;
          n.y += n.vy;
        }
      });
      frame++;
      if (frame % 2 === 0) setTick((t) => t + 1);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const setDragging = (
    id: string | null,
    x?: number,
    y?: number
  ): void => {
    if (id == null) {
      draggingRef.current = null;
      return;
    }
    draggingRef.current = { id };
    const n = stateRef.current[id];
    if (n && x !== undefined && y !== undefined) {
      n.x = x;
      n.y = y;
      n.vx = 0;
      n.vy = 0;
    }
  };

  return { positions: stateRef.current, setDragging };
}
