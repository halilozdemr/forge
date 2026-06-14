import { loadConfig } from "../utils/config.js";
import { BOLD, RESET, colorStatus, progressBar } from "./workflow-format.js";

const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);

function baseUrl(): string {
  return `http://localhost:${loadConfig().port}`;
}

async function fetchWorkflow(id: string): Promise<any> {
  const res = await fetch(`${baseUrl()}/v1/workflows/${id}`);
  if (!res.ok) {
    const err = (await res.json()) as { error: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  const { workflow } = (await res.json()) as { workflow: any };
  return workflow;
}

export interface WatchOptions {
  intervalMs?: number;
}

/**
 * Poll a workflow run, printing a line each time its status or current step
 * changes, until it reaches a terminal state. Returns true if it completed
 * successfully, false on failure/cancellation or a fetch error.
 */
export async function watchWorkflow(id: string, opts: WatchOptions = {}): Promise<boolean> {
  const intervalMs = opts.intervalMs ?? 3000;

  console.log(`Watching workflow ${BOLD}${id}${RESET} — press Ctrl+C to stop\n`);

  let lastStatus = "";
  let lastStepKey: string | null = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let w: any;
    try {
      w = await fetchWorkflow(id);
    } catch (err: any) {
      console.error(`\x1b[31mError: ${err.message}${RESET}`);
      return false;
    }

    if (w.status !== lastStatus || w.currentStepKey !== lastStepKey) {
      const ts = new Date().toLocaleTimeString();
      const progress = progressBar(w.progress.completed, w.progress.total);
      console.log(
        `[${ts}] ${colorStatus(w.status, 20)} step: ${(w.currentStepKey ?? "—").padEnd(20)} ${progress}`,
      );
      lastStatus = w.status;
      lastStepKey = w.currentStepKey ?? null;
    }

    if (TERMINAL_STATES.has(w.status)) {
      console.log(`\nWorkflow ${w.status.toUpperCase()}.`);
      if (w.lastError) console.log(`\x1b[31mError: ${w.lastError}${RESET}`);
      return w.status === "completed";
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
