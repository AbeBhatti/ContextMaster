import type { GraphAesthetic } from "./KnowledgeGraph";

interface AestheticToggleProps {
  value: GraphAesthetic;
  onChange: (v: GraphAesthetic) => void;
}

const OPTIONS: { id: GraphAesthetic; label: string }[] = [
  { id: "organic", label: "Organic" },
  { id: "constellation", label: "Constellation" },
  { id: "architectural", label: "Architectural" },
];

export function AestheticToggle({ value, onChange }: AestheticToggleProps) {
  const isDark = value === "constellation";
  return (
    <div
      className="absolute right-4 top-4 flex gap-0.5 rounded-[10px] p-0.5"
      style={{
        background: isDark ? "rgba(20,22,36,.7)" : "rgba(255,250,240,.85)",
        backdropFilter: "blur(10px)",
        border: `0.5px solid ${
          isDark ? "rgba(255,255,255,.12)" : "rgba(67,55,39,.15)"
        }`,
      }}
    >
      {OPTIONS.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className="rounded-md px-2.5 py-1 text-[11.5px] font-medium"
            style={{
              background: active
                ? isDark
                  ? "rgba(255,255,255,0.12)"
                  : "rgba(58,51,32,0.08)"
                : "transparent",
              color: isDark
                ? active
                  ? "#fffaf0"
                  : "#9b9eaa"
                : active
                ? "#2a2415"
                : "#7a6e54",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
