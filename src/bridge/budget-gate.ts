import { PrismaClient, Prisma } from "@prisma/client";
import { createChildLogger } from "../utils/logger.js";
import { emit } from "../events/emitter.js";


const log = createChildLogger("budget-gate");

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  percentUsed: number;
  currentUsageUsd: number;
  limitUsd: number;
}

export class BudgetGate {
  constructor(private db: PrismaClient) {}

  async check(companyId: string, agentSlug?: string): Promise<BudgetCheckResult> {
    // Find applicable policy (agent-level overrides company-level)
    let policy = agentSlug
      ? await this.db.budgetPolicy.findUnique({
          where: {
            companyId_scope_scopeId: {
              companyId,
              scope: "agent",
              scopeId: agentSlug,
            },
          },
        })
      : null;

    if (!policy) {
      policy = await this.db.budgetPolicy.findFirst({
        where: { companyId, scope: "company", scopeId: null },
      });
    }

    // No policy = unlimited
    if (!policy) {
      return { allowed: true, percentUsed: 0, currentUsageUsd: 0, limitUsd: 0 };
    }

    // Calculate current month usage
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const where: Prisma.CostEventWhereInput = {
      companyId,
      createdAt: { gte: monthStart },
    };

    // If checking agent-specific, filter by agent
    if (agentSlug && policy.scope === "agent") {
      const agent = await this.db.agent.findUnique({
        where: { companyId_slug: { companyId, slug: agentSlug } },
      });
      if (agent) {
        where.agentId = agent.id;
      }
    }

    const usage = await this.db.costEvent.aggregate({
      where,
      _sum: { costUsd: true },
    });

    const currentUsageUsd = Number(usage._sum.costUsd || 0);
    const limitUsd = Number(policy.monthlyLimitUsd);
    const percentUsed = limitUsd > 0 ? (currentUsageUsd / limitUsd) * 100 : 0;

    // Hard limit check
    if (percentUsed >= policy.hardLimitPct) {
      log.warn({ companyId, agentSlug, percentUsed, limitUsd }, "Budget hard limit reached — BLOCKED");
      emit({ type: "budget.threshold", scope: policy.scope, percent: percentUsed });


      // Create approval if it's an agent-specific check
      if (agentSlug) {
        // Pause the agent
        try {
          const agent = await this.db.agent.findUnique({
            where: { companyId_slug: { companyId, slug: agentSlug } },
          });

          if (agent && agent.status !== "paused") {
            await this.db.agent.update({
              where: { id: agent.id },
              data: { status: "paused" },
            });

            await this.db.approval.create({
              data: {
                companyId,
                type: "budget_override",
                status: "pending",
                requestedBy: agentSlug,
                metadata: JSON.stringify({
                  agentSlug,
                  percentUsed,
                  currentUsageUsd,
                  limitUsd,
                }),
              },
            });

            log.info({ companyId, agentSlug }, "Agent paused and budget_override approval created");
          }
        } catch (error: any) {
          log.error({ companyId, agentSlug, error: error.message }, "Failed to pause agent or create approval");
        }
      }

      return {
        allowed: false,
        reason: `Budget hard limit reached (${percentUsed.toFixed(1)}% of $${limitUsd})`,
        percentUsed,
        currentUsageUsd,
        limitUsd,
      };
    }

    // Soft limit warning
    if (percentUsed >= policy.softLimitPct) {
      log.warn({ companyId, agentSlug, percentUsed, limitUsd }, "Budget soft limit reached — WARNING");
    }

    return { allowed: true, percentUsed, currentUsageUsd, limitUsd };
  }
}
