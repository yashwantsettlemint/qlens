import type { Config } from "tailwindcss";

/**
 * Design tokens. Palette and status vocabulary are defined once here and in
 * globals.css; business code reads status colors through lib/status.ts, never
 * hex literals.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ground: "var(--ground)",
        surface: "var(--surface)",
        ink: "var(--ink)",
        "ink-muted": "var(--ink-muted)",
        line: "var(--line)",
        accent: "var(--accent)",
        "accent-ink": "var(--accent-ink)",
        "accent-soft": "var(--accent-soft)",
        genai: "var(--genai)",
        "genai-tint": "var(--genai-tint)",
        // status vocabulary
        "ok-fg": "var(--ok-fg)",
        "ok-bg": "var(--ok-bg)",
        "warn-fg": "var(--warn-fg)",
        "warn-bg": "var(--warn-bg)",
        "bad-fg": "var(--bad-fg)",
        "bad-bg": "var(--bad-bg)",
        "dup-fg": "var(--dup-fg)",
        "dup-bg": "var(--dup-bg)",
        "panel-navy": "var(--panel-navy)",
        "panel-navy-line": "var(--panel-navy-line)",
        "panel-navy-ink": "var(--panel-navy-ink)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
        // Public-facing pages only (landing, login, register) — see app/layout.tsx.
        display: ["var(--font-display)", "ui-sans-serif", "system-ui", "sans-serif"],
        plex: ["var(--font-plex-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      fontSize: {
        // tight enterprise scale
        "2xs": ["11px", "14px"],
        xs: ["12px", "16px"],
        sm: ["13px", "18px"],
        base: ["14px", "21px"],
        lg: ["16px", "22px"],
        xl: ["20px", "26px"],
        "2xl": ["24px", "30px"],
      },
      borderRadius: {
        DEFAULT: "8px",
        sm: "6px",
        md: "8px",
        lg: "10px",
        xl: "14px",
        "2xl": "18px",
        full: "9999px",
      },
      boxShadow: {
        card: "0 1px 2px rgb(16 38 29 / 0.05), 0 8px 22px -12px rgb(16 90 60 / 0.16)",
        pop: "0 14px 36px -14px rgb(16 90 60 / 0.26)",
      },
      maxWidth: {
        content: "1440px",
      },
    },
  },
  plugins: [],
};
export default config;
