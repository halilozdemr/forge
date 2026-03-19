import { createChildLogger } from "../utils/logger.js";
import { getDb } from "../db/client.js";

const log = createChildLogger("skill-engine");

export class SkillEngine {
  /**
   * Select the best skill for a given task based on success rate.
   * Falls back to null if no matching skill found.
   */
  async selectSkill(companyId: string, taskHint: string): Promise<{ id: string; name: string; content: string } | null> {
    const db = getDb();
    const skills = await db.skill.findMany({
      where: { companyId, active: true },
      include: {
        executions: {
          select: { result: true },
        },
      },
    });

    if (!skills.length) return null;

    // Score skills by success rate, prefer relevant ones
    const scored = skills.map((skill) => {
      const total = skill.executions.length;
      const successes = skill.executions.filter((e) => e.result === "success").length;
      const successRate = total > 0 ? successes / total : 0.5; // default 50% for new skills

      // Keyword relevance
      const hint = taskHint.toLowerCase();
      const nameMatch = skill.name.toLowerCase().split(/[_-]/).some((w) => hint.includes(w));
      const relevance = nameMatch ? 0.3 : 0;

      return { skill, score: successRate + relevance };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    if (best.score < 0.2) {
      log.debug({ companyId, taskHint }, "No high-confidence skill found");
      return null;
    }

    return { id: best.skill.id, name: best.skill.name, content: best.skill.content };
  }

  /**
   * Record the result of a skill execution.
   */
  async recordExecution(opts: {
    skillId: string;
    issueId: string;
    result: "success" | "failed" | "timeout";
    errorMessage?: string;
    durationMs: number;
  }): Promise<void> {
    const db = getDb();
    await db.skillExecution.create({
      data: {
        skillId: opts.skillId,
        issueId: opts.issueId,
        result: opts.result,
        errorMessage: opts.errorMessage ?? null,
        durationMs: opts.durationMs,
      },
    });
  }

  /**
   * Analyze failure patterns and flag skills that need improvement.
   * Returns skills with failure rate >= threshold.
   */
  async analyzeFailures(companyId: string, threshold = 0.3): Promise<Array<{ skillId: string; name: string; failureRate: number }>> {
    const db = getDb();
    const skills = await db.skill.findMany({
      where: { companyId, active: true },
      include: { executions: { select: { result: true } } },
    });

    const flagged: Array<{ skillId: string; name: string; failureRate: number }> = [];

    for (const skill of skills) {
      const total = skill.executions.length;
      if (total < 3) continue; // not enough data

      const failures = skill.executions.filter((e) => e.result !== "success").length;
      const failureRate = failures / total;

      if (failureRate >= threshold) {
        flagged.push({ skillId: skill.id, name: skill.name, failureRate });
        log.warn({ skillId: skill.id, name: skill.name, failureRate }, "Skill flagged for improvement");
      }
    }

    return flagged;
  }

  /**
   * Update skill content (increments version).
   */
  async updateSkillContent(skillId: string, newContent: string): Promise<void> {
    const db = getDb();
    await db.skill.update({
      where: { id: skillId },
      data: {
        content: newContent,
        version: { increment: 1 },
      },
    });
    log.info({ skillId }, "Skill content updated");
  }
}
