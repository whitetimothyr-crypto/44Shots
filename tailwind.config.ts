import type { Config } from "tailwindcss";

/**
 * 44 Shots / NOMOS design tokens.
 *
 * Matte, minimalist, dark-first aesthetic. Sourced verbatim from
 * index.html :root variables (lines 35-68) and css/whiteboard.css
 * rail patterns (lines 132-275).
 *
 * Palette intent:
 *   - Backgrounds skew almost-black, never pure #000
 *   - Accent is a single teal, used sparingly for interactive cues only
 *   - Gold reserved for warnings and CTA prominence
 *   - Violet reserved for stats (data values, never chrome)
 *   - Home + Away are vivid hockey identity colors
 *   - No gradients, no glossy highlights, minimal shadow depth
 *
 * Typography intent:
 *   - Outfit (sans) for UI and dense data labels
 *   - Cormorant Garamond (italic display) for editorial moments
 *   - Letter-spacing scale rises with chrome rank: tight body text,
 *     loose meta labels and section eyebrows
 */
const config: Config = {
  content: [
    "./src/**/*.{ts,tsx,js,jsx,mdx}",
    "./app/**/*.{ts,tsx,js,jsx,mdx}",
    "./components/**/*.{ts,tsx,js,jsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "#080810",
        "bg-2": "#0c0c14",
        surface: "#0c0c14",
        panel: "#0c0c14",
        "panel-hi": "#1a1a2e",
        border: "#1a1a2e",
        "border-hi": "rgba(58,174,172,0.4)",
        text: "#E8E8E0",
        "text-muted": "#888899",
        muted: "#666680",
        accent: "#3AAEAC",
        teal: "#3AAEAC",
        gold: "#C9A84C",
        "accent-2": "#C9A84C",
        stat: "#C08CFF",
        "accent-3": "#C08CFF",
        destructive: "#A0364E",
        red: "#A0364E",
        miss: "#666680",
        home: "#e63946",
        away: "#2d7dd2",
        ice: "#e8f1ff",
        "ice-2": "#cfe0f5",
        "line-blue": "#1f5fc4",
        "line-red": "#c8262b",
        crease: "#7ab3ff",
        ink: "#080810",
        paper: "#E8E8E0",
      },
      fontFamily: {
        sans: ["Outfit", "system-ui", "sans-serif"],
        serif: ["Cormorant Garamond", "Georgia", "serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontWeight: {
        normal: "400",
        medium: "500",
        bold: "700",
        black: "900",
      },
      letterSpacing: {
        body: "0.01em",
        wide: "0.04em",
        loose: "0.06em",
        button: "0.12em",
        eyebrow: "0.14em",
        label: "0.16em",
        meta: "0.18em",
        nomos: "0.22em",
      },
      borderRadius: {
        rail: "6px",
        chip: "8px",
        card: "10px",
        pad: "12px",
        sheet: "14px",
      },
      boxShadow: {
        rail: "0 10px 30px rgba(0,0,0,0.5)",
        flat: "inset 0 0 0 1px rgba(255,255,255,0.06)",
        ring: "inset 0 0 0 2px rgba(0,0,0,0.06)",
      },
      transitionDuration: {
        snap: "120ms",
        ease: "150ms",
        smooth: "240ms",
      },
      aspectRatio: {
        rink: "200 / 85",
        rinkLegacy: "100 / 60",
        net: "6 / 4",
      },
      spacing: {
        rail: "100px",
        railLeft: "56px",
        header: "88px",
        headerCompact: "56px",
        nav: "40px",
      },
    },
  },
  plugins: [],
};

export default config;
