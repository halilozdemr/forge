import "dotenv/config";
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { doctorCommand } from "./commands/doctor.js";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";
import { statusCommand } from "./commands/status.js";
import { agentCommand } from "./commands/agent.js";
import { issueCommand } from "./commands/issue.js";
import { sprintCommand } from "./commands/sprint.js";
import { budgetCommand } from "./commands/budget.js";
import { heartbeatCommand } from "./commands/heartbeat.js";
import { queueCommand } from "./commands/queue.js";
import { goalCommand } from "./commands/goal.js";
import { secretCommand } from "./commands/secret.js";
import { approvalCommand } from "./commands/approval.js";
import { labelCommand } from "./commands/label.js";
import { exportCommand } from "./commands/export.js";
import { importCommand } from "./commands/import.js";
import { logsCommand } from "./commands/logs.js";
import { workflowCommand } from "./commands/workflow.js";
import { featureCommand } from "./commands/feature.js";
import { bugCommand } from "./commands/bug.js";
import { runCommand } from "./commands/run.js";

const program = new Command("forge");

program
  .name("forge")
  .description("Forge — bootstrap projects and run AI workflows locally")
  .version("3.0.0")
  .addHelpText(
    "after",
    `
Quick start:
  forge init
  forge start
  forge run "add login screen" --type feature
  forge run "fix crash on launch" --type bug --mode fast
`,
  );

program.addCommand(initCommand());
program.addCommand(doctorCommand());
program.addCommand(startCommand());
program.addCommand(stopCommand());
program.addCommand(statusCommand());
program.addCommand(agentCommand());
program.addCommand(issueCommand());
program.addCommand(sprintCommand());
program.addCommand(budgetCommand());
program.addCommand(heartbeatCommand());
program.addCommand(queueCommand());
program.addCommand(goalCommand());
program.addCommand(secretCommand());
program.addCommand(approvalCommand());
program.addCommand(labelCommand());
program.addCommand(exportCommand());
program.addCommand(importCommand());
program.addCommand(logsCommand());
program.addCommand(workflowCommand());
program.addCommand(runCommand());
program.addCommand(featureCommand());
program.addCommand(bugCommand());

program.parse(process.argv);
