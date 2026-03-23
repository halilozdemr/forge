-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "stack" TEXT NOT NULL DEFAULT 'other',
    "config" TEXT NOT NULL DEFAULT '{}',
    "readmePath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "projects_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "modelProvider" TEXT NOT NULL DEFAULT 'claude-cli',
    "model" TEXT NOT NULL,
    "promptFile" TEXT,
    "reportsTo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "permissions" TEXT NOT NULL DEFAULT '{}',
    "adapterConfig" TEXT NOT NULL DEFAULT '{}',
    "maxConcurrent" INTEGER NOT NULL DEFAULT 1,
    "heartbeatCron" TEXT,
    "maxSessionRuns" INTEGER NOT NULL DEFAULT 20,
    "maxSessionTokens" INTEGER NOT NULL DEFAULT 100000,
    "maxSessionAgeHours" INTEGER NOT NULL DEFAULT 24,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "agents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "agent_api_keys" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "lastUsed" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_api_keys_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "issues" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "sprintId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'feature',
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "assignedAgentId" TEXT,
    "parentIssueId" TEXT,
    "goalId" TEXT,
    "result" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "executionLockedAt" DATETIME,
    "executionAgentSlug" TEXT,
    "executionJobId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "issues_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "issues_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "sprints" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "issues_assignedAgentId_fkey" FOREIGN KEY ("assignedAgentId") REFERENCES "agents" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "issues_parentIssueId_fkey" FOREIGN KEY ("parentIssueId") REFERENCES "issues" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "issues_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sprints" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "goal" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planning',
    "startedAt" DATETIME,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "sprints_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "cost_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "issueId" TEXT,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" REAL NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cost_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "cost_events_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "budget_policies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'company',
    "scopeId" TEXT,
    "monthlyLimitUsd" REAL NOT NULL,
    "softLimitPct" INTEGER NOT NULL DEFAULT 80,
    "hardLimitPct" INTEGER NOT NULL DEFAULT 100,
    "action" TEXT NOT NULL DEFAULT 'warn',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "budget_policies_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "skills_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "skill_executions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skillId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "result" TEXT NOT NULL DEFAULT 'failed',
    "errorMessage" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "skill_executions_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "skill_executions_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "memory_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'learning',
    "content" TEXT NOT NULL,
    "source" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "memory_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "activity_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "queue_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "issueId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'agent_task',
    "payload" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "result" TEXT,
    "error" TEXT,
    "scheduledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "queuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "queue_jobs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "queue_jobs_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "heartbeat_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentSlug" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'triggered',
    "result" TEXT,
    "triggeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "heartbeat_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "config_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "config_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "scheduled_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobKey" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "nextRunAt" DATETIME NOT NULL,
    "lastRunAt" DATETIME,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "scheduled_jobs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sync_outbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" DATETIME,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "level" TEXT NOT NULL DEFAULT 'task',
    "status" TEXT NOT NULL DEFAULT 'active',
    "parentId" TEXT,
    "ownerAgentSlug" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "goals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "goals_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "goals" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "execution_workspaces" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "policy" TEXT NOT NULL DEFAULT 'shared',
    "workspacePath" TEXT NOT NULL,
    "branchName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cleanedAt" DATETIME,
    CONSTRAINT "execution_workspaces_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "agent_runtime_state" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "sessionId" TEXT,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" DATETIME NOT NULL,
    CONSTRAINT "agent_runtime_state_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "agent_task_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME
);

-- CreateTable
CREATE TABLE "agent_config_revisions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "config" TEXT NOT NULL,
    "changeNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_config_revisions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "projects_companyId_name_key" ON "projects"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "agents_companyId_slug_key" ON "agents"("companyId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "agent_api_keys_keyHash_key" ON "agent_api_keys"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "sprints_projectId_number_key" ON "sprints"("projectId", "number");

-- CreateIndex
CREATE INDEX "cost_events_companyId_createdAt_idx" ON "cost_events"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "cost_events_agentId_createdAt_idx" ON "cost_events"("agentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "budget_policies_companyId_scope_scopeId_key" ON "budget_policies"("companyId", "scope", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "skills_companyId_name_key" ON "skills"("companyId", "name");

-- CreateIndex
CREATE INDEX "memory_entries_companyId_type_idx" ON "memory_entries"("companyId", "type");

-- CreateIndex
CREATE INDEX "activity_logs_companyId_createdAt_idx" ON "activity_logs"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "queue_jobs_status_scheduledAt_idx" ON "queue_jobs"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "queue_jobs_companyId_status_idx" ON "queue_jobs"("companyId", "status");

-- CreateIndex
CREATE INDEX "heartbeat_runs_companyId_agentSlug_idx" ON "heartbeat_runs"("companyId", "agentSlug");

-- CreateIndex
CREATE UNIQUE INDEX "config_entries_companyId_key_key" ON "config_entries"("companyId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_jobs_jobKey_key" ON "scheduled_jobs"("jobKey");

-- CreateIndex
CREATE INDEX "scheduled_jobs_enabled_nextRunAt_idx" ON "scheduled_jobs"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "sync_outbox_status_createdAt_idx" ON "sync_outbox"("status", "createdAt");

-- CreateIndex
CREATE INDEX "goals_companyId_level_idx" ON "goals"("companyId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "execution_workspaces_issueId_key" ON "execution_workspaces"("issueId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_runtime_state_agentId_key" ON "agent_runtime_state"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_task_sessions_agentId_issueId_key" ON "agent_task_sessions"("agentId", "issueId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_config_revisions_agentId_revision_key" ON "agent_config_revisions"("agentId", "revision");
