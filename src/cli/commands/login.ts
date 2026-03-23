import { Command } from "commander";
import fastify from "fastify";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createChildLogger } from "../../utils/logger.js";
import { exec } from "child_process";

const log = createChildLogger("login");

export function loginCommand(): Command {
  return new Command("login")
    .description("Login to Forge Cloud")
    .option("--cloud-url <url>", "Forge Cloud URL")
    .action(runLogin);
}

async function runLogin(opts: { cloudUrl?: string }) {
  const cloudUrl = opts.cloudUrl || process.env.FORGE_CLOUD_URL || "http://localhost:4000";
  const port = Math.floor(Math.random() * 100) + 3200; // 3200-3299
  
  const server = fastify();
  
  server.get("/callback", async (request, reply) => {
    const { token } = request.query as { token?: string };
    
    if (!token) {
      return reply.code(400).send("Token required");
    }

    const forgeDir = join(homedir(), ".forge");
    mkdirSync(forgeDir, { recursive: true });
    
    const creds = {
      token,
      cloudUrl,
      savedAt: new Date().toISOString()
    };
    
    writeFileSync(join(forgeDir, "credentials.json"), JSON.stringify(creds, null, 2));
    
    log.info("Login successful. Credentials saved.");
    
    reply.send("Login successful! You can close this tab and return to your terminal.");
    
    setTimeout(() => {
      server.close();
    }, 1000);
  });

  await server.listen({ port, host: "127.0.0.1" });
  
  const callbackUrl = `http://localhost:${port}/callback`;
  const authUrl = `${cloudUrl}/auth/cli?callback=${encodeURIComponent(callbackUrl)}`;
  
  log.info(`Opening browser to: ${authUrl}`);
  log.info(`Waiting for callback on port ${port}...`);
  
  const platform = process.platform;
  let cmd = "";
  if (platform === "win32") cmd = "start";
  else if (platform === "darwin") cmd = "open";
  else cmd = "xdg-open";
  
  exec(`${cmd} "${authUrl}"`).on("error", () => {
    log.error(`Could not open browser. Please visit manually: ${authUrl}`);
  });
}
