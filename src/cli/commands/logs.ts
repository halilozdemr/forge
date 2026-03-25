import { Command } from "commander";
import { loadConfig } from "../../utils/config.js";

const AGENT_COLORS: Record<string, string> = {
  "intake-gate":"\x1b[34m",  // blue
  architect:    "\x1b[35m",  // purple
  builder:      "\x1b[32m",  // green
  "quality-guard":"\x1b[33m",// amber
  devops:       "\x1b[36m",  // cyan
  "retrospective-analyst":"\x1b[90m", // gray
};

const RESET = "\x1b[0m";
const DIM   = "\x1b[2m";
const BOLD  = "\x1b[1m";

function agentColor(slug: string): string {
  return AGENT_COLORS[slug] ?? "\x1b[37m";
}

function formatTimestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

export function logsCommand(): Command {
  const cmd = new Command("logs")
    .description("Stream live agent logs to the terminal (written to stderr — no Claude token usage)")
    .option("--agent <slug>", "Filter by agent slug")
    .option("--port <n>", "Server port (default: from config)")
    .action(async (opts) => {
      const config = loadConfig();
      const port = opts.port ? parseInt(opts.port, 10) : config.port;
      const url = `ws://localhost:${port}/ws`;
      const filter: string | undefined = opts.agent;

      // All output goes to stderr — does not enter Claude Code's token context
      const out = process.stderr;

      out.write(`\n${BOLD}Forge Logs${RESET}  ${DIM}${url}${filter ? `  agent=${filter}` : ""}${RESET}\n`);
      out.write(`${DIM}${"─".repeat(60)}${RESET}\n\n`);

      // Always use 'ws' package for consistent EventEmitter API across all Node.js versions
      // (Native WebSocket in Node 22+ uses browser API with addEventListener, not .on() methods)
      const { default: WS } = await import("ws");
      const ws = new WS(url);

      ws.on("open", () => {
        out.write(`${DIM}Connected. Waiting for agent activity...${RESET}\n\n`);
      });

      ws.on("message", (raw: Buffer | string) => {
        let event: any;
        try {
          event = JSON.parse(raw.toString());
        } catch {
          return;
        }

        if (event.type !== "heartbeat.log") return;

        const { agentSlug, line } = event as { agentSlug: string; line: string };
        if (filter && agentSlug !== filter) return;

        const color = agentColor(agentSlug);
        const ts = formatTimestamp();
        out.write(`${DIM}${ts}${RESET}  ${color}${BOLD}@${agentSlug.padEnd(14)}${RESET}  ${line}\n`);
      });

      ws.on("error", (err: Error) => {
        out.write(`\x1b[31mWebSocket error: ${err.message}\x1b[0m\n`);
        out.write(`${DIM}Is the Forge server running? (forge start)${RESET}\n`);
        process.exit(1);
      });

      ws.on("close", () => {
        out.write(`\n${DIM}Disconnected.${RESET}\n`);
        process.exit(0);
      });

      // Ctrl+C
      process.on("SIGINT", () => {
        ws.close();
        out.write(`\n${DIM}Stopped.${RESET}\n`);
        process.exit(0);
      });
    });

  return cmd;
}
