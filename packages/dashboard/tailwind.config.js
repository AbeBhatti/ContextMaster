/** @type {import('tailwindcss').Config} */

/* ============================================================
 * ContextMaster design tokens — single source of truth.
 *
 * Sampled from the onboarding "Connect your AI Tool" screen and
 * promoted to the system palette. Tweak a value in `palette` and it
 * propagates everywhere; components reference the semantic token
 * names below (never raw hex).
 *
 * Scheme: calm, professional, Linear/Vercel-grade restraint.
 * White surfaces on a faint cool wash, charcoal-navy text, one muted
 * steel-blue accent for primary actions + active states. No gradients
 * on buttons, no neon, no glow, no heavy dark cards.
 *
 * CONTRAST CONTRACT: `accent` is dark enough that white text on it is
 * always legible (#3d5a80 vs #fff ≈ 7:1). Any filled accent button
 * pairs with `accent-fg` (white); any light/white button pairs with a
 * dark `fg`. Fill and text must never be the same value.
 * ============================================================ */
const palette = {
  // Surfaces — white on a very subtle cool off-white wash
  canvas: "#ffffff", // app/page background
  canvasWash: "#fafbfc", // faint cool wash behind content
  surface: "#ffffff", // cards, panels, modals
  surfaceMuted: "#f7f9fb", // hover / raised rows
  surfaceSunken: "#f1f4f7", // sidebar, wells, inputs-at-rest
  field: "#f1f4f7", // input / chip fill

  // Borders & dividers — thin, light gray
  border: "#e2e5e9", // default 1px hairline border
  borderStrong: "#d4d9df", // emphasized border / dividers

  // Text — charcoal-navy → muted gray
  fg: "#1f2937", // primary text / headings
  fgStrong: "#111827", // strongest headings
  fgSecondary: "#374151", // body
  fgMuted: "#6b7280", // secondary / captions / utility text
  fgSubtle: "#9ca3af", // placeholder / tertiary
  fgFaint: "#b9c0cb", // faintest
  fgDisabled: "#d1d5db",

  // Accent — muted steel/navy blue (the ONLY brand hue)
  accent: "#3d5a80",
  accentHover: "#34506e", // darker on hover
  accentActive: "#2b4257", // pressed
  accentSubtle: "#eef2f7", // tinted bg for active/selected rows
  accentBorder: "#cbd6e4",
  accentFg: "#ffffff", // text/icon on top of accent fill

  // Status (used sparingly; contrast-safe on white)
  success: "#2f8a5b",
  warning: "#b4791f",
  danger: "#c4453f",
  info: "#3d5a80",
};

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── Semantic tokens (prefer these) ───────────────────────
        canvas: {
          DEFAULT: palette.canvas,
          wash: palette.canvasWash,
        },
        surface: {
          DEFAULT: palette.surface,
          muted: palette.surfaceMuted,
          sunken: palette.surfaceSunken,
          field: palette.field,
        },
        border: {
          DEFAULT: palette.border,
          strong: palette.borderStrong,
        },
        fg: {
          DEFAULT: palette.fg,
          strong: palette.fgStrong,
          secondary: palette.fgSecondary,
          muted: palette.fgMuted,
          subtle: palette.fgSubtle,
          faint: palette.fgFaint,
          disabled: palette.fgDisabled,
        },
        accent: {
          DEFAULT: palette.accent,
          hover: palette.accentHover,
          active: palette.accentActive,
          subtle: palette.accentSubtle,
          border: palette.accentBorder,
          fg: palette.accentFg,
        },
        success: palette.success,
        warning: palette.warning,
        danger: palette.danger,
        info: palette.info,

        // ── Legacy aliases ───────────────────────────────────────
        // Existing components consume `cream`/`ink`/`gold`. Remapped
        // onto the new palette so the whole app adopts the steel-blue
        // light theme even before the component sweep finishes.
        cream: {
          50: palette.canvas, // page background / white surface
          100: palette.surfaceMuted, // raised surface / hover
          200: palette.surfaceSunken, // sidebar
          300: palette.field, // chip / input
          400: palette.border, // border
          500: palette.borderStrong, // strong divider / muted dot
        },
        ink: {
          900: palette.fg, // primary text
          800: palette.fgStrong, // strong text / dark control
          700: palette.fgSecondary, // secondary text
          600: palette.fgMuted, // tertiary text
          500: palette.fgSubtle, // muted
          400: palette.fgFaint, // faint
          300: palette.fgDisabled, // disabled / divider
        },
        // `gold` was the old accent → now the single steel-blue accent.
        gold: {
          400: palette.accent,
          500: palette.accentHover,
        },

        // ── Category hues (KB + chunk types) ─────────────────────
        // Muted, contrast-safe on white. `software`/`decisions` anchor
        // to the steel-blue accent; the rest are restrained companions.
        kb: {
          software: "#3d5a80",
          research: "#4f7d6a",
          business: "#3f7a82",
          course: "#6b86a8",
          general: "#64748b",
        },
        chunk: {
          decisions: "#3d5a80",
          state: "#64748b",
          conventions: "#3f7a82",
          findings: "#4f7d6a",
          questions: "#6b86a8",
          references: "#566273",
        },
      },
      borderRadius: {
        // One consistent radius scale — buttons/inputs 10px, cards 12px.
        none: "0",
        sm: "0.375rem", // 6px — small chips/badges
        DEFAULT: "0.625rem", // 10px — buttons, inputs
        md: "0.625rem", // 10px
        lg: "0.75rem", // 12px — cards, panels, modals
        xl: "0.875rem", // 14px
        "2xl": "1rem", // 16px — large surfaces
        full: "9999px",
      },
      boxShadow: {
        // Soft, low-spread elevation only — no heavy/dark shadows.
        // Default Tailwind scale is overridden so existing `shadow-sm/
        // md/lg/xl/2xl` usage stays on this one calm scale.
        none: "none",
        xs: "0 1px 2px 0 rgba(16, 24, 40, 0.05)",
        sm: "0 1px 2px 0 rgba(16, 24, 40, 0.04), 0 1px 3px 0 rgba(16, 24, 40, 0.06)",
        DEFAULT:
          "0 1px 2px 0 rgba(16, 24, 40, 0.04), 0 1px 3px 0 rgba(16, 24, 40, 0.06)",
        card: "0 1px 2px 0 rgba(16, 24, 40, 0.04), 0 1px 3px 0 rgba(16, 24, 40, 0.06)",
        md: "0 2px 6px -2px rgba(16, 24, 40, 0.06), 0 4px 12px -2px rgba(16, 24, 40, 0.08)",
        elevated:
          "0 2px 6px -2px rgba(16, 24, 40, 0.06), 0 4px 12px -2px rgba(16, 24, 40, 0.08)",
        lg: "0 8px 24px -6px rgba(16, 24, 40, 0.10), 0 2px 8px -2px rgba(16, 24, 40, 0.06)",
        xl: "0 8px 24px -6px rgba(16, 24, 40, 0.12), 0 2px 8px -2px rgba(16, 24, 40, 0.08)",
        "2xl":
          "0 16px 40px -12px rgba(16, 24, 40, 0.16), 0 4px 12px -4px rgba(16, 24, 40, 0.08)",
        overlay:
          "0 16px 40px -12px rgba(16, 24, 40, 0.16), 0 4px 12px -4px rgba(16, 24, 40, 0.08)",
        focus: "0 0 0 3px rgba(61, 90, 128, 0.20)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "slide-in-right": {
          "0%": { transform: "translateX(20px)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "fade-rise": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out",
        "slide-in-right": "slide-in-right 220ms ease-out",
        shimmer: "shimmer 2s linear infinite",
        "fade-rise": "fade-rise 300ms ease-out both",
        "pulse-soft": "pulse-soft 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
