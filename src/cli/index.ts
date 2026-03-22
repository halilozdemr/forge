import "dotenv/config";
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";
import { statusCommand } from "./commands/status.js";
import { agentCommand } from "./commands/agent.js";
import { issueCommand } from "./commands/issue.js";
import { sprintCommand } from "./commands/sprint.js";
import { budgetCommand } from "./commands/budget.js";
import { heartbeatCommand } from "./commands/heartbeat.js";
import { companyCommand } from "./commands/company.js";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { queueCommand } from "./commands/queue.js";
import { goalCommand } from "./commands/goal.js";
import { secretCommand } from "./commands/secret.js";
import { approvalCommand } from "./commands/approval.js";
import { labelCommand } from "./commands/label.js";
import { exportCommand } from "./commands/export.js";
import { importCommand } from "./commands/import.js";

const program = new Command("forge");

program
  .name("forge")
  .description("Forge — AI agent orchestration platform")
  .version("3.0.0");

program.addCommand(initCommand());
program.addCommand(startCommand());
program.addCommand(stopCommand());
program.addCommand(statusCommand());
program.addCommand(agentCommand());
program.addCommand(issueCommand());
program.addCommand(sprintCommand());
program.addCommand(budgetCommand());
program.addCommand(heartbeatCommand());
program.addCommand(companyCommand());
program.addCommand(loginCommand());
program.addCommand(logoutCommand());
program.addCommand(queueCommand());
program.addCommand(goalCommand());
program.addCommand(secretCommand());
program.addCommand(approvalCommand());
program.addCommand(labelCommand());
program.addCommand(exportCommand());
program.addCommand(importCommand());

program.parse(process.argv);
