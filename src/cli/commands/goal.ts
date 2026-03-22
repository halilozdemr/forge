import { Command } from "commander";
import { resolveCompany } from "../../utils/company.js";

export function goalCommand(): Command {
  const cmd = new Command("goal").description("Manage goals hierarchy");

  cmd
    .command("create")
    .description("Create a new goal")
    .option("--company <id>", "Company ID")
    .requiredOption("--title <title>", "Goal title")
    .option("--description <desc>", "Goal description")
    .option("--level <level>", "Goal level (company | team | agent | task)", "task")
    .option("--parent <id>", "Parent goal ID")
    .option("--owner <slug>", "Owner agent slug")
    .action(async (opts) => {
      const companyId = await resolveCompany(opts.company);
      const { getDb } = await import("../../db/client.js");
      const db = getDb();

      const goal = await db.goal.create({
        data: {
          companyId,
          title: opts.title,
          description: opts.description,
          level: opts.level,
          parentId: opts.parent,
          ownerAgentSlug: opts.owner
        }
      });
      console.log(`Goal created: ${goal.id} (${goal.title})`);
    });

  cmd
    .command("list")
    .description("List goals")
    .option("--company <id>", "Company ID")
    .option("--level <level>", "Filter by level")
    .action(async (opts) => {
      const companyId = await resolveCompany(opts.company);
      const { getDb } = await import("../../db/client.js");
      const db = getDb();

      const goals = await db.goal.findMany({
        where: { companyId, level: opts.level },
        orderBy: { createdAt: "desc" }
      });

      console.log(`\nGoals\n${"─".repeat(50)}`);
      if (!goals.length) console.log("No goals found.");
      for (const g of goals) {
        console.log(`[${g.level.toUpperCase()}] ${g.id}: ${g.title}`);
        if (g.description) console.log(`  ${g.description}`);
      }
      console.log();
    });

  cmd
    .command("link <issueId>")
    .description("Link an issue to a goal")
    .option("--company <id>", "Company ID")
    .requiredOption("--goal <goalId>", "Goal ID")
    .action(async (issueId, opts) => {
      const companyId = await resolveCompany(opts.company); // ensures context is correct
      const { getDb } = await import("../../db/client.js");
      const db = getDb();

      const goal = await db.goal.findUnique({ where: { id: opts.goal } });
      if (!goal) {
        throw new Error(`Goal ${opts.goal} not found.`);
      }

      if (goal.companyId !== companyId) {
         throw new Error(`Goal does not belong to the resolved company.`);
      }

      const issue = await db.issue.findUnique({ where: { id: issueId }, include: { project: true } });
      if (!issue) {
         throw new Error(`Issue ${issueId} not found.`);
      }
      if (issue.project.companyId !== companyId) {
         throw new Error(`Issue does not belong to the resolved company.`);
      }

      const updated = await db.issue.update({
        where: { id: issueId },
        data: { goalId: opts.goal }
      });
      console.log(`Issue ${updated.id} linked to goal ${opts.goal}.`);
    });

  return cmd;
}
