import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "../cli/commands/run.js";

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.addCommand(runCommand());
  return program;
}

function successfulIntakeResponse() {
  return {
    issueId: "issue-1",
    pipelineRunId: "pipeline-1",
    status: "queued",
    entryAgentSlug: "intake-gate",
    queuedStepKeys: ["intake-gate", "architect"],
  };
}

describe("runCommand", () => {
  const originalFetch = global.fetch;
  const originalLog = console.log;
  const originalError = console.error;

  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => successfulIntakeResponse(),
    } as Response);
    console.log = vi.fn();
    console.error = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
  });

  it("submits feature by default when --type is omitted", async () => {
    const program = createProgram();
    await program.parseAsync(["run", "add login page", "--mode", "fast"], { from: "user" });

    const [url, options] = (global.fetch as any).mock.calls[0] as [string, RequestInit];
    expect(url.endsWith("/v1/intake/requests")).toBe(true);
    const payload = JSON.parse(String(options.body));
    expect(payload.type).toBe("feature");
    expect(payload.title).toBe("add login page");
    expect(payload.description).toBe("add login page");
    expect(payload.executionMode).toBe("fast");
  });

  it("supports bug type submissions", async () => {
    const program = createProgram();
    await program.parseAsync(["run", "fix crash", "--type", "bug", "--mode", "fast"], { from: "user" });

    const [, options] = (global.fetch as any).mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(options.body));
    expect(payload.type).toBe("bug");
    expect(payload.title).toBe("fix crash");
  });

  it("supports refactor with structured mode", async () => {
    const program = createProgram();
    await program.parseAsync(
      ["run", "cleanup auth", "--type", "refactor", "--mode", "structured"],
      { from: "user" },
    );

    const [, options] = (global.fetch as any).mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(options.body));
    expect(payload.type).toBe("refactor");
    expect(payload.executionMode).toBe("structured");
  });
});
