import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { createChildLogger } from "./logger.js";

const log = createChildLogger("process");

const PID_FILE = join(process.cwd(), ".firm", ".pid");

export function writePidFile(): void {
  try {
    writeFileSync(PID_FILE, String(process.pid));
    log.debug(`PID file written: ${PID_FILE}`);
  } catch {
    // .firm dir may not exist yet
  }
}

export function readPidFile(): number | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export function removePidFile(): void {
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function setupGracefulShutdown(cleanup: () => Promise<void>): void {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} received, shutting down gracefully...`);
    try {
      await cleanup();
    } catch (err) {
      log.error({ err }, "Error during shutdown");
    }
    removePidFile();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
