import { PrismaClient, Prisma } from "@prisma/client";
import { createChildLogger } from "../utils/logger.js";

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
