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
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
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
        DEFAULT: "4px",
        sm: "3px",
      },
      maxWidth: {
        content: "1440px",
      },
    },
  },
  plugins: [],
};
export default config;
