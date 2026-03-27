import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";
import { PipelineDispatcher } from "../../orchestrator/dispatcher.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("harness-api");

type DecideBody = {
  action: "approve_continue" | "approve_with_notes" | "reject_and_retry";
  notes?: string;
  feedback?: Array<{ criterionId: string; reason: string }>;
  actorId?: string;
};

const VALID_ACTIONS: DecideBody["action"][] = [
  "approve_continue",
  "approve_with_notes",
  "reject_and_retry",
];

export async function harnessRoutes(server: FastifyInstance) {
  const db = getDb();
  const dispatcher = new PipelineDispatcher(db);

  /**
   * POST /v1/pipelines/:pipelineRunId/sprints/:sprintNumber/decide
   *
   * Apply a human approval decision to a harness sprint that is in
   * approval_pending state. The dispatcher handles all state transitions
   * and re-queueing.
   *
   * Body:
   *   action          "approve_continue" | "approve_with_notes" | "reject_and_retry"
   *   notes?          string — required for approve_with_notes
   *   feedback?       { criterionId, reason }[] — for reject_and_retry
   *   actorId?        string — defaults to "user"
   *
   * Note: skip_criterion is not yet supported. It requires a schema migration
   * to add a skippedCriteria field to SprintRun for safe persistence.
   */
  server.post<{
    Params: { pipelineRunId: string; sprintNumber: string };
    Body: DecideBody;
  }>("/pipelines/:pipelineRunId/sprints/:sprintNumber/decide", async (request, reply) => {
    const { pipelineRunId, sprintNumber: sprintNumberStr } = request.params;
    const { action, notes, feedback, actorId } = request.body ?? {};

    const sprintNumber = parseInt(sprintNumberStr, 10);
    if (isNaN(sprintNumber) || sprintNumber < 1) {
      return reply.code(400).send({ error: "Invalid sprint number" });
    }

    if (!action || !VALID_ACTIONS.includes(action)) {
      return reply
        .code(400)
        .send({ error: `action must be one of: ${VALID_ACTIONS.join(", ")}` });
    }

    if (action === "approve_with_notes" && !notes) {
      return reply.code(400).send({ error: "notes is required for approve_with_notes" });
    }

    try {
      await dispatcher.handleHarnessApprovalDecision(pipelineRunId, sprintNumber, action, {
        notes,
        feedback,
        actorId,
      });
      return { message: "Decision applied successfully", pipelineRunId, sprintNumber, action };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ pipelineRunId, sprintNumber, action, error: message }, "Harness approval decision failed");

      const isClientError =
        message.includes("not found") ||
        message.includes("not in approval_pending") ||
        message.includes("exhausted build attempts") ||
        message.includes("not a harness pipeline");

      return reply.code(isClientError ? 400 : 500).send({ error: message });
    }
  });
}
