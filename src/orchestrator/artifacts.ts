/**
 * Forge V2.1 – Typed Artifact Schema Layer
 *
 * Source of truth: docs/FINAL_ARCHITECTURE_DECISION.md §3
 *
 * This file contains ONLY:
 *   - Zod schemas for all four harness artifacts
 *   - Exported TypeScript types inferred from those schemas
 *   - The ARTIFACT_SCHEMAS registry map
 *
 * No dispatcher logic, DB logic, parsing logic, or side effects.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// 3.1 ProductSpec
// ---------------------------------------------------------------------------

const FeatureSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
});

const SprintDefSchema = z.object({
  number: z.number().int().positive(),
  goal: z.string().min(1),
  featureIds: z.array(z.string().min(1)),
});

export const ProductSpecSchema = z
  .object({
    title: z.string().min(1),
    summary: z.string().min(1),
    features: z.array(FeatureSchema).min(1),
    constraints: z.array(z.string()),
    sprints: z.array(SprintDefSchema).min(1).max(5),
  })
  .refine(
    (spec) => {
      const featureIds = new Set(spec.features.map((f) => f.id));
      return spec.sprints.every((s) => s.featureIds.every((id) => featureIds.has(id)));
    },
    {
      message: "sprints[].featureIds must reference valid features[].id values",
      path: ["sprints"],
    }
  );

export type ProductSpec = z.infer<typeof ProductSpecSchema>;

// ---------------------------------------------------------------------------
// 3.2 SprintContract
// ---------------------------------------------------------------------------

const VerificationMethodSchema = z.enum(["playwright", "lint", "test-run", "file-check"]);

const CriterionSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(10),
    verifierType: z.enum(["machine", "human"]),
    verificationMethod: VerificationMethodSchema.optional(),
    required: z.boolean(),
  })
  .refine(
    (c) => {
      if (c.verifierType === "machine") return c.verificationMethod !== undefined;
      return true;
    },
    {
      message: 'verificationMethod is required when verifierType = "machine"',
      path: ["verificationMethod"],
    }
  )
  .refine(
    (c) => {
      if (c.verifierType === "human") return c.verificationMethod === undefined;
      return true;
    },
    {
      message: 'verificationMethod must be absent when verifierType = "human"',
      path: ["verificationMethod"],
    }
  );

export type Criterion = z.infer<typeof CriterionSchema>;

const ContractStatusSchema = z.enum(["proposed", "revised", "approved", "rejected"]);

export const SprintContractSchema = z
  .object({
    sprintNumber: z.number().int().positive(),
    goal: z.string().min(1),
    scope: z.array(z.string()),
    outOfScope: z.array(z.string()).min(1),
    criteria: z.array(CriterionSchema),
    contractStatus: ContractStatusSchema,
    revisionNumber: z.number().int().min(0),
    proposedBy: z.literal("builder"),
    // TODO: Ideally model approvedBy as present iff contractStatus = "approved".
    // Clean cross-field modelling requires a discriminated union on contractStatus,
    // which would complicate the schema significantly for an optional field.
    // Left as optional for now; harness must enforce presence at acceptance time.
    approvedBy: z.literal("evaluator").optional(),
  })
  .refine(
    (contract) => contract.criteria.some((c) => c.required),
    {
      message: "SprintContract must have at least one required criterion",
      path: ["criteria"],
    }
  )
  .refine(
    (contract) => contract.criteria.some((c) => c.required && c.verifierType === "machine"),
    {
      message: "SprintContract must have at least one required machine criterion",
      path: ["criteria"],
    }
  );

export type SprintContract = z.infer<typeof SprintContractSchema>;

// ---------------------------------------------------------------------------
// 3.3 BuildResult
// ---------------------------------------------------------------------------

export const BuildResultSchema = z.object({
  sprintNumber: z.number().int().positive(),
  contractRef: z.string().min(1),    // IssueWorkProduct.id of the approved SprintContract
  summary: z.string().min(1),
  filesChanged: z.array(z.string()),
  gitRef: z.string().min(1),         // real commit SHA
  attemptNumber: z.number().int().positive(),
  selfAssessment: z.string().min(1), // informational only, not evaluated
});

export type BuildResult = z.infer<typeof BuildResultSchema>;

// ---------------------------------------------------------------------------
// 3.4 EvaluationReport
// ---------------------------------------------------------------------------

const CriterionStatusSchema = z.enum(["passed", "failed", "not_verifiable", "pending_human_review"]);

const CriterionResultSchema = z
  .object({
    id: z.string().min(1),
    status: CriterionStatusSchema,
    evidence: z.string().min(1),
    toolsUsed: z.array(z.string()).optional(),
    failureReason: z.string().optional(),
    observationNote: z.string().optional(),
  })
  .refine(
    (r) => {
      const requiresTools = r.status === "passed" || r.status === "failed" || r.status === "not_verifiable";
      if (requiresTools) return r.toolsUsed !== undefined && r.toolsUsed.length > 0;
      return true;
    },
    {
      message: "toolsUsed is required and must be non-empty when status is passed, failed, or not_verifiable",
      path: ["toolsUsed"],
    }
  )
  .refine(
    (r) => {
      if (r.status === "failed") return r.failureReason !== undefined && r.failureReason.length > 0;
      return true;
    },
    {
      message: 'failureReason is required when status = "failed"',
      path: ["failureReason"],
    }
  );

export type CriterionResult = z.infer<typeof CriterionResultSchema>;

export const EvaluationReportSchema = z
  .object({
    sprintNumber: z.number().int().positive(),
    contractRef: z.string().min(1),               // IssueWorkProduct.id of the approved SprintContract
    gitRefTested: z.string().min(1),              // must equal BuildResult.gitRef (enforced by harness, not schema)
    criteria: z.array(CriterionResultSchema),
    machinePassed: z.boolean(),
    requiresHumanReview: z.boolean(),
    blockers: z.array(z.string()),                // criterion ids of required machine criteria with status = "failed"
    notVerifiableMachineRequired: z.array(z.string()), // required machine criteria with status = "not_verifiable"
    recommendations: z.string(),
  })
  .refine(
    (report) => {
      // machinePassed must be false when blockers exist
      if (report.blockers.length > 0) return report.machinePassed === false;
      return true;
    },
    {
      message: "machinePassed must be false when blockers.length > 0",
      path: ["machinePassed"],
    }
  );

export type EvaluationReport = z.infer<typeof EvaluationReportSchema>;

// ---------------------------------------------------------------------------
// Schema Registry
// ---------------------------------------------------------------------------

export const ARTIFACT_SCHEMAS = {
  ProductSpec: ProductSpecSchema,
  SprintContract: SprintContractSchema,
  BuildResult: BuildResultSchema,
  EvaluationReport: EvaluationReportSchema,
} as const;

export type ArtifactType = keyof typeof ARTIFACT_SCHEMAS;
