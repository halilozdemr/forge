-- AlterTable: add structured artifact fields to issue_work_products
-- structuredPayload: JSON string for typed V2.1 artifacts (ProductSpec, SprintContract, BuildResult, EvaluationReport)
-- schemaVersion: version tag discriminating artifact schema versions (e.g. "v2.1")
ALTER TABLE "issue_work_products" ADD COLUMN "structuredPayload" TEXT;
ALTER TABLE "issue_work_products" ADD COLUMN "schemaVersion" TEXT;

-- CreateIndex: allows harness to efficiently query work products by artifact type
CREATE INDEX "issue_work_products_artifactType_idx" ON "issue_work_products"("artifactType");

-- CreateTable: sprint_runs
-- One row per sprint per pipeline run. Authoritative ledger for sprint lifecycle.
-- status enum: contracting | building | passed | failed | approval_pending
CREATE TABLE "sprint_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pipelineRunId" TEXT NOT NULL,
    "sprintNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'contracting',
    "approvalReason" TEXT,
    "contractRevisions" INTEGER NOT NULL DEFAULT 0,
    "buildAttempts" INTEGER NOT NULL DEFAULT 0,
    "contractArtifactId" TEXT,
    "buildArtifactId" TEXT,
    "evaluationArtifactId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "sprint_runs_pipelineRunId_fkey" FOREIGN KEY ("pipelineRunId") REFERENCES "pipeline_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateUniqueIndex: one sprint run per sprint number per pipeline
CREATE UNIQUE INDEX "sprint_runs_pipelineRunId_sprintNumber_key" ON "sprint_runs"("pipelineRunId", "sprintNumber");

-- CreateIndex: harness queries sprint runs by pipeline + status to resolve current sprint state
CREATE INDEX "sprint_runs_pipelineRunId_status_idx" ON "sprint_runs"("pipelineRunId", "status");
