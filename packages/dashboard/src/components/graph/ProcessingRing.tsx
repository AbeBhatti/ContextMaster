import { useEffect, useState } from "react";
import type { JobStatus } from "../../lib/types";

interface ProcessingRingProps {
  // Node radius in SVG units. The ring renders just outside this radius
  // so the node art underneath stays untouched.
  radius: number;
  // 'queued'    → slow pulse + slow spin (waiting in queue)
  // 'processing' → fast spin (active extraction)
  status: JobStatus;
  // Controls fade-out. The parent passes `visible=false` once the job is no
  // longer in-flight; the CSS transition takes 0.5s to opacity 0, then the
  // ring is unmounted by the parent on the next render tick.
  visible?: boolean;
  // Distinct id seed so two simultaneous rings on the same SVG get unique
  // filter/gradient defs.
  idSeed: string;
}

// Visual constants. The arc is ~28% of the circle; rounded line caps soften
// the leading/trailing edges. Teal accent matches existing dashboard signals.
const ARC_FRACTION = 0.28;
const STROKE_WIDTH = 2.5;
const RING_GAP = 4; // px gap between node edge and ring
const ACCENT = "#22d3ee";

export function ProcessingRing({
  radius,
  status,
  visible = true,
  idSeed,
}: ProcessingRingProps) {
  // Two-phase mount so the fade-in plays on first paint and the fade-out
  // gets a chance to animate before unmount.
  const [opacity, setOpacity] = useState(0);
  useEffect(() => {
    setOpacity(visible ? 1 : 0);
  }, [visible]);

  const r = radius + RING_GAP;
  const circumference = 2 * Math.PI * r;
  const dash = circumference * ARC_FRACTION;
  const gap = circumference - dash;
  const filterId = `pr-glow-${idSeed}`;
  const spinClass =
    status === "queued"
      ? "processing-ring-spin-slow"
      : "processing-ring-spin";

  return (
    <g
      className="processing-ring-fade"
      style={{ opacity, pointerEvents: "none" }}
    >
      <defs>
        {/* Subtle glow so the ring reads against both light and dark
            backgrounds without dominating the node. */}
        <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="1.6" />
          <feFlood floodColor={ACCENT} floodOpacity="0.75" />
          <feComposite in2="SourceAlpha" operator="in" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g className={spinClass}>
        {/* Faint full-circle backdrop so the arc doesn't look like it's
            travelling through empty space. Helps a lot at small node sizes. */}
        <circle
          cx={0}
          cy={0}
          r={r}
          fill="none"
          stroke={ACCENT}
          strokeOpacity={0.12}
          strokeWidth={STROKE_WIDTH}
        />
        {/* The travelling arc itself. strokeDasharray = [arc, gap] paints a
            single arc segment; rotation is applied by the parent class. */}
        <circle
          cx={0}
          cy={0}
          r={r}
          fill="none"
          stroke={ACCENT}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${gap}`}
          filter={`url(#${filterId})`}
        />
      </g>
    </g>
  );
}
