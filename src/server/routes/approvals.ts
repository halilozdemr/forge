import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";
import { createChildLogger } from "../../utils/logger.js";
import { transitionAgent } from "../../agents/lifecycle.js";

const log = createChildLogger("approvals-api");

type MetadataRecord = Record<string, unknown>;

function parseMetadata(raw: string): MetadataRecord {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? parsed as MetadataRecord : {};
  } catch {
    return {};
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function humanizeToken(token: string): string {
  return token
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(text: string): string {
  return text.replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatApprovalReason(reason: string | null): string | null {
  if (!reason) return null;

  switch (reason) {
    case "human_review_required":
      return "Human review required before the workflow can continue.";
    case "not_verifiable_required_machine":
      return "A required machine verification could not be completed automatically.";
    case "build_retry_limit":
      return "The workflow hit its build retry limit and needs an operator decision.";
    case "contract_revision_limit":
      return "The sprint contract exceeded its revision limit and needs human review.";
    case "evaluation_failure":
      return "Evaluation could not safely determine a passing outcome.";
    default:
      return titleCase(humanizeToken(reason));
  }
}

function formatContextValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const rendered = value
      .map((item) => formatContextValue(item))
      .filter((item): item is string => Boolean(item));
    return rendered.length > 0 ? rendered.join(", ") : null;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return null;
}

function formatUsd(value: unknown): string | null {
  const num = asNumber(value);
  return num == null ? null : `$${num.toFixed(2)}`;
}

function formatPercent(value: unknown): string | null {
  const num = asNumber(value);
  return num == null ? null : `${num.toFixed(1)}%`;
}

export function describeApproval(type: string, metadata: Record<string, unknown>): string {
  switch (type) {
    case "hire_agent":
      return `Hire agent "${metadata.slug ?? "?"}" (model: ${metadata.model ?? "unknown"})`;
    case "budget_override":
      return `Budget override for agent "${metadata.agentSlug ?? "?"}"`;
    case "ceo_strategy":
      return `CEO strategy decision required`;
    case "sprint_review":
      return `Sprint ${metadata.sprintNumber ?? "?"} review — ${metadata.approvalReason ?? "decision required"}`;
    default:
      return `Approval of type "${type}"`;
  }
}

function approvalTitle(type: string, metadata: MetadataRecord): string {
  switch (type) {
    case "hire_agent":
      return `Hire @${asString(metadata.slug) ?? "unknown"}`;
    case "budget_override":
      return `Budget override for @${asString(metadata.agentSlug) ?? "unknown"}`;
    case "sprint_review": {
      const sprintNumber = asNumber(metadata.sprintNumber);
      return sprintNumber != null ? `Sprint ${sprintNumber} review` : "Sprint review";
    }
    case "ceo_strategy":
      return "CEO strategy decision";
    default:
      return titleCase(humanizeToken(type));
  }
}

function decisionHint(type: string, metadata: MetadataRecord): string | null {
  switch (type) {
    case "hire_agent":
      return "Approve to create the requested agent and return it to the active roster. Reject to discard the request.";
    case "budget_override": {
      const agentSlug = asString(metadata.agentSlug);
      return agentSlug
        ? `Approve to unpause @${agentSlug} and let work continue. Reject to keep the agent paused at the budget gate.`
        : "Approve to lift the budget gate. Reject to keep the gate in place.";
    }
    case "sprint_review":
      return "Approve to continue the structured workflow. Reject to send the current sprint back for another build attempt.";
    default:
      return "Approve to let the blocked operation continue. Reject to stop it here.";
  }
}

function actionMode(type: string, metadata: MetadataRecord): "approval-route" | "harness-decision" | "none" {
  if (type === "sprint_review") {
    const pipelineRunId = asString(metadata.pipelineRunId);
    const sprintNumber = asNumber(metadata.sprintNumber);
    return pipelineRunId && sprintNumber != null ? "harness-decision" : "none";
  }
  if (type === "hire_agent" || type === "budget_override" || type === "ceo_strategy") {
    return "approval-route";
  }
  return "approval-route";
}

function availableActions(
  type: string,
  status: string,
  metadata: MetadataRecord,
): Array<{ key: string; label: string; description: string }> {
  if (status !== "pending") return [];

  const mode = actionMode(type, metadata);
  if (mode === "none") return [];

  switch (type) {
    case "hire_agent":
      return [
        { key: "a", label: "approve", description: "Create the requested agent and clear the gate." },
        { key: "r", label: "reject", description: "Decline the hire request and keep the agent uncreated." },
      ];
    case "budget_override":
      return [
        { key: "a", label: "approve", description: "Lift the budget gate and unpause the blocked agent." },
        { key: "r", label: "reject", description: "Keep the budget gate closed and the agent paused." },
      ];
    case "sprint_review":
      return [
        { key: "a", label: "approve", description: "Accept the sprint result and continue the workflow." },
        { key: "r", label: "reject", description: "Reject this sprint and send it back for another build attempt." },
      ];
    default:
      return [
        { key: "a", label: "approve", description: "Approve this request." },
        { key: "r", label: "reject", description: "Reject this request." },
      ];
  }
}

function collectContextLines(type: string, metadata: MetadataRecord): Array<{ label: string; value: string }> {
  const lines: Array<{ label: string; value: string }> = [];
  const pushLine = (label: string, value: string | null) => {
    if (value) lines.push({ label, value });
  };

  if (type === "hire_agent") {
    pushLine("agent", asString(metadata.slug));
    pushLine("name", asString(metadata.name));
    pushLine("role", asString(metadata.role));
    pushLine("model", asString(metadata.model));
    pushLine("provider", asString(metadata.modelProvider));
    pushLine("reports to", asString(metadata.reportsTo));
    pushLine("namespace", asString(metadata.namespace));
  } else if (type === "budget_override") {
    pushLine("agent", asString(metadata.agentSlug));
    pushLine("usage", formatUsd(metadata.currentUsageUsd));
    pushLine("limit", formatUsd(metadata.limitUsd));
    pushLine("percent", formatPercent(metadata.percentUsed));
  } else if (type === "sprint_review") {
    const sprintNumber = asNumber(metadata.sprintNumber);
    pushLine("sprint", sprintNumber != null ? String(sprintNumber) : null);
    pushLine("reason", formatApprovalReason(asString(metadata.approvalReason)));
    pushLine("action", asString(metadata.action) ? titleCase(humanizeToken(asString(metadata.action) ?? "")) : null);
    const retryCount = asNumber(metadata.buildAttemptBeforeRetry);
    pushLine("retry from", retryCount != null ? `build attempt ${retryCount}` : null);
  }

  const consumed = new Set(lines.map((line) => line.label));
  for (const [key, rawValue] of Object.entries(metadata)) {
    const label = humanizeToken(key);
    if (consumed.has(label)) continue;
    if (["pipelineRunId", "approvalReason", "notes", "feedback"].includes(key)) continue;
    const value = formatContextValue(rawValue);
    if (value) lines.push({ label, value });
  }

  return lines;
}

async function serializeApproval(
  db: ReturnType<typeof getDb>,
  approval: {
    id: string;
    companyId: string;
    type: string;
    status: string;
    requestedBy: string;
    metadata: string;
    requestedAt: Date;
    reviewedAt: Date | null;
  },
) {
  const metadata = parseMetadata(approval.metadata);
  const pipelineRunId = asString(metadata.pipelineRunId);
  const sprintNumber = asNumber(metadata.sprintNumber);

  const workflow = pipelineRunId
    ? await db.pipelineRun.findUnique({
        where: { id: pipelineRunId },
        include: {
          issue: { select: { id: true, title: true, type: true, status: true } },
        },
      })
    : null;

  const inferredStepKey =
    asString(metadata.stepKey) ??
    workflow?.currentStepKey ??
    (sprintNumber != null ? `sprint-${sprintNumber}-evaluate` : null);

  const stepRun =
    workflow && inferredStepKey
      ? await db.pipelineStepRun.findUnique({
          where: {
            pipelineRunId_stepKey: {
              pipelineRunId: workflow.id,
              stepKey: inferredStepKey,
            },
          },
          select: { agentSlug: true, status: true },
        })
      : null;

  const description = describeApproval(approval.type, metadata);
  const reason = formatApprovalReason(asString(metadata.approvalReason));
  const note =
    asString(metadata.notes) ??
    (Array.isArray(metadata.feedback) && metadata.feedback.length > 0
      ? `${metadata.feedback.length} feedback item(s) recorded.`
      : null);
  const summary =
    workflow?.issue?.title
      ? `Blocked workflow for "${workflow.issue.title}".`
      : approval.type === "budget_override"
        ? "An agent was paused after hitting the hard budget limit."
        : approval.type === "hire_agent"
          ? "A new agent is waiting for operator approval before it can be created."
          : null;

  return {
    id: approval.id,
    type: approval.type,
    status: approval.status,
    title: approvalTitle(approval.type, metadata),
    description,
    summary,
    requestedBy: approval.requestedBy,
    requestedAt: approval.requestedAt,
    reviewedAt: approval.reviewedAt,
    workflowId: workflow?.id ?? null,
    workflowStatus: workflow?.status ?? null,
    issueTitle: workflow?.issue?.title ?? null,
    stepKey: inferredStepKey,
    agentSlug: stepRun?.agentSlug ?? asString(metadata.agentSlug) ?? asString(metadata.slug),
    reason,
    note,
    decisionHint: decisionHint(approval.type, metadata),
    actionMode: actionMode(approval.type, metadata),
    availableActions: availableActions(approval.type, approval.status, metadata),
    criterion: asString(metadata.criterionId),
    contextLines: collectContextLines(approval.type, metadata),
    workflow: workflow
      ? {
          id: workflow.id,
          status: workflow.status,
          currentStepKey: workflow.currentStepKey,
          entryAgentSlug: workflow.entryAgentSlug,
          sprintNumber,
          stepAgentSlug: stepRun?.agentSlug ?? null,
          stepStatus: stepRun?.status ?? null,
          issue: workflow.issue,
        }
      : null,
  };
}

export async function approvalRoutes(server: FastifyInstance) {
  const db = getDb();

  // GET /v1/approvals/inbox?companyId=&status= — enriched inbox with parsed metadata
  server.get<{ Querystring: { companyId: string; status?: string } }>("/approvals/inbox", async (request, reply) => {
    const { companyId, status } = request.query;

    if (!companyId) return reply.code(400).send({ error: "companyId required" });

    const rows = await db.approval.findMany({
      where: {
        companyId,
        status: status || "pending",
      },
      orderBy: { requestedAt: "asc" },
    });

    const approvals = await Promise.all(rows.map((approval) => serializeApproval(db, approval)));

    return { approvals };
  });

  // GET /v1/approvals?companyId=&status=pending
  server.get<{ Querystring: { companyId: string; status?: string } }>("/approvals", async (request, reply) => {
    const { companyId, status } = request.query;

    if (!companyId) return reply.code(400).send({ error: "companyId required" });

    const approvals = await db.approval.findMany({
      where: {
        companyId,
        status: status || "pending",
      },
      orderBy: { requestedAt: "desc" },
    });

    return {
      approvals: await Promise.all(approvals.map((approval) => serializeApproval(db, approval))),
    };
  });

  // GET /v1/approvals/:id — approval detail with workflow context and action hints
  server.get<{ Params: { id: string } }>("/approvals/:id", async (request, reply) => {
    const approval = await db.approval.findUnique({ where: { id: request.params.id } });

    if (!approval) {
      return reply.code(404).send({ error: "Approval not found" });
    }

    return { approval: await serializeApproval(db, approval) };
  });

  // POST /v1/approvals/:id/approve
  server.post<{ Params: { id: string } }>("/approvals/:id/approve", async (request, reply) => {
    const { id } = request.params;

    const approval = await db.approval.findUnique({ where: { id } });

    if (!approval) return reply.code(404).send({ error: "Approval not found" });
    if (approval.status !== "pending") return reply.code(400).send({ error: `Approval is already ${approval.status}` });

    const metadata = JSON.parse(approval.metadata);

    try {
      if (approval.type === "hire_agent") {
        // Create the agent
        const agent = await db.agent.create({
          data: {
            companyId: approval.companyId,
            slug: metadata.slug,
            name: metadata.name,
            role: metadata.role || metadata.name,
            modelProvider: metadata.modelProvider || "claude-cli",
            model: metadata.model,
            reportsTo: metadata.reportsTo || null,
            permissions: JSON.stringify(metadata.permissions || {}),
            heartbeatCron: metadata.heartbeatCron || null,
            status: "idle",
          },
        });

        await db.activityLog.create({
          data: { 
            companyId: approval.companyId, 
            actor: "user", 
            action: "agent.hired", 
            resource: `agent:${metadata.slug}`,
            metadata: JSON.stringify({ approvalId: id })
          },
        });

        log.info({ approvalId: id, agentSlug: metadata.slug }, "Agent hire approved and created");
      } else if (approval.type === "budget_override") {
        // Unpause the agent
        const agentSlug = metadata.agentSlug;
        if (agentSlug) {
          const result = await transitionAgent(db, approval.companyId, agentSlug, "idle");
          if (!result.success) {
            return reply.code(400).send({ error: `Failed to unpause agent: ${result.error}` });
          }
          log.info({ approvalId: id, agentSlug }, "Budget override approved, agent unpaused");
        }
      }

      // Update approval status
      await db.approval.update({
        where: { id },
        data: {
          status: "approved",
          reviewedAt: new Date(),
        },
      });

      return { message: "Approved successfully" };
    } catch (error: any) {
      log.error({ approvalId: id, error: error.message }, "Failed to process approval");
      return reply.code(500).send({ error: `Failed to process approval: ${error.message}` });
    }
  });

  // POST /v1/approvals/:id/reject
  server.post<{ Params: { id: string }; Body: { reason?: string } }>("/approvals/:id/reject", async (request, reply) => {
    const { id } = request.params;
    const { reason } = request.body;

    const approval = await db.approval.findUnique({ where: { id } });

    if (!approval) return reply.code(404).send({ error: "Approval not found" });
    if (approval.status !== "pending") return reply.code(400).send({ error: `Approval is already ${approval.status}` });

    await db.approval.update({
      where: { id },
      data: {
        status: "rejected",
        reviewedAt: new Date(),
      },
    });

    log.info({ approvalId: id, reason }, "Approval rejected");

    return { message: "Rejected successfully" };
  });
}
