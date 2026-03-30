import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("skill-engine");

export class SkillEngine {
  /**
   * Select the best skill for a given task based on success rate.
   * Falls back to null if no matching skill found.
   */
  async selectSkill(companyId: string, taskHint: string): Promise<{ id: string; name: string; content: string } | null> {
    log.debug({ companyId, taskHint }, "skill selection skipped because skill tables were removed");
    return null;
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
    log.debug(
      {
        skillId: opts.skillId,
        issueId: opts.issueId,
        result: opts.result,
        durationMs: opts.durationMs,
      },
      "skill execution tracking skipped because skill tables were removed",
    );
  }

  /**
   * Analyze failure patterns and flag skills that need improvement.
   * Returns skills with failure rate >= threshold.
   */
  async analyzeFailures(companyId: string, threshold = 0.3): Promise<Array<{ skillId: string; name: string; failureRate: number }>> {
    void threshold;
    log.debug({ companyId }, "failure analysis skipped because skill tables were removed");
    return [];
  }

  /**
   * Update skill content (increments version).
   */
  async updateSkillContent(skillId: string, newContent: string): Promise<void> {
    void newContent;
    log.debug({ skillId }, "skill content update skipped because skill tables were removed");
  }
}
