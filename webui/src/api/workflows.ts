import { client } from './client';

export interface StepLog {
  chunkIndex: number;
  text: string;
  createdAt: string;
}

export interface WorkflowArtifact {
  id: string;
  agentSlug: string;
  type: string;
  artifactType: string | null;
  title: string;
  content: string;
  filePath: string | null;
  pipelineStepRunId: string | null;
  createdAt: string;
}

export interface WorkflowStep {
  stepKey: string;
  agentSlug: string;
  status: string;
  attempts: number;
  startedAt: string | null;
  completedAt: string | null;
  resultSummary: string | null;
}

export interface WorkflowSummary {
  id: string;
  type: string;
  status: string;
  entryAgentSlug: string;
  currentStepKey: string | null;
  progress: { completed: number; total: number };
  issueId: string | null;
  issueTitle: string | null;
  requestedBy: string;
  lastError: string | null;
  createdAt: string;
  startedAt: string;
  completedAt: string | null;
}

export interface WorkflowDetail {
  id: string;
  type: string;
  status: string;
  entryAgentSlug: string;
  currentStepKey: string | null;
  progress: { completed: number; failed: number; total: number };
  issueId: string | null;
  issue: { id: string; title: string; type: string; status: string } | null;
  requestedBy: string;
  lastError: string | null;
  createdAt: string;
  startedAt: string;
  completedAt: string | null;
  steps: WorkflowStep[];
}

export async function fetchWorkflows(params?: { status?: string; type?: string; limit?: number }) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.type) qs.set('type', params.type);
  qs.set('limit', String(params?.limit ?? 50));
  const { workflows } = await client.get<{ workflows: WorkflowSummary[] }>(`/workflows?${qs}`);
  return workflows;
}

export async function fetchWorkflow(id: string) {
  const { workflow } = await client.get<{ workflow: WorkflowDetail }>(`/workflows/${id}`);
  return workflow;
}

export async function cancelWorkflow(id: string) {
  return client.post<{ cancelled: boolean }>(`/pipelines/${id}/cancel`, {});
}

export async function retryWorkflowStep(id: string, stepKey: string) {
  return client.post<{ queuedStepKeys: string[] }>(`/pipelines/${id}/steps/${stepKey}/retry`, {});
}

export async function fetchWorkflowLogs(id: string, stepKey: string, cursor?: number) {
  const qs = new URLSearchParams({ stepKey });
  if (cursor !== undefined) qs.set('cursor', String(cursor));
  const { logs, nextCursor } = await client.get<{ logs: StepLog[]; nextCursor: number | null; stepKey: string }>(
    `/workflows/${id}/logs?${qs}`
  );
  return { logs, nextCursor };
}

export async function fetchWorkflowArtifacts(id: string) {
  const { artifacts } = await client.get<{ artifacts: WorkflowArtifact[] }>(`/workflows/${id}/artifacts`);
  return artifacts;
}
