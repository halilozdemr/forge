-- CreateTable: pipeline_step_logs
CREATE TABLE "pipeline_step_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pipelineStepRunId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pipeline_step_logs_pipelineStepRunId_fkey" FOREIGN KEY ("pipelineStepRunId") REFERENCES "pipeline_step_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateUniqueIndex
CREATE UNIQUE INDEX "pipeline_step_logs_pipelineStepRunId_chunkIndex_key" ON "pipeline_step_logs"("pipelineStepRunId", "chunkIndex");

-- CreateIndex
CREATE INDEX "pipeline_step_logs_pipelineStepRunId_chunkIndex_idx" ON "pipeline_step_logs"("pipelineStepRunId", "chunkIndex");
