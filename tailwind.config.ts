import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    // Scan lib/ too — several modules expose status→class-name maps
    // (lib/events.ts, lib/operations-alerts.ts, lib/status-colors.ts).
    // Without this path, Tailwind JIT misses class strings declared only
    // in lib and the colors silently fall back to default.
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // SOLUX design system:
        //   solux         — bright green primary (CTAs, "won" status)
        //   solux-dark    — hover state for primary
        //   solux-ink     — near-black headlines and the dark ADMIN badge
        //   solux-accent  — muted neutral bar (table headers / chips)
        //   solux-muted   — section tint for grouped cards
        //   solux-surface — clean tinted surface for modern SaaS panels
        //   solux-orange  — legacy brand orange, reserved for PDF Date row
        solux: {
          DEFAULT: "#22c55e", // green-500 — primary
          dark: "#16a34a", // green-600 — hover
          ink: "#0b0f19",
          accent: "#e4e4ec",
          muted: "#f6f6f7",
          surface: "#f9fafb",
          orange: "#f5b400",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      letterSpacing: {
        widerx: "0.14em",
        widerxl: "0.22em",
        tightish: "-0.015em",
      },
      boxShadow: {
        soft: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        card: "0 1px 3px 0 rgb(0 0 0 / 0.07), 0 1px 2px -1px rgb(0 0 0 / 0.04)",
        "card-hover":
          "0 6px 18px -4px rgb(0 0 0 / 0.10), 0 3px 8px -3px rgb(0 0 0 / 0.05)",
        pop: "0 14px 36px -10px rgb(0 0 0 / 0.18), 0 6px 14px -4px rgb(0 0 0 / 0.08)",
        "ring-solux": "0 0 0 3px rgb(34 197 94 / 0.20)",
      },
      lineHeight: {
        snugger: "1.35",
      },
    },
  },
  plugins: [],
};
export default config;
