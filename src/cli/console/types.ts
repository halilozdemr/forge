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
  issueTitle?: string | null;
  stepKey?: string | null;
  createdAt?: string;
}

export interface LogLine {
  ts: string;
  text: string;
  repeat: number;
}

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
  lastUpdatedAt: Date | null;
  lastRefreshError: string | null;
  shutdownRequested: boolean;
  workflowDetail: WorkflowDetail | null;
  workflowDetailLoading: boolean;
  workflowDetailError: string | null;
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
