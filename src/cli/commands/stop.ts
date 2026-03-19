import { Command } from "commander";
import { readPidFile, isProcessRunning, removePidFile } from "../../utils/process.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("stop");

export function stopCommand(): Command {
  return new Command("stop")
    .description("Stop the running Forge server")
    .action(runStop);
}

async function runStop(): Promise<void> {
  const pid = readPidFile();

  if (!pid) {
    console.log("Forge is not running (no PID file found).");
    return;
  }

  if (!isProcessRunning(pid)) {
    console.log(`Forge process (PID ${pid}) is not running. Cleaning up stale PID file.`);
    removePidFile();
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    console.log(`Sent SIGTERM to Forge process (PID ${pid}). Shutting down gracefully...`);

    // Wait up to 5s for process to exit
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (!isProcessRunning(pid)) {
        console.log("Forge stopped.");
        return;
      }
    }

    // Force kill if still running
    process.kill(pid, "SIGKILL");
    removePidFile();
    console.log("Forge force-killed.");
  } catch (err) {
    log.error({ err }, "Failed to stop Forge");
    removePidFile();
  }
}
