import { Command } from "commander";
import { join } from "path";
import { homedir } from "os";
import { unlinkSync, existsSync } from "fs";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("logout");

export function logoutCommand(): Command {
  return new Command("logout")
    .description("Logout from Forge Cloud")
    .action(() => {
      const p = join(homedir(), ".forge", "credentials.json");
      if (existsSync(p)) {
        unlinkSync(p);
        log.info("Logged out successfully");
      } else {
        log.info("Not logged in");
      }
    });
}
