import { describe, expect, it } from "vitest";
import {
  CHART_THEME,
  COMPARE_PALETTE,
  contrastRatio,
  relativeLuminance,
  type ResolvedTheme,
} from "./palette";

const THEMES: ResolvedTheme[] = ["light", "dark"];

describe("palette contrast", () => {
  it.each(THEMES)("every compare colour has ≥ 3:1 contrast on the %s surface", (theme) => {
    for (const colour of COMPARE_PALETTE[theme]) {
      expect(contrastRatio(colour, CHART_THEME[theme].surface)).toBeGreaterThanOrEqual(3);
    }
    expect(new Set(COMPARE_PALETTE[theme]).size).toBe(4);
  });

  it.each(THEMES)("chart text is AA and the series line is ≥ 3:1 in %s", (theme) => {
    const t = CHART_THEME[theme];
    expect(contrastRatio(t.text, t.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.muted, t.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.accent, t.surface)).toBeGreaterThanOrEqual(3);
  });

  it("computes WCAG ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 10);
    expect(() => relativeLuminance("red")).toThrow();
  });
});
