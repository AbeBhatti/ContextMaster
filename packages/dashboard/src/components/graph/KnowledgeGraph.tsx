import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { JobStatus, KnowledgeBase } from "../../lib/types";
import { colorsFor, initialOf, KB_TYPE_COLORS } from "../../lib/constants";
import { deriveEdges, recencyOf } from "./edges";
import { useForceLayout } from "./useForceLayout";
import { ProcessingRing } from "./ProcessingRing";

interface KnowledgeGraphProps {
  knowledgeBases: KnowledgeBase[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateKb?: () => void;
  onNodeContextMenu?: (
    event: React.MouseEvent,
    kb: KnowledgeBase
  ) => void;
  // kb_id → status. Each entry renders a spinning arc around the node so the
  // user can see at a glance which KBs have server-side extraction in flight.
  // Omitted (or empty) means no rings render — KBPanel and other lighter
  // surfaces don't need to plumb this through.
  processingKbStatus?: Map<string, JobStatus>;
}

interface NodeData extends KnowledgeBase {
  size: number;
  recency: number;
}

export function KnowledgeGraph({
  knowledgeBases,
  selectedId,
  onSelect,
  onCreateKb,
  onNodeContextMenu,
  processingKbStatus,
}: KnowledgeGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const nodes: NodeData[] = useMemo(
    () =>
      knowledgeBases.map((kb) => ({
        ...kb,
        size: 30 + Math.min(34, Math.sqrt(Math.max(1, kb.chunk_count)) * 3.2),
        recency: recencyOf(kb.updated_at),
      })),
    [knowledgeBases]
  );

  const edges = useMemo(() => deriveEdges(knowledgeBases), [knowledgeBases]);

  const repel = 16000;
  const spring = 0.04;
  const restPad = 130;

  const { positions, setDragging } = useForceLayout(
    nodes.map((n) => ({ id: n.id, size: n.size })),
    edges,
    { width: size.w, height: size.h, repel, spring, restPad }
  );

  const panRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(
    null
  );

  const onWheel: React.WheelEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    setView((v) => {
      const nk = Math.max(0.4, Math.min(2.2, v.k * (1 + delta)));
      return { ...v, k: nk };
    });
  };

  const onMouseDown: React.MouseEventHandler<HTMLDivElement> = (e) => {
    const t = e.target as Element;
    if (
      t === e.currentTarget ||
      t.tagName === "svg" ||
      (t as HTMLElement).dataset?.bg === "true"
    ) {
      panRef.current = {
        x: e.clientX,
        y: e.clientY,
        vx: view.x,
        vy: view.y,
      };
    }
  };

  const onMouseMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (panRef.current) {
      const p = panRef.current;
      setView((v) => ({
        ...v,
        x: p.vx + (e.clientX - p.x),
        y: p.vy + (e.clientY - p.y),
      }));
    }
    onNodeMove(e);
  };

  const onMouseUp = () => {
    panRef.current = null;
  };

  const dragRef = useRef<{
    id: string;
    ox: number;
    oy: number;
    moved: boolean;
    sx: number;
    sy: number;
  } | null>(null);

  const startNodeDrag = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const svg = containerRef.current?.querySelector("svg");
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM()?.inverse();
    if (!ctm) return;
    const local = pt.matrixTransform(ctm);
    const localX = (local.x - view.x) / view.k;
    const localY = (local.y - view.y) / view.k;
    const pos = positions[id];
    if (!pos) return;
    dragRef.current = {
      id,
      ox: localX - pos.x,
      oy: localY - pos.y,
      moved: false,
      sx: e.clientX,
      sy: e.clientY,
    };
  };

  const onNodeMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const d = dragRef.current;
    const svg = containerRef.current?.querySelector("svg");
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM()?.inverse();
    if (!ctm) return;
    const local = pt.matrixTransform(ctm);
    const localX = (local.x - view.x) / view.k;
    const localY = (local.y - view.y) / view.k;
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.moved = true;
    setDragging(d.id, localX - d.ox, localY - d.oy);
  };

  const onNodeUp = (id: string) => {
    const d = dragRef.current;
    setDragging(null);
    if (d && !d.moved) onSelect(id);
    dragRef.current = null;
  };

  // Light theme on the same white canvas as the rest of the app.
  const isDark = false;
  const edgeColor = "rgba(24,24,27,.16)";
  const edgeHover = "rgba(61,90,128,.55)";

  const bgStyle: React.CSSProperties = {
    background: "radial-gradient(ellipse at 50% 30%, #ffffff 0%, #fafafa 100%)",
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden rounded-2xl"
      style={bgStyle}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => {
        panRef.current = null;
        dragRef.current = null;
        setDragging(null);
      }}
    >
      <svg
        width={size.w}
        height={size.h}
        style={{
          display: "block",
          cursor: panRef.current ? "grabbing" : "grab",
        }}
      >
        <defs>
          {Object.entries(KB_TYPE_COLORS).map(([k, v]) => (
            <radialGradient key={k} id={`g-${k}`} cx="35%" cy="30%" r="75%">
              <stop offset="0%" stopColor={v.dot} stopOpacity={isDark ? 1 : 0.95} />
              <stop offset="60%" stopColor={v.dot} stopOpacity={isDark ? 0.85 : 0.65} />
              <stop offset="100%" stopColor={v.dot} stopOpacity={isDark ? 0.55 : 0.35} />
            </radialGradient>
          ))}
          <filter id="soft-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g
          style={{
            transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.k})`,
            willChange: "transform",
          }}
        >
          {edges.map((e, i) => {
            const a = positions[e.a];
            const b = positions[e.b];
            if (!a || !b) return null;
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            const cx = mx + (-dy / len) * 18;
            const cy = my + (dx / len) * 18;
            const isHovered =
              hoveredEdge === i || hovered === e.a || hovered === e.b;
            const tagW = Math.max(...e.tags.map((t) => t.length)) * 6.8;
            return (
              <g key={i}>
                <path
                  d={`M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`}
                  stroke={isHovered ? edgeHover : edgeColor}
                  strokeWidth={(0.8 + e.strength * 2.4) * (isHovered ? 1.5 : 1)}
                  strokeLinecap="round"
                  strokeDasharray={isHovered ? "6 6" : "0"}
                  fill="none"
                />
                <path
                  d={`M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`}
                  stroke="transparent"
                  strokeWidth={14}
                  fill="none"
                  onMouseEnter={() => setHoveredEdge(i)}
                  onMouseLeave={() => setHoveredEdge(null)}
                />
                {isHovered && (
                  <g transform={`translate(${cx} ${cy})`}>
                    <rect
                      x={-tagW / 2}
                      y={-9}
                      width={tagW}
                      height={18}
                      rx={9}
                      fill="#fff"
                      stroke={edgeColor}
                    />
                    <text
                      textAnchor="middle"
                      dy={4}
                      fontSize={10}
                      fontWeight={500}
                      fill="#52525b"
                    >
                      {e.tags[0]}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {nodes.map((n) => {
            const p = positions[n.id];
            if (!p) return null;
            const tc = colorsFor(n.kb_type);
            const r = n.size;
            const isSelected = selectedId === n.id;
            const isHovered = hovered === n.id;
            const scale = isHovered || isSelected ? 1.06 : 1;
            const recencyAlpha = 0.25 + n.recency * 0.7;

            return (
              <g
                key={n.id}
                style={{
                  cursor: "pointer",
                  transform: `translate3d(${p.x}px, ${p.y}px, 0) scale(${scale})`,
                  willChange: "transform",
                }}
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered(null)}
                onMouseDown={(e) => startNodeDrag(e, n.id)}
                onMouseUp={() => onNodeUp(n.id)}
                onContextMenu={(e) => {
                  if (onNodeContextMenu) {
                    e.preventDefault();
                    e.stopPropagation();
                    onNodeContextMenu(e, n);
                  }
                }}
              >
                {processingKbStatus?.get(n.id) && (
                  <ProcessingRing
                    radius={r}
                    status={processingKbStatus.get(n.id)!}
                    visible={true}
                    idSeed={n.id}
                  />
                )}
                <OrganicNode
                  n={n}
                  r={r}
                  tc={tc}
                  isDark={isDark}
                  isHovered={isHovered}
                  isSelected={isSelected}
                  recencyAlpha={recencyAlpha}
                />

                {isHovered && (
                  <g
                    transform={`translate(0 ${-r - 30})`}
                    style={{ pointerEvents: "none" }}
                  >
                    <rect
                      x={-130}
                      y={-30}
                      width={260}
                      height={32}
                      rx={8}
                      fill={isDark ? "rgba(18,20,32,.95)" : "rgba(255,255,255,.98)"}
                      stroke={isDark ? "rgba(255,255,255,.12)" : "rgba(24,24,27,.12)"}
                      style={{
                        filter: isDark
                          ? "drop-shadow(0 6px 14px rgba(0,0,0,.45))"
                          : "drop-shadow(0 4px 12px rgba(24,24,27,.10))",
                      }}
                    />
                    <text
                      x={0}
                      y={-15}
                      textAnchor="middle"
                      fontSize={10}
                      fontWeight={600}
                      letterSpacing="0.06em"
                      fill={isDark ? "#8c92aa" : "#71717a"}
                      style={{ textTransform: "uppercase" }}
                    >
                      Last session
                    </text>
                    <text
                      x={0}
                      y={-2}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={500}
                      fill={isDark ? "#e6e7ee" : "#27272a"}
                    >
                      {truncate(
                        n.last_session_summary ??
                          n.summary ??
                          n.description ??
                          "No recent activity",
                        38
                      )}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div
        className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-[10px] p-1"
        style={{
          background: isDark ? "rgba(20,22,36,.7)" : "rgba(255,255,255,.85)",
          backdropFilter: "blur(10px)",
          border: `0.5px solid ${
            isDark ? "rgba(255,255,255,.12)" : "rgba(24,24,27,.15)"
          }`,
        }}
      >
        <IconBtn
          isDark={isDark}
          onClick={() =>
            setView((v) => ({ ...v, k: Math.min(2.2, v.k * 1.2) }))
          }
        >
          ＋
        </IconBtn>
        <IconBtn
          isDark={isDark}
          onClick={() =>
            setView((v) => ({ ...v, k: Math.max(0.4, v.k / 1.2) }))
          }
        >
          −
        </IconBtn>
        <div
          style={{
            width: 1,
            height: 18,
            background: isDark
              ? "rgba(255,255,255,.15)"
              : "rgba(24,24,27,.15)",
          }}
        />
        <IconBtn
          isDark={isDark}
          onClick={() => setView({ x: 0, y: 0, k: 1 })}
          title="Reset"
        >
          ⊙
        </IconBtn>
      </div>

      {onCreateKb && (
        <button
          onClick={onCreateKb}
          className="absolute bottom-4 left-4 flex items-center gap-2 rounded-[10px] px-3.5 py-2.5 text-[12.5px] font-medium"
          style={{
            background: isDark ? "rgba(20,22,36,.7)" : "rgba(255,255,255,.85)",
            backdropFilter: "blur(10px)",
            border: `0.5px solid ${
              isDark ? "rgba(255,255,255,.18)" : "rgba(24,24,27,.18)"
            }`,
            color: isDark ? "#e6e7ee" : "#27272a",
          }}
        >
          <Plus size={14} /> Add knowledge base
        </button>
      )}
    </div>
  );
}

interface OrganicNodeProps {
  n: NodeData;
  r: number;
  tc: { dot: string; text: string };
  isDark: boolean;
  isHovered: boolean;
  isSelected: boolean;
  recencyAlpha: number;
}

function OrganicNode({
  n,
  r,
  tc,
  isDark,
  isHovered,
  isSelected,
  recencyAlpha,
}: OrganicNodeProps) {
  const monogram = initialOf(n.name);
  return (
    <g
      style={{
        filter: isDark
          ? "none"
          : "drop-shadow(0 2px 6px rgba(24,24,27,.10))",
      }}
    >
      <circle
        className="graph-node-radius"
        r={r + 18}
        fill={tc.dot}
        opacity={recencyAlpha * (isDark ? 0.4 : 0.18) * (isHovered ? 1.6 : 1)}
        filter="url(#soft-glow)"
      />
      {isSelected && (
        <circle
          className="graph-node-radius"
          r={r + 10}
          fill="none"
          stroke={tc.dot}
          strokeWidth={1.5}
          strokeDasharray="3 4"
          opacity={0.7}
        />
      )}
      <circle
        className="graph-node-radius"
        r={r}
        fill={`url(#g-${n.kb_type})`}
        stroke={
          n.is_shared || n.is_system
            ? tc.dot
            : isDark
            ? "rgba(255,255,255,.20)"
            : "rgba(255,255,255,.85)"
        }
        strokeWidth={n.is_shared || n.is_system ? 1.5 : 1}
        strokeDasharray={n.is_shared || n.is_system ? "4 3" : "0"}
      />
      <ellipse
        cx={-r * 0.25}
        cy={-r * 0.3}
        rx={r * 0.45}
        ry={r * 0.28}
        fill={isDark ? "rgba(255,255,255,.15)" : "rgba(255,255,255,.55)"}
        style={{ pointerEvents: "none" }}
      />
      <g transform={`translate(${r * 0.7} ${-r * 0.7})`}>
        <circle
          r={11}
          fill={isDark ? "#0c0e1a" : "#ffffff"}
          stroke={tc.dot}
          strokeWidth={1.2}
        />
        <text
          textAnchor="middle"
          dy={3.5}
          fontSize={10}
          fontWeight={700}
          fill={isDark ? "#e6e7ee" : tc.text}
        >
          {n.chunk_count}
        </text>
      </g>
      <text
        textAnchor="middle"
        dy={3}
        fontSize={Math.max(13, r * 0.42)}
        fontWeight={700}
        letterSpacing="-0.02em"
        fill={isDark ? "rgba(255,255,255,.95)" : tc.text}
        style={{ pointerEvents: "none" }}
      >
        {monogram}
      </text>
      {n.is_shared && (
        <g transform={`translate(0 ${-r - 16})`}>
          <rect
            x={-22}
            y={-7}
            width={44}
            height={14}
            rx={7}
            fill={isDark ? "#0c0e1a" : "#ffffff"}
            stroke={tc.dot}
            strokeDasharray="3 2"
            strokeWidth={1}
          />
          <text
            textAnchor="middle"
            dy={3.5}
            fontSize={8.5}
            fontWeight={700}
            letterSpacing="0.10em"
            fill={tc.text}
          >
            SHARED
          </text>
        </g>
      )}
      <text
        textAnchor="middle"
        dy={r + 22}
        fontSize={13}
        fontWeight={600}
        letterSpacing="-0.01em"
        fill={isDark ? "#e6e7ee" : "#27272a"}
        style={{ pointerEvents: "none" }}
      >
        {n.name}
      </text>
      <text
        textAnchor="middle"
        dy={r + 36}
        fontSize={10}
        fontWeight={500}
        letterSpacing="0.08em"
        fill={isDark ? "rgba(255,255,255,.45)" : "rgba(24,24,27,.42)"}
        style={{ pointerEvents: "none", textTransform: "uppercase" }}
      >
        {n.kb_type} ·{" "}
        {n.recency > 0.7 ? "active" : n.recency > 0.4 ? "recent" : "quiet"}
      </text>
    </g>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  isDark,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
  isDark: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="rounded-md text-[14px] leading-none"
      style={{
        width: 26,
        height: 26,
        background: "transparent",
        border: 0,
        color: isDark ? "#e6e7ee" : "#52525b",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = isDark
          ? "rgba(255,255,255,.08)"
          : "rgba(24,24,27,.08)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
