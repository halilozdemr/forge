/**
 * Forge V2.1 – Harness artifact extraction, validation, and persistence helpers.
 *
 * Consumed only by the dispatcher's handleStepSuccess path for harness pipeline runs.
 * No side effects, no dispatcher logic, no sprint outcome transitions.
 */

import type { PrismaClient } from "@prisma/client";
import { ARTIFACT_SCHEMAS, type ArtifactType, type ProductSpec, type SprintContract, type BuildResult } from "./artifacts.js";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("harness-artifacts");

/** Schema version tag written to IssueWorkProduct.schemaVersion for all V2.1 artifacts. */
export const HARNESS_SCHEMA_VERSION = "v2.1";

// ---------------------------------------------------------------------------
// Step key → artifact type mapping
// ---------------------------------------------------------------------------

/**
 * Ordered mapping of harness step key patterns to their expected artifact type.
 * sprint-N-contract-review is intentionally absent — it produces no typed artifact.
 */
const STEP_ARTIFACT_ENTRIES: Array<[string | RegExp, ArtifactType]> = [
  ["planner",               "ProductSpec"],
  [/^sprint-\d+-contract$/, "SprintContract"],
  [/^sprint-\d+-build$/,    "BuildResult"],
  [/^sprint-\d+-evaluate$/, "EvaluationReport"],
];

/**
 * Returns the ArtifactType expected from a harness step key, or null for steps
 * that do not emit a typed artifact (e.g. sprint-N-contract-review).
 */
export function getHarnessArtifactType(stepKey: string): ArtifactType | null {
  for (const [pattern, type] of STEP_ARTIFACT_ENTRIES) {
    const matches = typeof pattern === "string" ? stepKey === pattern : pattern.test(stepKey);
    if (matches) return type;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Scans agent output backwards for the last JSON object that contains a top-level
 * `artifactType` string field. Returns the parsed object, or null if none found.
 *
 * Output format assumption: the agent emits a JSON object somewhere in its output
 * with `artifactType` as a top-level discriminant field. We pick the LAST occurrence
 * to be resilient to agents emitting partial or exploratory JSON earlier in their output.
 * This mirrors the existing parseReviewerDecision strategy in dispatcher.ts.
 */
export function extractStructuredArtifact(output: string): Record<string, unknown> | null {
  let searchEnd = output.length;

  while (searchEnd > 0) {
    const lastBrace = output.lastIndexOf("{", searchEnd - 1);
    if (lastBrace === -1) return null;

    try {
      // Walk forward to find the matching closing brace
      let depth = 0;
      let end = -1;
      for (let i = lastBrace; i < output.length; i++) {
        if (output[i] === "{") depth++;
        else if (output[i] === "}") {
          depth--;
          if (depth === 0) { end = i; break; }
        }
      }

      if (end !== -1) {
        const parsed = JSON.parse(output.slice(lastBrace, end + 1)) as Record<string, unknown>;
        if (typeof parsed.artifactType === "string") {
          return parsed;
        }
      }
    } catch {
      // Not valid JSON at this position — continue scanning backwards
    }

    searchEnd = lastBrace;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Validation + persistence
// ---------------------------------------------------------------------------

/**
 * Validates the extracted payload against the registered Zod schema for the given
 * artifact type, then persists a new IssueWorkProduct row with all harness artifact
 * fields set. Existing work product creation in worker.ts is unaffected.
 *
 * Throws on validation failure — harness artifact errors are never silently swallowed.
 *
 * @returns The created IssueWorkProduct.id (used as artifact reference in SprintRun).
 */
export async function validateAndStoreArtifact(
  db: PrismaClient,
  opts: {
    artifactType: ArtifactType;
    payload: Record<string, unknown>;
    issueId: string;
    agentSlug: string;
    pipelineRunId: string;
    pipelineStepRunId: string;
    stepKey: string;
  },
): Promise<string> {
  const schema = ARTIFACT_SCHEMAS[opts.artifactType];
  const result = schema.safeParse(opts.payload);

  if (!result.success) {
    const summary = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(
      `Harness artifact validation failed for step "${opts.stepKey}" (expected ${opts.artifactType}): ${summary}`,
    );
  }

  const serialized = JSON.stringify(result.data);

  const workProduct = await db.issueWorkProduct.create({
    data: {
      issueId: opts.issueId,
      agentSlug: opts.agentSlug,
      type: "analysis",          // existing type column — "analysis" is closest for structured output
      title: `${opts.artifactType} — ${opts.stepKey}`,
      content: serialized,       // existing content column — stores the normalized JSON
      pipelineRunId: opts.pipelineRunId,
      pipelineStepRunId: opts.pipelineStepRunId,
      artifactType: opts.artifactType,
      structuredPayload: serialized,
      schemaVersion: HARNESS_SCHEMA_VERSION,
    },
  });

  log.info(
    { stepKey: opts.stepKey, artifactType: opts.artifactType, workProductId: workProduct.id },
    "Harness artifact validated and stored",
  );

  return workProduct.id;
}

// ---------------------------------------------------------------------------
// Harness context assembly (Step 7)
// ---------------------------------------------------------------------------

/**
 * Assembles structured context for a harness pipeline step from persisted typed
 * artifacts. Replaces the V1 resultSummary injection for harness pipeline runs.
 *
 * Per §8 of the architecture decision:
 *   - planner         → raw inputSnapshot only (no prior artifacts)
 *   - sprint-N-contract       → ProductSpec summary + sprint history + inputSnapshot
 *   - sprint-N-contract-review → SprintContract (proposed) + inputSnapshot
 *   - sprint-N-build           → ProductSpec summary + approved SprintContract + sprint history + inputSnapshot
 *   - sprint-N-evaluate        → approved SprintContract + BuildResult + inputSnapshot
 *
 * resultSummary is never read or injected for harness steps. It remains a
 * human-readable log on PipelineStepRun and is never parsed by the harness.
 *
 * Returns a fully assembled input string. Always returns a string (never null).
 */
export async function assembleHarnessStepContext(
  db: PrismaClient,
  opts: {
    pipelineRunId: string;
    stepKey: string;
    inputSnapshot: string | null;
  },
): Promise<string> {
  const { pipelineRunId, stepKey, inputSnapshot } = opts;
  const baseInput = inputSnapshot ?? "";

  // planner: first step in the pipeline — no prior artifacts exist yet.
  if (stepKey === "planner") {
    return baseInput;
  }

  // sprint-N-contract: Builder proposes a SprintContract.
  // Receives: ProductSpec summary (title, summary, constraints, sprint list)
  //           + sprint history + inputSnapshot (may contain revision feedback from loopsBackTo).
  const contractMatch = /^sprint-(\d+)-contract$/.exec(stepKey);
  if (contractMatch) {
    const sprintNumber = parseInt(contractMatch[1], 10);
    const [productSpec, sprintHistory] = await Promise.all([
      fetchLatestArtifactByType<ProductSpec>(db, pipelineRunId, "ProductSpec"),
      fetchSprintHistory(db, pipelineRunId),
    ]);

    const sections: string[] = [];
    if (productSpec) sections.push(formatProductSpecSummary(productSpec));
    sections.push(formatSprintHistory(sprintHistory, sprintNumber));
    sections.push(baseInput);
    return sections.join("\n\n---\n\n");
  }

  // sprint-N-contract-review: Evaluator approves or rejects the proposed SprintContract.
  // Receives: the proposed SprintContract artifact (latest for this sprint) + inputSnapshot.
  const contractReviewMatch = /^sprint-(\d+)-contract-review$/.exec(stepKey);
  if (contractReviewMatch) {
    const sprintNumber = parseInt(contractReviewMatch[1], 10);
    const sprintContract = await fetchLatestSprintStepArtifact<SprintContract>(
      db, pipelineRunId, `sprint-${sprintNumber}-contract`, "SprintContract",
    );

    const sections: string[] = [];
    if (sprintContract) {
      sections.push(`## Proposed SprintContract (Sprint ${sprintNumber})\n\`\`\`json\n${JSON.stringify(sprintContract, null, 2)}\n\`\`\``);
    }
    sections.push(baseInput);
    return sections.join("\n\n---\n\n");
  }

  // sprint-N-build: Builder implements against the approved SprintContract.
  // Receives: ProductSpec summary + approved SprintContract (with contractRef ID) + sprint history + inputSnapshot.
  // The contractRef (IssueWorkProduct.id of the SprintContract) is required by the BuildResult schema.
  const buildMatch = /^sprint-(\d+)-build$/.exec(stepKey);
  if (buildMatch) {
    const sprintNumber = parseInt(buildMatch[1], 10);
    const [productSpec, sprintContractWithId, sprintHistory] = await Promise.all([
      fetchLatestArtifactByType<ProductSpec>(db, pipelineRunId, "ProductSpec"),
      fetchLatestSprintStepArtifactWithId<SprintContract>(db, pipelineRunId, `sprint-${sprintNumber}-contract`, "SprintContract"),
      fetchSprintHistory(db, pipelineRunId),
    ]);

    const sections: string[] = [];
    if (productSpec) sections.push(formatProductSpecSummary(productSpec));
    if (sprintContractWithId) {
      sections.push(
        `## Approved SprintContract (Sprint ${sprintNumber})\n` +
        `Contract Reference ID (copy exactly as \`contractRef\` in your BuildResult): \`${sprintContractWithId.id}\`\n\n` +
        `\`\`\`json\n${JSON.stringify(sprintContractWithId.payload, null, 2)}\n\`\`\``,
      );
    }
    sections.push(formatSprintHistory(sprintHistory, sprintNumber));
    sections.push(baseInput);
    return sections.join("\n\n---\n\n");
  }

  // sprint-N-evaluate: Evaluator verifies the BuildResult against the approved SprintContract.
  // Receives: approved SprintContract (with contractRef ID) + BuildResult + inputSnapshot.
  // Both contractRef and gitRefTested are required fields in EvaluationReport.
  const evaluateMatch = /^sprint-(\d+)-evaluate$/.exec(stepKey);
  if (evaluateMatch) {
    const sprintNumber = parseInt(evaluateMatch[1], 10);
    const [sprintContractWithId, buildResult] = await Promise.all([
      fetchLatestSprintStepArtifactWithId<SprintContract>(db, pipelineRunId, `sprint-${sprintNumber}-contract`, "SprintContract"),
      fetchLatestSprintStepArtifact<BuildResult>(db, pipelineRunId, `sprint-${sprintNumber}-build`, "BuildResult"),
    ]);

    const sections: string[] = [];
    if (sprintContractWithId) {
      sections.push(
        `## Approved SprintContract (Sprint ${sprintNumber}) — The Oracle\n` +
        `Contract Reference ID (copy exactly as \`contractRef\` in your EvaluationReport): \`${sprintContractWithId.id}\`\n\n` +
        `\`\`\`json\n${JSON.stringify(sprintContractWithId.payload, null, 2)}\n\`\`\``,
      );
    }
    if (buildResult) {
      sections.push(formatBuildResultContext(buildResult, sprintNumber));
    }
    sections.push(baseInput);
    return sections.join("\n\n---\n\n");
  }

  // Unknown harness step key — return base input unchanged (no V1 injection).
  log.warn({ pipelineRunId, stepKey }, "assembleHarnessStepContext: unrecognised harness step key — returning baseInput");
  return baseInput;
}

// ---------------------------------------------------------------------------
// Private artifact fetch helpers
// ---------------------------------------------------------------------------

/**
 * Fetches the most recent IssueWorkProduct for a given artifactType across the
 * entire pipeline run. Used for pipeline-scoped artifacts (ProductSpec).
 */
async function fetchLatestArtifactByType<T>(
  db: PrismaClient,
  pipelineRunId: string,
  artifactType: string,
): Promise<T | null> {
  const workProduct = await db.issueWorkProduct.findFirst({
    where: { pipelineRunId, artifactType },
    orderBy: { createdAt: "desc" },
    select: { structuredPayload: true },
  });
  return parseStructuredPayload<T>(workProduct?.structuredPayload ?? null);
}

/**
 * Fetches the most recent IssueWorkProduct for a given stepKey within the pipeline.
 * Used for sprint-scoped artifacts where the same artifactType repeats across sprints.
 * Resolved by PipelineStepRun.id rather than artifactType alone to correctly scope
 * artifacts to a specific sprint even in multi-sprint pipelines.
 */
async function fetchLatestSprintStepArtifact<T>(
  db: PrismaClient,
  pipelineRunId: string,
  stepKey: string,
  artifactType: string,
): Promise<T | null> {
  const result = await fetchLatestSprintStepArtifactWithId<T>(db, pipelineRunId, stepKey, artifactType);
  return result?.payload ?? null;
}

/**
 * Variant of fetchLatestSprintStepArtifact that also returns the IssueWorkProduct.id.
 * Used when the agent needs the DB record id as a `contractRef` field in its artifact
 * (BuildResult and EvaluationReport both require contractRef = IssueWorkProduct.id of
 * the approved SprintContract).
 */
async function fetchLatestSprintStepArtifactWithId<T>(
  db: PrismaClient,
  pipelineRunId: string,
  stepKey: string,
  artifactType: string,
): Promise<{ id: string; payload: T } | null> {
  const stepRun = await db.pipelineStepRun.findUnique({
    where: { pipelineRunId_stepKey: { pipelineRunId, stepKey } },
    select: { id: true },
  });
  if (!stepRun) return null;

  const workProduct = await db.issueWorkProduct.findFirst({
    where: { pipelineRunId, pipelineStepRunId: stepRun.id, artifactType },
    orderBy: { createdAt: "desc" },
    select: { id: true, structuredPayload: true },
  });
  if (!workProduct) return null;

  const payload = parseStructuredPayload<T>(workProduct.structuredPayload);
  if (!payload) return null;

  return { id: workProduct.id, payload };
}

/**
 * Parses a Prisma Json? field back to a typed object.
 * Handles both pre-serialized string values and native JSON objects.
 */
function parseStructuredPayload<T>(payload: unknown): T | null {
  if (payload === null || payload === undefined) return null;
  try {
    if (typeof payload === "string") return JSON.parse(payload) as T;
    return payload as T;
  } catch {
    return null;
  }
}

/**
 * Fetches all SprintRun records for the pipeline ordered by sprint number.
 */
async function fetchSprintHistory(
  db: PrismaClient,
  pipelineRunId: string,
): Promise<Array<{ sprintNumber: number; status: string }>> {
  return db.sprintRun.findMany({
    where: { pipelineRunId },
    select: { sprintNumber: true, status: true },
    orderBy: { sprintNumber: "asc" },
  });
}

// ---------------------------------------------------------------------------
// Private formatting helpers
// ---------------------------------------------------------------------------

/**
 * Formats a ProductSpec for injection into Builder context.
 * Includes title, summary, constraints, and sprint list only.
 * Full feature descriptions are intentionally excluded per §8.
 */
function formatProductSpecSummary(spec: ProductSpec): string {
  const sprintLines = spec.sprints
    .map((s) => `  Sprint ${s.number}: ${s.goal}`)
    .join("\n");
  const constraintLines =
    spec.constraints.length > 0
      ? `\nConstraints:\n${spec.constraints.map((c) => `  - ${c}`).join("\n")}`
      : "";
  return `## ProductSpec\nTitle: ${spec.title}\nSummary: ${spec.summary}${constraintLines}\n\nSprints:\n${sprintLines}`;
}

/**
 * Formats sprint history from SprintRun records.
 * Emits a harness-generated summary block rather than any agent-written content.
 */
function formatSprintHistory(
  history: Array<{ sprintNumber: number; status: string }>,
  currentSprint: number,
): string {
  const passed = history.filter((s) => s.status === "passed").map((s) => s.sprintNumber);
  const completedStr = passed.length > 0 ? passed.join(", ") : "none";
  return `## Sprint History\nCompleted sprints: ${completedStr}\nCurrent sprint: ${currentSprint}`;
}

/**
 * Formats a BuildResult for injection into Evaluator context.
 * Provides summary, files changed, and gitRef. The gitRef gives the evaluator
 * the commit to diff against using its git tool access.
 */
function formatBuildResultContext(result: BuildResult, sprintNumber: number): string {
  const filesStr =
    result.filesChanged.length > 0
      ? result.filesChanged.map((f) => `  - ${f}`).join("\n")
      : "  (none listed)";
  return (
    `## BuildResult (Sprint ${sprintNumber} — Attempt ${result.attemptNumber})\n` +
    `Summary: ${result.summary}\n` +
    `Git ref: ${result.gitRef}\n` +
    `Files changed:\n${filesStr}\n\n` +
    `Run \`git diff ${result.gitRef}\` (or \`git show ${result.gitRef}\`) to inspect the full diff.`
  );
}
