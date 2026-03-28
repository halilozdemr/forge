export type TopLevelView = "overview" | "workflows" | "approvals" | "logs";
export type DetailView = "workflow-detail" | "approval-detail" | "new-task";

export type NewTaskWorkType = "feature" | "bug";
export type NewTaskFocusField = "type" | "title" | "mode" | "submit";

export interface NewTaskFormState {
  focusField: NewTaskFocusField;
  workType: NewTaskWorkType;
  title: string;
  executionMode: "fast" | "structured";
  submitting: boolean;
  submitError: string | null;
}

export interface NavState {
  topLevel: TopLevelView;
  detail: DetailView | null;
  selectedIndex: number;
  detailId: string | null;
}

export interface StatusResponse {
  queue?: { pending?: number; running?: number; failed?: number };
  agents?: { total?: number; idle?: number; running?: number; paused?: number };
  heartbeat?: { scheduledCount?: number; nextRunMs?: number | null };
}

export interface WorkflowSummary {
  id: string;
  type: string;
  status: string;
  issueTitle: string | null;
  currentStepKey: string | null;
  progress: { completed: number; total: number };
  updatedAt?: string;
  lastError?: string | null;
  createdAt?: string;
}

export interface WorkflowStep {
  stepKey: string;
  agentSlug: string;
  status: string;
  attempts: number;
  startedAt?: string | null;
  completedAt?: string | null;
  resultSummary?: string | null;
}

export interface WorkflowDetail {
  id: string;
  type: string;
  status: string;
  entryAgentSlug?: string | null;
  currentStepKey: string | null;
  progress: { completed: number; failed?: number; total: number };
  issueId?: string | null;
  issue?: { id: string; title: string; type?: string; status?: string } | null;
  requestedBy?: string | null;
  lastError?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  steps: WorkflowStep[];
}

export interface ApprovalSummary {
  id: string;
  type: string;
  status: string;
  title: string;
  description: string;
  requestedBy?: string | null;
  requestedAt?: string | null;
  reviewedAt?: string | null;
  workflowId?: string | null;
  workflowStatus?: string | null;
  issueTitle?: string | null;
  stepKey?: string | null;
  agentSlug?: string | null;
  reason?: string | null;
  summary?: string | null;
}

export interface ApprovalActionDescriptor {
  key: string;
  label: string;
  description: string;
}

export interface ApprovalContextLine {
  label: string;
  value: string;
}

export interface ApprovalWorkflowContext {
  id: string;
  status: string;
  currentStepKey?: string | null;
  entryAgentSlug?: string | null;
  sprintNumber?: number | null;
  stepAgentSlug?: string | null;
  stepStatus?: string | null;
  issue?: { id: string; title: string; type?: string | null; status?: string | null } | null;
}

export interface ApprovalDetail {
  id: string;
  type: string;
  status: string;
  title: string;
  description: string;
  summary?: string | null;
  requestedBy?: string | null;
  requestedAt?: string | null;
  reviewedAt?: string | null;
  reason?: string | null;
  note?: string | null;
  stepKey?: string | null;
  agentSlug?: string | null;
  criterion?: string | null;
  decisionHint?: string | null;
  actionMode: "approval-route" | "harness-decision" | "none";
  availableActions: ApprovalActionDescriptor[];
  workflow?: ApprovalWorkflowContext | null;
  contextLines: ApprovalContextLine[];
}

export interface LogLine {
  ts: string;
  text: string;
  repeat: number;
  level: "info" | "warn" | "error";
  category: string;
  lowSignal: boolean;
  sourceType: string;
}

export type LogSeverityMode = "all" | "warn-error";

export interface ConsoleState {
  nav: NavState;
  newTaskForm: NewTaskFormState;
  companyId: string | null;
  status: StatusResponse | null;
  workflows: WorkflowSummary[];
  approvals: ApprovalSummary[];
  pendingApprovals: number | null;
  logs: LogLine[];
  logsConnected: boolean;
  heartbeatFilterEnabled: boolean;
  logSeverityMode: LogSeverityMode;
  logsPaused: boolean;
  lastLogEventAt: Date | null;
  lastUpdatedAt: Date | null;
  lastRefreshError: string | null;
  shutdownRequested: boolean;
  workflowDetail: WorkflowDetail | null;
  workflowDetailLoading: boolean;
  workflowDetailError: string | null;
  approvalDetail: ApprovalDetail | null;
  approvalDetailLoading: boolean;
  approvalDetailError: string | null;
  approvalActionLoading: boolean;
  flashMessage: string | null;
  flashTone: "success" | "error" | "info" | null;
  detailScrollOffset: number;
}

export interface LayoutRegions {
  width: number;
  height: number;
  contentHeight: number;
}

export interface ForgeConsoleShellOptions {
  port: number;
  initialCompanyId?: string | null;
  onRequestShutdown: () => void;
}
