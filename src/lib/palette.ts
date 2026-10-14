// Chart colours (canvas needs concrete values) and WCAG contrast helpers.
// Compare colours follow the Okabe–Ito colour-blind-safe hues, darkened for the light theme so every
// line keeps ≥ 3:1 contrast against the chart surface (WCAG 1.4.11).

export type ResolvedTheme = "light" | "dark";

export interface ChartTheme {
  surface: string;
  text: string;
  muted: string;
  grid: string;
  border: string;
  accent: string;
  accentFill: string;
  up: string;
  down: string;
}

export const CHART_THEME: Record<ResolvedTheme, ChartTheme> = {
  light: {
    surface: "#ffffff",
    text: "#1b1a17",
    muted: "#5c584f",
    grid: "#efede6",
    border: "#d9d5cb",
    accent: "#b07a12",
    accentFill: "rgba(176, 122, 18, 0.16)",
    up: "#0d7a3b",
    down: "#b42318",
  },
  dark: {
    surface: "#181816",
    text: "#f1eee6",
    muted: "#a9a497",
    grid: "#23221f",
    border: "#3a3833",
    accent: "#e8b84a",
    accentFill: "rgba(232, 184, 74, 0.18)",
    up: "#4ade80",
    down: "#f87171",
  },
};

/** Blue, vermillion, bluish green, reddish purple. */
export const COMPARE_PALETTE: Record<ResolvedTheme, readonly string[]> = {
  light: ["#0072b2", "#c45200", "#00805d", "#a8457e"],
  dark: ["#56b4e9", "#e69f00", "#2bb58a", "#d68bb8"],
};

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`Not a hex colour: ${hex}`);
  const [r, g, b] = m.slice(1).map((h) => channel(parseInt(h, 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
