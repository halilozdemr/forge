-- AlterTable: add pipelineRunId, pipelineStepRunId, artifactType to issue_work_products
ALTER TABLE "issue_work_products" ADD COLUMN "pipelineRunId" TEXT;
ALTER TABLE "issue_work_products" ADD COLUMN "pipelineStepRunId" TEXT;
ALTER TABLE "issue_work_products" ADD COLUMN "artifactType" TEXT;

-- CreateIndex
CREATE INDEX "issue_work_products_pipelineRunId_idx" ON "issue_work_products"("pipelineRunId");
