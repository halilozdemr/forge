import { Command } from "commander";
import { getDb } from "../../db/client.js";
import AdmZip from "adm-zip";
import fs from "node:fs";

export function importCommand(): Command {
  return new Command("import")
    .description("Import company data from a ZIP file")
    .argument("<file>", "ZIP file to import")
    .option("--company <new-slug>", "Override company slug")
    .action(async (file, opts) => {
      if (!fs.existsSync(file)) {
        console.error(`\x1b[31mError: File ${file} not found\x1b[0m`);
        process.exit(1);
      }

      console.log(`\n📦 Importing from ${file}...`);
      const zip = new AdmZip(file);
      const db = getDb();

      try {
        const getJson = (name: string) => {
          const entry = zip.getEntry(name);
          if (!entry) return null;
          return JSON.parse(entry.getData().toString("utf8"));
        };

        const companyData = getJson("company.json");
        const projectsData = getJson("projects.json");
        const issuesData = getJson("issues.json");
        const sprintsData = getJson("sprints.json");
        const memoryData = getJson("memory.json");
        const activityData = getJson("activity_log.json");

        if (!companyData) throw new Error("Invalid ZIP: company.json missing");

        const originalSlug = companyData.company.slug;
        const newSlug = opts.company || originalSlug;

        console.log(`   Upserting company: ${newSlug}...`);

        // 1. Company
        const company = await db.company.upsert({
          where: { slug: newSlug },
          update: { name: companyData.company.name },
          create: { name: companyData.company.name, slug: newSlug },
        });

        const companyId = company.id;

        // 2. Projects
        const projectIdMap: Record<string, string> = {};
        if (projectsData) {
          for (const p of projectsData) {
            const project = await db.project.upsert({
              where: { companyId_name: { companyId, name: p.name } },
              update: { path: p.path, stack: p.stack, config: p.config, readmePath: p.readmePath },
              create: { companyId, name: p.name, path: p.path, stack: p.stack, config: p.config, readmePath: p.readmePath },
            });
            projectIdMap[p.id] = project.id;
          }
        }

        // 3. Labels
        const labelIdMap: Record<string, string> = {};
        const labelsToProcess = issuesData?.labels || [];
        
        for (const label of labelsToProcess) {
           const l = await db.label.upsert({
             where: { companyId_name: { companyId, name: label.name } },
             update: { color: label.color },
             create: { companyId, name: label.name, color: label.color },
           });
           labelIdMap[label.id] = l.id;
        }

        // 4. Agents
        const agentIdMap: Record<string, string> = {};
        if (companyData.agents) {
          for (const a of companyData.agents) {
            const agent = await db.agent.upsert({
              where: { companyId_slug: { companyId, slug: a.slug } },
              update: {
                name: a.name,
                role: a.role,
                modelProvider: a.modelProvider,
                model: a.model,
                promptFile: a.promptFile,
                reportsTo: a.reportsTo,
                status: a.status,
                permissions: a.permissions,
                adapterConfig: a.adapterConfig,
                maxConcurrent: a.maxConcurrent,
                heartbeatCron: a.heartbeatCron,
              },
              create: {
                companyId,
                slug: a.slug,
                name: a.name,
                role: a.role,
                modelProvider: a.modelProvider,
                model: a.model,
                promptFile: a.promptFile,
                reportsTo: a.reportsTo,
                status: a.status,
                permissions: a.permissions,
                adapterConfig: a.adapterConfig,
                maxConcurrent: a.maxConcurrent,
                heartbeatCron: a.heartbeatCron,
              },
            });
            agentIdMap[a.id] = agent.id;
          }
        }

        // 5. Budget Policies
        if (companyData.budgetPolicies) {
          for (const bp of companyData.budgetPolicies) {
            await db.budgetPolicy.upsert({
              where: { companyId_scope_scopeId: { companyId, scope: bp.scope, scopeId: bp.scopeId } },
              update: { monthlyLimitUsd: bp.monthlyLimitUsd, softLimitPct: bp.softLimitPct, hardLimitPct: bp.hardLimitPct, action: bp.action },
              create: { companyId, scope: bp.scope, scopeId: bp.scopeId, monthlyLimitUsd: bp.monthlyLimitUsd, softLimitPct: bp.softLimitPct, hardLimitPct: bp.hardLimitPct, action: bp.action },
            });
          }
        }

        // 6. Goals
        if (companyData.goals) {
           for (const g of companyData.goals) {
              const existingGoal = await db.goal.findFirst({
                where: { companyId, title: g.title, level: g.level }
              });
              if (!existingGoal) {
                await db.goal.create({
                  data: {
                    companyId,
                    title: g.title,
                    description: g.description,
                    level: g.level,
                    status: g.status,
                    ownerAgentSlug: g.ownerAgentSlug,
                  }
                });
              }
           }
        }

        // 7. Sprints
        const sprintIdMap: Record<string, string> = {};
        if (sprintsData) {
          for (const s of sprintsData) {
            const newProjectId = projectIdMap[s.projectId];
            if (!newProjectId) continue;
            const sprint = await db.sprint.upsert({
              where: { projectId_number: { projectId: newProjectId, number: s.number } },
              update: { goal: s.goal, status: s.status, startedAt: s.startedAt, closedAt: s.closedAt },
              create: { projectId: newProjectId, number: s.number, goal: s.goal, status: s.status, startedAt: s.startedAt, closedAt: s.closedAt },
            });
            sprintIdMap[s.id] = sprint.id;
          }
        }

        // 8. Issues
        const issuesToProcess = issuesData?.issues || [];
        if (issuesToProcess) {
          for (const i of issuesToProcess) {
            const newProjectId = projectIdMap[i.projectId];
            if (!newProjectId) continue;

            const existingIssue = await db.issue.findFirst({
              where: { projectId: newProjectId, title: i.title }
            });

            if (existingIssue) continue; // Skip existing issues to avoid duplicates

            const issue = await db.issue.create({
              data: {
                projectId: newProjectId,
                sprintId: i.sprintId ? sprintIdMap[i.sprintId] : null,
                title: i.title,
                description: i.description,
                type: i.type,
                status: i.status,
                priority: i.priority,
                assignedAgentId: i.assignedAgentId ? agentIdMap[i.assignedAgentId] : null,
                result: i.result,
                metadata: i.metadata,
                createdAt: new Date(i.createdAt),
              }
            });

            // Comments
            if (i.comments) {
              for (const c of i.comments) {
                await db.issueComment.create({
                  data: {
                    issueId: issue.id,
                    authorSlug: c.authorSlug,
                    content: c.content,
                    createdAt: new Date(c.createdAt),
                  }
                });
              }
            }

            // Work Products
            if (i.workProducts) {
              for (const wp of i.workProducts) {
                await db.issueWorkProduct.create({
                  data: {
                    issueId: issue.id,
                    agentSlug: wp.agentSlug,
                    type: wp.type,
                    title: wp.title,
                    content: wp.content,
                    filePath: wp.filePath,
                    createdAt: new Date(wp.createdAt),
                  }
                });
              }
            }

            // Labels
            if (i.issueLabels) {
              for (const il of i.issueLabels) {
                const newLabelId = labelIdMap[il.labelId];
                if (newLabelId) {
                  await db.issueLabel.create({
                    data: {
                      issueId: issue.id,
                      labelId: newLabelId,
                    }
                  });
                }
              }
            }
          }
        }

        // 9. Memory
        if (memoryData) {
          for (const m of memoryData) {
            const existing = await db.memoryEntry.findFirst({
              where: { companyId, content: m.content, type: m.type }
            });
            if (!existing) {
              await db.memoryEntry.create({
                data: {
                  companyId,
                  type: m.type,
                  content: m.content,
                  source: m.source,
                  createdAt: new Date(m.createdAt),
                }
              });
            }
          }
        }

        // 10. Activity Log
        if (activityData) {
          for (const a of activityData) {
             // We don't usually deduplicate logs, just import them
             await db.activityLog.create({
               data: {
                 companyId,
                 actor: a.actor,
                 action: a.action,
                 resource: a.resource,
                 metadata: a.metadata,
                 createdAt: new Date(a.createdAt),
               }
             });
          }
        }

        console.log(`\n\x1b[32m✔ Import complete!\x1b[0m`);
        console.log(`\x1b[33m⚠ IMPORTANT: Secrets were not imported. Please re-add them manually using 'forge secret set'.\x1b[0m`);

      } catch (err: any) {
        console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
        process.exit(1);
      }
    });
}
