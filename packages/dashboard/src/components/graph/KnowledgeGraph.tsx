import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { JobStatus, KnowledgeBase } from "../../lib/types";
import { colorsFor, initialOf, KB_TYPE_COLORS } from "../../lib/constants";
import { deriveEdges, recencyOf } from "./edges";
import { useForceLayout } from "./useForceLayout";
import { ProcessingRing } from "./ProcessingRing";

export type GraphAesthetic = "organic" | "constellation" | "architectural";

interface KnowledgeGraphProps {
  knowledgeBases: KnowledgeBase[];
  aesthetic: GraphAesthetic;
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
  aesthetic,
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

  const repel =
    aesthetic === "constellation" ? 18000 : aesthetic === "architectural" ? 14000 : 16000;
  const spring = aesthetic === "architectural" ? 0.06 : 0.04;
  const restPad = aesthetic === "architectural" ? 110 : 130;

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

  const isDark = aesthetic === "constellation";
  const edgeColor = isDark ? "rgba(255,255,255,.18)" : "rgba(67,55,39,.18)";
  const edgeHover = isDark ? "rgba(180,200,255,.7)" : "rgba(143,107,52,.7)";

  const bgStyle: React.CSSProperties =
    aesthetic === "constellation"
      ? {
          background:
            "radial-gradient(ellipse at 50% 40%, #1a1d2e 0%, #0c0e1a 70%, #07080f 100%)",
          color: "#e6e7ee",
        }
      : aesthetic === "architectural"
      ? {
          background: "#fbf8f1",
          backgroundImage:
            "linear-gradient(rgba(120,108,86,.10) 1px, transparent 1px), linear-gradient(90deg, rgba(120,108,86,.10) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }
      : {
          background:
            "radial-gradient(ellipse at 50% 30%, #fffaf0 0%, #f5efe2 100%)",
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
      {aesthetic === "constellation" && (
        <div
          data-bg="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 13% 22%, rgba(255,255,255,.5) 1px, transparent 1.4px), radial-gradient(circle at 77% 64%, rgba(255,255,255,.4) 1px, transparent 1.4px), radial-gradient(circle at 38% 86%, rgba(255,255,255,.35) 1px, transparent 1.4px), radial-gradient(circle at 88% 14%, rgba(255,255,255,.45) 1px, transparent 1.4px), radial-gradient(circle at 22% 56%, rgba(255,255,255,.25) 1px, transparent 1.2px)",
            backgroundSize:
              "420px 420px, 380px 380px, 500px 500px, 360px 360px, 280px 280px",
          }}
        />
      )}

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
                {isHovered && aesthetic !== "constellation" && (
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
                      fill="#5a4d36"
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
                {aesthetic === "architectural" ? (
                  <ArchNode
                    n={n}
                    r={r}
                    tc={tc}
                    isSelected={isSelected}
                  />
                ) : (
                  <OrganicNode
                    n={n}
                    r={r}
                    tc={tc}
                    isDark={isDark}
                    isHovered={isHovered}
                    isSelected={isSelected}
                    recencyAlpha={recencyAlpha}
                  />
                )}

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
                      fill={isDark ? "rgba(18,20,32,.95)" : "rgba(255,250,240,.98)"}
                      stroke={isDark ? "rgba(255,255,255,.12)" : "rgba(67,55,39,.12)"}
                      style={{
                        filter: isDark
                          ? "drop-shadow(0 6px 14px rgba(0,0,0,.45))"
                          : "drop-shadow(0 4px 12px rgba(58,51,32,.10))",
                      }}
                    />
                    <text
                      x={0}
                      y={-15}
                      textAnchor="middle"
                      fontSize={10}
                      fontWeight={600}
                      letterSpacing="0.06em"
                      fill={isDark ? "#8c92aa" : "#a08665"}
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
                      fill={isDark ? "#e6e7ee" : "#3a3320"}
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
          background: isDark ? "rgba(20,22,36,.7)" : "rgba(255,250,240,.85)",
          backdropFilter: "blur(10px)",
          border: `0.5px solid ${
            isDark ? "rgba(255,255,255,.12)" : "rgba(67,55,39,.15)"
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
              : "rgba(67,55,39,.15)",
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
            background: isDark ? "rgba(20,22,36,.7)" : "rgba(255,250,240,.85)",
            backdropFilter: "blur(10px)",
            border: `0.5px solid ${
              isDark ? "rgba(255,255,255,.18)" : "rgba(67,55,39,.18)"
            }`,
            color: isDark ? "#e6e7ee" : "#3a3320",
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
          : "drop-shadow(0 2px 6px rgba(58,51,32,.10))",
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
          fill={isDark ? "#0c0e1a" : "#fffaf0"}
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
            fill={isDark ? "#0c0e1a" : "#fffaf0"}
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
        fill={isDark ? "#e6e7ee" : "#3a3320"}
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
        fill={isDark ? "rgba(255,255,255,.45)" : "rgba(58,51,32,.42)"}
        style={{ pointerEvents: "none", textTransform: "uppercase" }}
      >
        {n.kb_type} ·{" "}
        {n.recency > 0.7 ? "active" : n.recency > 0.4 ? "recent" : "quiet"}
      </text>
    </g>
  );
}

interface ArchNodeProps {
  n: NodeData;
  r: number;
  tc: { dot: string; tint: string; text: string };
  isSelected: boolean;
}

function ArchNode({ n, r, tc, isSelected }: ArchNodeProps) {
  const w = r * 2.2;
  const h = r * 1.5;
  const monogram = initialOf(n.name);
  const display = n.name.length > 18 ? n.name.slice(0, 17) + "…" : n.name;
  return (
    <g>
      {isSelected && (
        <rect
          x={-w / 2 - 4}
          y={-h / 2 - 4}
          width={w + 8}
          height={h + 8}
          rx={12}
          fill="none"
          stroke={tc.dot}
          strokeWidth={1.5}
          strokeDasharray="2 4"
        />
      )}
      <rect
        x={-w / 2 + 1}
        y={-h / 2 + 3}
        width={w}
        height={h}
        rx={10}
        fill="rgba(58,51,32,.10)"
      />
      <rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        rx={10}
        fill="#ffffff"
        stroke={tc.dot}
        strokeWidth={1.2}
        strokeDasharray={n.is_shared || n.is_system ? "4 3" : "0"}
      />
      <rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={4}
        rx={10}
        fill={tc.dot}
        opacity={0.9}
      />
      <g transform={`translate(${-w / 2 + 18} ${-h / 2 + 22})`}>
        <rect x={-12} y={-12} width={24} height={24} rx={6} fill={tc.tint} />
        <text
          textAnchor="middle"
          dy={4}
          fontSize={11}
          fontWeight={700}
          fill={tc.text}
        >
          {monogram}
        </text>
      </g>
      <text
        x={-w / 2 + 36}
        y={-h / 2 + 19}
        fontSize={11.5}
        fontWeight={600}
        fill="#2a2415"
      >
        {display}
      </text>
      <text
        x={-w / 2 + 36}
        y={-h / 2 + 30}
        fontSize={9.5}
        fontWeight={600}
        letterSpacing="0.08em"
        fill="rgba(58,51,32,.45)"
        style={{ textTransform: "uppercase" }}
      >
        {n.kb_type} · {n.chunk_count} items
      </text>
      <g transform={`translate(0 ${h / 2 - 14})`}>
        <rect
          x={-w / 2 + 8}
          y={0}
          width={w - 16}
          height={4}
          rx={2}
          fill={tc.dot}
          opacity={0.9}
        />
        <text
          x={-w / 2 + 8}
          y={-4}
          fontSize={8.5}
          fontWeight={600}
          letterSpacing="0.10em"
          fill="rgba(58,51,32,.40)"
          style={{ textTransform: "uppercase" }}
        >
          {n.chunk_count} chunks
        </text>
      </g>
      {n.is_shared && (
        <g transform={`translate(${w / 2 - 28} ${-h / 2 + 22})`}>
          <rect
            x={-22}
            y={-7}
            width={44}
            height={14}
            rx={7}
            fill="#fffaf0"
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
        color: isDark ? "#e6e7ee" : "#5a4d36",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = isDark
          ? "rgba(255,255,255,.08)"
          : "rgba(67,55,39,.08)";
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
