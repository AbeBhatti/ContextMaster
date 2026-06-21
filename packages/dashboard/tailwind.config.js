/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Cream surfaces — warm, light theme
        cream: {
          50: "#fffaf0", // page background
          100: "#faf6ec", // raised surface / hover
          200: "#f7f1e3", // sidebar
          300: "#f5efe2", // input / chip
          400: "#e6d3a3", // strong border
          500: "#cfc3a5", // muted dot / divider
        },
        // Text + muted (warm browns)
        ink: {
          900: "#2a2415", // primary text
          800: "#3a3320", // strong text
          700: "#5a4d36", // secondary text
          600: "#7a6e54", // tertiary text
          500: "#9b8e74", // muted
          400: "#a08665", // accent muted (gold-ish)
          300: "#cfc3a5", // disabled / divider
        },
        gold: {
          400: "#d6a24a", // accent / brand highlight
          500: "#a08665",
        },
        // KB type tokens — match artifact exactly
        kb: {
          software: "#5b8def",
          research: "#5fa57a",
          business: "#a87bc7",
          course: "#d6a24a",
          general: "#8a8473",
        },
        // Chunk type tokens — match artifact exactly
        chunk: {
          decisions: "#5b8def",
          state: "#8a8473",
          conventions: "#a87bc7",
          findings: "#5fa57a",
          questions: "#d6a24a",
          references: "#7a8a99",
        },
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
        "pulse-glow": {
          "0%, 100%": {
            transform: "scale(1)",
            boxShadow: "0 0 0 0 rgba(95, 165, 122, 0.5)",
          },
          "50%": {
            transform: "scale(1.03)",
            boxShadow: "0 0 30px 10px rgba(95, 165, 122, 0.35)",
          },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out",
        "slide-in-right": "slide-in-right 220ms ease-out",
        shimmer: "shimmer 2s linear infinite",
        "fade-rise": "fade-rise 300ms ease-out both",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
