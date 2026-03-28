import { describe, expect, it } from "vitest";
import {
  clip,
  fit,
  stripAnsi,
  visibleLength,
  zipPanes,
} from "../cli/console/layout.js";

describe("console layout helpers", () => {
  it("measures visible width without ANSI escapes", () => {
    expect(visibleLength("\x1b[32mhello\x1b[0m")).toBe(5);
  });

  it("treats wide glyphs as terminal cell width", () => {
    expect(visibleLength("e\u0301界🙂")).toBe(5);
  });

  it("clips ANSI-colored wide text without leaving width drift", () => {
    const clipped = clip("\x1b[32m界界界\x1b[0m", 5);
    expect(stripAnsi(clipped)).toBe("界界…");
    expect(visibleLength(clipped)).toBe(5);
  });

  it("fits mixed-width text to an exact terminal width", () => {
    const fitted = fit("界", 4);
    expect(stripAnsi(fitted)).toBe("界  ");
    expect(visibleLength(fitted)).toBe(4);
  });

  it("normalizes split panes to stable heights and widths", () => {
    const lines = zipPanes(["界", "abc"], ["right", "🙂"], 4, 5, 3);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(visibleLength(line)).toBe(10);
    }
    expect(stripAnsi(lines[2])).toBe("    │     ");
  });
});
