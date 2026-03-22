import { Command } from "commander";
import { resolveCompany } from "../../utils/company.js";

export function queueCommand(): Command {
  const cmd = new Command("queue").description("Manage execution queue");

  cmd
    .command("status")
    .description("View queue status or specific job")
    .option("--company <id>", "Company ID")
    .option("--job <id>", "Job ID to view details")
    .action(async (opts) => {
      const companyId = await resolveCompany(opts.company);
      
      const { getDb } = await import("../../db/client.js");
      const db = getDb();

      if (opts.job) {
        const job = await db.queueJob.findUnique({ where: { id: opts.job } });
        if (!job) {
           console.log(`Job ${opts.job} not found.`);
           return;
        }
        console.log(`\nJob details for ${job.id}`);
        console.log(`───────────────────────────────`);
        console.log(`Agent:      ${job.agentSlug}`);
        console.log(`Issue:      ${job.issueId || "—"}`);
        console.log(`Status:     ${job.status}`);
        const duration = job.completedAt && job.startedAt ? Math.round((job.completedAt.getTime() - job.startedAt.getTime()) / 1000) + "s" : "—";
        console.log(`Duration:   ${duration}`);
        console.log(`Queued:     ${job.queuedAt.toLocaleString()}`);
        console.log(`Attempts:   ${job.attempts} / ${job.maxAttempts}`);
        if (job.error) {
           console.log(`\n\x1b[31mError:\x1b[0m\n${job.error}`);
        }
        if (job.result) {
           try {
             console.log(`\n\x1b[32mResult:\x1b[0m\n${JSON.parse(job.result).output || job.result}`);
           } catch {
             console.log(`\n\x1b[32mResult:\x1b[0m\n${job.result}`);
           }
        }
        console.log();
        return;
      }

      const jobs = await db.queueJob.findMany({
        where: { companyId },
        orderBy: { queuedAt: "desc" },
        take: 20
      });

      console.log("\nQueue Status");
      console.log("───────────────────────────────");
      console.log("ID".substring(0, 8).padEnd(12) + "Agent".padEnd(15) + "Issue".padEnd(12) + "Status".padEnd(12) + "Duration");
      
      for (const job of jobs) {
         let duration = "—";
         if (job.startedAt) {
            const end = job.completedAt || new Date();
            const durS = Math.round((end.getTime() - job.startedAt.getTime())/1000);
            const m = Math.floor(durS / 60);
            const s = durS % 60;
            duration = m > 0 ? `${m}m ${s}s` : `${s}s`;
         }

         const idStr = job.id.slice(0, 8);
         const issueStr = job.issueId ? job.issueId.slice(0, 8) : "—";
         
         const statusStr = job.status === "running" ? `\x1b[33m${job.status.padEnd(10)}\x1b[0m`
           : job.status === "completed" ? `\x1b[32m${job.status.padEnd(10)}\x1b[0m`
           : job.status === "failed" ? `\x1b[31m${job.status.padEnd(10)}\x1b[0m`
           : job.status.padEnd(10);

         console.log(
           idStr.padEnd(12) + 
           job.agentSlug.substring(0, 13).padEnd(15) + 
           issueStr.padEnd(12) + 
           statusStr + 
           "  " + duration
         );
      }
      console.log();
    });

  return cmd;
}
