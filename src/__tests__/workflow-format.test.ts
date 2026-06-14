import { describe, it, expect } from "vitest";
import { progressBar, colorStatus, formatDate } from "../cli/workflow-format.js";

describe("progressBar", () => {
  it("reports no steps when total is zero", () => {
    expect(progressBar(0, 0)).toBe("no steps");
  });

  it("renders a 10-cell bar with count and percentage", () => {
    expect(progressBar(0, 4)).toBe("░░░░░░░░░░ 0/4 (0%)");
    expect(progressBar(2, 4)).toBe("█████░░░░░ 2/4 (50%)");
    expect(progressBar(4, 4)).toBe("██████████ 4/4 (100%)");
  });
});

describe("colorStatus", () => {
  it("pads to the requested width inside the color codes", () => {
    expect(colorStatus("running", 10)).toBe("\x1b[33mrunning   \x1b[0m");
  });

  it("leaves unknown statuses uncolored", () => {
    expect(colorStatus("weird")).toBe("weird\x1b[0m");
  });
});

describe("formatDate", () => {
  it("returns a dash for empty values", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
  });
});
