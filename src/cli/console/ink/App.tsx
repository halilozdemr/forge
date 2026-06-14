import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type {
  StatusResponse,
  WorkflowSummary,
  WorkflowDetail,
  ApprovalSummary,
  ApprovalDetail,
  LogLine,
  LogSeverityMode,
  TopLevelView,
  DetailView,
  NewTaskFormState,
  NewTaskFocusField,
  ForgeConsoleShellOptions,
} from "../types.js";
import { ConsoleClient, appendLog, describeEvent, parseEvent, type LogDescriptor } from "./data.js";
import {
  statusColor,
  isAttentionStatus,
  shortId,
  nowTime,
  formatDuration,
  formatRelativeTime,
  stepDuration,
  stepIndicator,
  clampIndex,
  scrollWindow,
} from "./format.js";

interface WsClient {
  close: () => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
}

const EMPTY_FORM: NewTaskFormState = {
  focusField: "type",
  workType: "feature",
  title: "",
  executionMode: "fast",
  submitting: false,
  submitError: null,
};

const FIELD_ORDER: NewTaskFocusField[] = ["type", "title", "mode", "submit"];

function useTerminalSize(): { cols: number; rows: number } {
  const [size, setSize] = useState({
    cols: Math.max(80, process.stdout.columns ?? 100),
    rows: Math.max(24, process.stdout.rows ?? 30),
  });
  useEffect(() => {
    const onResize = () => {
      setSize({
        cols: Math.max(80, process.stdout.columns ?? 100),
        rows: Math.max(24, process.stdout.rows ?? 30),
      });
    };
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);
  return size;
}

// ── Small presentational helpers ────────────────────────────────────────────

function StatusText({ status }: { status: string | null | undefined }): React.ReactElement {
  const text = status ?? "—";
  const color = statusColor(status);
  return color ? <Text color={color}>{text}</Text> : <Text dimColor>{text}</Text>;
}

function Field({ label, value, labelWidth = 11 }: { label: string; value: React.ReactNode; labelWidth?: number }): React.ReactElement {
  return (
    <Text>
      {"  "}
      <Text dimColor>{label.padEnd(labelWidth)}</Text>
      {value}
    </Text>
  );
}

function SectionHeader({ title, meta }: { title: string; meta?: React.ReactNode }): React.ReactElement {
  return (
    <Box>
      <Text bold>{` ${title}`}</Text>
      {meta ? <Text>{"  "}{meta}</Text> : null}
    </Box>
  );
}

// ── Views ───────────────────────────────────────────────────────────────────

function OverviewView({ st }: { st: AppState }): React.ReactElement {
  const status = st.status;
  const q = status?.queue ?? {};
  const a = status?.agents ?? {};
  const h = status?.heartbeat ?? {};
  return (
    <Box flexDirection="column">
      <SectionHeader title="RUNTIME" />
      {!status ? (
        <Text dimColor>{"  loading…"}</Text>
      ) : (
        <>
          <Text>{`  queue    pending=${q.pending ?? 0}  running=${q.running ?? 0}  failed=${q.failed ?? 0}`}</Text>
          <Text>{`  agents   total=${a.total ?? 0}  idle=${a.idle ?? 0}  active=${a.running ?? 0}  paused=${a.paused ?? 0}`}</Text>
          <Text>{`  hb       scheduled=${h.scheduledCount ?? 0}  next=${formatDuration(h.nextRunMs ?? null)}`}</Text>
          <Text>{"  approvals "}<Text dimColor>pending=</Text>{st.pendingApprovals ?? 0}</Text>
        </>
      )}
      <Text> </Text>
      <SectionHeader title="RECENT WORKFLOWS" meta={<Text dimColor>[w] open workflows</Text>} />
      {st.workflows.length === 0 ? (
        <Text dimColor>{"  no workflow runs yet"}</Text>
      ) : (
        <>
          <Text dimColor>{`  ${"STATUS".padEnd(14)}${"TYPE".padEnd(10)}${"PROG".padEnd(6)}${"STEP".padEnd(18)}TITLE`}</Text>
          {st.workflows.slice(0, Math.max(1, st.contentHeight - 8)).map((wf) => (
            <Text key={wf.id} wrap="truncate">
              {"  "}
              <Text color={statusColor(wf.status) ?? undefined} dimColor={statusColor(wf.status) == null}>
                {(wf.status ?? "").slice(0, 13).padEnd(14)}
              </Text>
              {(wf.type ?? "").padEnd(10)}
              {`${wf.progress?.completed ?? 0}/${wf.progress?.total ?? 0}`.padEnd(6)}
              {(wf.currentStepKey ?? "—").slice(0, 17).padEnd(18)}
              {wf.issueTitle ?? shortId(wf.id)}
            </Text>
          ))}
        </>
      )}
    </Box>
  );
}

function WorkflowsView({ st }: { st: AppState }): React.ReactElement {
  const running = st.workflows.filter((w) => ["running", "in_progress"].includes((w.status ?? "").toLowerCase())).length;
  const blocked = st.workflows.filter((w) => ["approval_pending", "failed"].includes((w.status ?? "").toLowerCase())).length;
  const listVisible = Math.max(1, st.contentHeight - 3);
  const { start, end } = scrollWindow(st.selectedIndex, st.workflows.length, listVisible);
  const wf = st.workflows[st.selectedIndex] ?? null;

  return (
    <Box>
      {/* Left: list */}
      <Box flexDirection="column" width="62%" paddingRight={1}>
        <SectionHeader
          title="WORKFLOWS"
          meta={
            <Text>
              <Text dimColor>{st.workflows.length} total</Text>
              {running > 0 ? <Text color="yellow">{`  ${running} running`}</Text> : null}
              {blocked > 0 ? <Text color="red">{`  ${blocked} blocked`}</Text> : null}
            </Text>
          }
        />
        <Text dimColor>{`  ${"STATUS".padEnd(13)}${"TYPE".padEnd(10)}${"PROG".padEnd(6)}TITLE`}</Text>
        {st.workflows.length === 0 ? (
          st.lastUpdatedAt === null ? (
            <Text dimColor>{"  loading…"}</Text>
          ) : (
            <>
              <Text dimColor>{"  no workflows yet"}</Text>
              <Text dimColor>{"  press [n] to start a new task"}</Text>
            </>
          )
        ) : (
          st.workflows.slice(start, end).map((w, i) => {
            const idx = start + i;
            const selected = idx === st.selectedIndex;
            const prog = `${w.progress?.completed ?? 0}/${w.progress?.total ?? 0}`;
            const attention = isAttentionStatus(w.status);
            return (
              <Text key={w.id} wrap="truncate" dimColor={!selected && !attention}>
                <Text color={selected ? "cyan" : undefined}>{selected ? "> " : "  "}</Text>
                <Text color={selected || attention ? statusColor(w.status) ?? undefined : undefined}>
                  {(w.status ?? "").slice(0, 12).padEnd(13)}
                </Text>
                {(w.type ?? "").padEnd(10)}
                {prog.padEnd(6)}
                {w.issueTitle ?? shortId(w.id)}
              </Text>
            );
          })
        )}
      </Box>
      {/* Right: preview */}
      <Box flexDirection="column" width="38%" borderStyle="single" borderColor="gray" borderTop={false} borderBottom={false} borderRight={false} paddingLeft={1}>
        <SectionHeader title="DETAIL" />
        {!wf ? (
          <Text dimColor>{"  no workflow selected"}</Text>
        ) : (
          <>
            <Field label="status" value={<StatusText status={wf.status} />} labelWidth={9} />
            <Field label="type" value={wf.type ?? "—"} labelWidth={9} />
            <Field label="step" value={wf.currentStepKey ?? "—"} labelWidth={9} />
            <Field label="progress" value={`${wf.progress?.completed ?? 0}/${wf.progress?.total ?? 0} steps`} labelWidth={9} />
            {wf.updatedAt || wf.createdAt ? (
              <Field label="updated" value={formatRelativeTime(wf.updatedAt ?? wf.createdAt)} labelWidth={9} />
            ) : null}
            <Text> </Text>
            {wf.issueTitle ? <Text wrap="truncate">{"  "}{wf.issueTitle}</Text> : null}
            {(wf.status ?? "").toLowerCase() === "approval_pending" ? (
              <Text color="cyan">{"  ! Approval pending"}</Text>
            ) : (wf.status ?? "").toLowerCase() === "failed" && wf.lastError ? (
              <Text color="red" wrap="truncate">{`  ! ${wf.lastError}`}</Text>
            ) : null}
            <Text> </Text>
            <Text dimColor>{"  [enter] inspect"}</Text>
          </>
        )}
      </Box>
    </Box>
  );
}

function ApprovalsView({ st }: { st: AppState }): React.ReactElement {
  const listVisible = Math.max(1, st.contentHeight - 2);
  const { start, end } = scrollWindow(st.selectedIndex, st.approvals.length, listVisible);
  const ap = st.approvals[st.selectedIndex] ?? null;
  return (
    <Box>
      <Box flexDirection="column" width="62%" paddingRight={1}>
        <SectionHeader
          title="APPROVALS"
          meta={st.approvals.length > 0 ? <Text color="yellow">{`${st.approvals.length} pending`}</Text> : <Text dimColor>none</Text>}
        />
        {st.approvals.length === 0 ? (
          <Text dimColor>{"  no pending approvals"}</Text>
        ) : (
          st.approvals.slice(start, end).map((a, i) => {
            const idx = start + i;
            const selected = idx === st.selectedIndex;
            const badge = a.stepKey ?? a.type;
            return (
              <Text key={a.id} wrap="truncate" dimColor={!selected}>
                <Text color={selected ? "cyan" : undefined}>{selected ? "► " : "  "}</Text>
                <Text dimColor>{badge ? `[${badge}]`.padEnd(18) : "".padEnd(18)}</Text>
                {" "}
                {a.title ?? a.issueTitle ?? shortId(a.id)}
              </Text>
            );
          })
        )}
      </Box>
      <Box flexDirection="column" width="38%" paddingLeft={1}>
        <SectionHeader title="DETAIL" />
        {!ap ? (
          <Text dimColor>{"  select an approval"}</Text>
        ) : (
          <>
            <Field label="id" value={shortId(ap.id)} labelWidth={8} />
            <Field label="type" value={ap.type} labelWidth={8} />
            <Field label="status" value={ap.status} labelWidth={8} />
            {ap.requestedBy ? <Field label="from" value={ap.requestedBy} labelWidth={8} /> : null}
            {ap.stepKey ? <Field label="step" value={ap.stepKey} labelWidth={8} /> : null}
            {ap.agentSlug ? <Field label="agent" value={`@${ap.agentSlug}`} labelWidth={8} /> : null}
            {ap.requestedAt ? <Field label="opened" value={formatRelativeTime(ap.requestedAt)} labelWidth={8} /> : null}
            <Text> </Text>
            <Text wrap="truncate">{"  "}{ap.description ?? ap.title ?? ""}</Text>
            <Text> </Text>
            <Text dimColor>{"  [enter] review & act"}</Text>
          </>
        )}
      </Box>
    </Box>
  );
}

function LogsView({ st }: { st: AppState }): React.ReactElement {
  let warnCount = 0;
  let errorCount = 0;
  let hidden = 0;
  let total = 0;
  const visible = st.logs.filter((entry) => {
    total += entry.repeat;
    if (entry.level === "warn") warnCount += entry.repeat;
    if (entry.level === "error") errorCount += entry.repeat;
    if (st.heartbeatFilterEnabled && entry.lowSignal) {
      hidden += entry.repeat;
      return false;
    }
    if (st.logSeverityMode === "warn-error" && entry.level === "info") {
      hidden += entry.repeat;
      return false;
    }
    return true;
  });
  const available = Math.max(1, st.contentHeight - 3);
  const tail = visible.slice(-available);
  const flowing = st.lastLogEventAt && Date.now() - st.lastLogEventAt.getTime() < 15_000;

  return (
    <Box flexDirection="column">
      <SectionHeader
        title="LIVE LOGS"
        meta={
          <Text>
            {st.logsConnected ? <Text color="green">● connected</Text> : <Text color="yellow">● reconnecting</Text>}
            {"  "}
            {st.logsPaused ? <Text color="yellow">paused</Text> : <Text color="green">live tail</Text>}
            {"  "}
            {!st.lastLogEventAt ? <Text dimColor>idle</Text> : flowing ? <Text color="green">flowing</Text> : <Text color="yellow">quiet</Text>}
          </Text>
        }
      />
      <Text>
        {" "}<Text dimColor>visible</Text> {`${total - hidden}/${total}`}
        {"  "}<Text dimColor>hidden</Text> {hidden}
        {"  "}<Text dimColor>warn</Text> {warnCount}
        {"  "}<Text dimColor>err</Text> {errorCount}
        {"  "}<Text dimColor>filters</Text> {st.heartbeatFilterEnabled ? <Text color="green">noise↓</Text> : <Text color="yellow">noise all</Text>}
        {" "}{st.logSeverityMode === "warn-error" ? <Text color="yellow">warn/error</Text> : <Text dimColor>all</Text>}
      </Text>
      {tail.length === 0 ? (
        <Text dimColor>{st.logs.length === 0 ? "  no events yet — runtime activity will stream here" : "  no logs match the current filters ([h]/[e]/[c])"}</Text>
      ) : (
        tail.map((entry, i) => {
          const levelColor = entry.level === "error" ? "red" : entry.level === "warn" ? "yellow" : "cyan";
          return (
            <Text key={`${entry.ts}-${i}`} wrap="truncate">
              {" "}<Text dimColor>{entry.ts}</Text>{"  "}
              <Text color={levelColor}>{entry.level.toUpperCase().padEnd(5)}</Text>{" "}
              <Text dimColor>{entry.category.padEnd(8)}</Text>{" "}
              {entry.text}
              {entry.repeat > 1 ? <Text dimColor>{` ×${entry.repeat}`}</Text> : null}
            </Text>
          );
        })
      )}
    </Box>
  );
}

function WorkflowDetailView({ st }: { st: AppState }): React.ReactElement {
  const summaryWf = st.workflows.find((w) => w.id === st.detailId) ?? null;
  const detail = st.workflowDetail;
  const id = detail?.id ?? st.detailId ?? "—";
  const type = detail?.type ?? summaryWf?.type ?? "—";
  const status = detail?.status ?? summaryWf?.status ?? "—";
  const currentStep = detail?.currentStepKey ?? summaryWf?.currentStepKey ?? null;
  const progress = detail?.progress ?? summaryWf?.progress ?? null;
  const issueTitle = detail?.issue?.title ?? summaryWf?.issueTitle ?? null;
  const lastError = detail?.lastError ?? summaryWf?.lastError ?? null;

  const rows: React.ReactElement[] = [];
  rows.push(<SectionHeader key="h" title="WORKFLOW INSPECTOR" />);
  rows.push(<Field key="id" label="id" value={shortId(id)} />);
  rows.push(<Field key="type" label="type" value={type} />);
  rows.push(<Field key="status" label="status" value={<StatusText status={status} />} />);
  if (currentStep || progress) {
    const val = [currentStep, progress ? `(${progress.completed}/${progress.total} steps)` : null].filter(Boolean).join("  ");
    rows.push(<Field key="step" label="step" value={val} />);
  }
  if (detail?.createdAt) rows.push(<Field key="created" label="created" value={formatRelativeTime(detail.createdAt)} />);
  if (detail?.startedAt) rows.push(<Field key="started" label="started" value={formatRelativeTime(detail.startedAt)} />);
  if (detail?.completedAt) rows.push(<Field key="completed" label="completed" value={formatRelativeTime(detail.completedAt)} />);
  if (issueTitle) rows.push(<Text key="title" wrap="truncate">{`  "${issueTitle}"`}</Text>);
  if (lastError && status.toLowerCase() === "failed") {
    rows.push(<Text key="err" color="red" wrap="truncate">{`  ! ${lastError}`}</Text>);
  }
  rows.push(<Text key="sd" dimColor>{"── STEP TIMELINE ──"}</Text>);

  if (st.workflowDetailLoading && !detail) {
    rows.push(<Text key="ld" dimColor>{"  Loading steps…"}</Text>);
  } else if (st.workflowDetailError && !detail) {
    rows.push(<Text key="le" color="red">{`  ${st.workflowDetailError}`}</Text>);
    rows.push(<Text key="lr" dimColor>{"  [r] retry"}</Text>);
  } else if (detail) {
    if (detail.steps.length === 0) {
      rows.push(<Text key="ns" dimColor>{"  no steps recorded"}</Text>);
    } else {
      rows.push(
        <Text key="sh" dimColor>{`      ${"STEP".padEnd(20)}${"AGENT".padEnd(14)}${"STATUS".padEnd(14)}TIME`}</Text>,
      );
      for (const step of detail.steps) {
        const s = (step.status ?? "").toLowerCase();
        const ind = stepIndicator(step.status, step.attempts);
        const dim = ["completed", "done", "pending", "cancelled", ""].includes(s);
        const indColor = s === "failed" ? "red" : s === "approval_pending" ? "cyan" : ["running", "in_progress"].includes(s) ? "yellow" : undefined;
        rows.push(
          <Text key={step.stepKey} wrap="truncate" dimColor={dim}>
            {"  "}
            <Text color={indColor}>{ind}</Text>{" "}
            {step.stepKey.padEnd(20)}
            {`@${step.agentSlug}`.padEnd(14)}
            {(step.status ?? "pending").padEnd(14)}
            {stepDuration(step)}
          </Text>,
        );
      }
    }
  }

  const sliced = rows.slice(st.detailScrollOffset, st.detailScrollOffset + st.contentHeight);
  return <Box flexDirection="column">{sliced}</Box>;
}

function ApprovalDetailView({ st }: { st: AppState }): React.ReactElement {
  const summary = st.approvals.find((a) => a.id === st.detailId) ?? null;
  const detail = st.approvalDetail && st.approvalDetail.id === st.detailId ? st.approvalDetail : null;
  const id = detail?.id ?? summary?.id ?? st.detailId ?? "—";
  const type = detail?.type ?? summary?.type ?? "—";
  const status = detail?.status ?? summary?.status ?? "—";
  const title = detail?.title ?? summary?.title ?? summary?.description ?? shortId(id);
  const reason = detail?.reason ?? summary?.reason ?? null;

  const rows: React.ReactElement[] = [];
  rows.push(<SectionHeader key="h" title="APPROVAL INSPECTOR" />);
  rows.push(<Field key="id" label="id" value={shortId(id)} />);
  rows.push(<Field key="type" label="type" value={type} />);
  rows.push(<Field key="status" label="status" value={<StatusText status={status} />} />);
  if (detail?.requestedBy ?? summary?.requestedBy) rows.push(<Field key="rb" label="requested" value={detail?.requestedBy ?? summary?.requestedBy ?? ""} />);
  if (detail?.requestedAt ?? summary?.requestedAt) rows.push(<Field key="ra" label="opened" value={formatRelativeTime(detail?.requestedAt ?? summary?.requestedAt)} />);
  if (detail?.stepKey ?? summary?.stepKey) rows.push(<Field key="sk" label="step" value={detail?.stepKey ?? summary?.stepKey ?? ""} />);
  if (detail?.agentSlug ?? summary?.agentSlug) rows.push(<Field key="ag" label="agent" value={`@${detail?.agentSlug ?? summary?.agentSlug}`} />);
  rows.push(<Text key="t" wrap="truncate">{`  "${title}"`}</Text>);
  if (reason) rows.push(<Text key="why" color="yellow" wrap="truncate">{`  ! ${reason}`}</Text>);
  if (st.approvalDetailLoading && !detail) rows.push(<Text key="ld" dimColor>{"  Loading approval context…"}</Text>);
  if (st.approvalDetailError && !detail) rows.push(<Text key="le" color="red">{`  ${st.approvalDetailError}`}</Text>);

  if (detail?.workflow) {
    rows.push(<Text key="wd" dimColor>{"── WORKFLOW CONTEXT ──"}</Text>);
    rows.push(<Field key="wf" label="workflow" value={<Text>{shortId(detail.workflow.id)}{"  "}<StatusText status={detail.workflow.status} /></Text>} />);
    if (detail.workflow.sprintNumber != null) rows.push(<Field key="sp" label="sprint" value={String(detail.workflow.sprintNumber)} />);
    if (detail.workflow.currentStepKey) rows.push(<Field key="cs" label="current" value={detail.workflow.currentStepKey} />);
  }

  if (detail && detail.status === "pending" && detail.availableActions.length > 0) {
    rows.push(<Text key="dd" dimColor>{"── DECISION ──"}</Text>);
    if (detail.decisionHint) rows.push(<Text key="dh" wrap="truncate">{`  ${detail.decisionHint}`}</Text>);
    for (const action of detail.availableActions) {
      rows.push(
        <Text key={action.key} wrap="truncate">
          {"  "}<Text color={action.key === "a" ? "green" : "red"}>{`[${action.key}]`}</Text>{" "}
          {action.label.padEnd(8)} {action.description}
        </Text>,
      );
    }
  }
  if (st.approvalActionLoading) rows.push(<Text key="al" dimColor>{"  Applying decision…"}</Text>);

  const sliced = rows.slice(st.detailScrollOffset, st.detailScrollOffset + st.contentHeight);
  return <Box flexDirection="column">{sliced}</Box>;
}

function NewTaskView({ form }: { form: NewTaskFormState }): React.ReactElement {
  const border = (focus: boolean) => (focus ? "cyan" : "gray");
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text bold>{" NEW TASK"}</Text>
      <Text dimColor>{" [tab] next field   [esc] cancel   [ctrl+enter] submit"}</Text>
      <Text> </Text>

      <Text color={form.focusField === "type" ? "cyan" : "gray"} dimColor={form.focusField !== "type"}>WORK TYPE</Text>
      <Box borderStyle="round" borderColor={border(form.focusField === "type")} paddingX={1}>
        <Text>
          <Text color={form.workType === "feature" ? "green" : undefined} dimColor={form.workType !== "feature"}>{form.workType === "feature" ? "[●]" : "[ ]"}</Text> feature
          {"      "}
          <Text color={form.workType === "bug" ? "green" : undefined} dimColor={form.workType !== "bug"}>{form.workType === "bug" ? "[●]" : "[ ]"}</Text> bug
          {form.focusField === "type" ? <Text dimColor>{"   ← → / space"}</Text> : null}
        </Text>
      </Box>

      <Text color={form.focusField === "title" ? "cyan" : "gray"} dimColor={form.focusField !== "title"}>TASK TITLE</Text>
      <Box borderStyle="round" borderColor={border(form.focusField === "title")} paddingX={1}>
        <Text wrap="truncate">
          <Text color={form.focusField === "title" ? "cyan" : "gray"}>{"> "}</Text>
          {form.title}
          {form.focusField === "title" ? <Text>▌</Text> : null}
        </Text>
      </Box>

      <Text color={form.focusField === "mode" ? "cyan" : "gray"} dimColor={form.focusField !== "mode"}>EXECUTION MODE</Text>
      <Box borderStyle="round" borderColor={border(form.focusField === "mode")} paddingX={1} flexDirection="column">
        <Text>
          <Text color={form.executionMode === "fast" ? "green" : undefined} dimColor={form.executionMode !== "fast"}>{form.executionMode === "fast" ? "[●]" : "[ ]"}</Text> fast
          {"         "}
          <Text color={form.executionMode === "structured" ? "green" : undefined} dimColor={form.executionMode !== "structured"}>{form.executionMode === "structured" ? "[●]" : "[ ]"}</Text> structured
          {form.focusField === "mode" ? <Text dimColor>{"   ← → / space"}</Text> : null}
        </Text>
        <Text dimColor>{"    Quick iteration      Planned w/ checkpoints"}</Text>
      </Box>

      <Box borderStyle="round" borderColor={border(form.focusField === "submit")} paddingX={1}>
        {form.submitting ? (
          <Text color="yellow">Submitting…</Text>
        ) : (
          <Text bold color={form.focusField === "submit" ? "cyan" : undefined}>
            SUBMIT TASK{form.focusField === "submit" ? <Text dimColor>{"   [enter]"}</Text> : null}
          </Text>
        )}
      </Box>

      {form.submitError ? <Text color="red">{`✗ ${form.submitError}`}</Text> : null}
    </Box>
  );
}

// ── Keymap footer ───────────────────────────────────────────────────────────

function Keymap({ st }: { st: AppState }): React.ReactElement {
  const parts: Array<[string, string]> = [];
  if (st.detail === "new-task") {
    const focus = st.newTaskForm.focusField;
    if (focus === "title") {
      parts.push(["chars", "type"], ["bksp", "del"], ["enter", "next"], ["ctrl+enter", "submit"]);
    } else if (focus === "submit") {
      parts.push(["enter", "submit"]);
    } else {
      parts.push(["← →", "select"], ["space", "toggle"]);
    }
    parts.push(["tab", "next field"], ["esc", "cancel"]);
  } else if (st.detail) {
    parts.push(["esc", "back"]);
    if (st.detail === "workflow-detail") parts.push(["↑↓", "scroll"], ["r", "refresh"]);
    else if (st.detail === "approval-detail") parts.push(["↑↓", "scroll"], ["a", "approve"], ["r", "reject"]);
  } else {
    parts.push(["o", "overview"], ["w", "workflows"], ["a", "approvals"], ["l", "logs"], ["n", "new"]);
    if (st.view === "workflows" || st.view === "approvals") {
      parts.push(["↑↓", "select"], ["enter", "open"]);
      if (st.view === "workflows") parts.push(["g", "jump active"]);
    }
    if (st.view === "logs") parts.push(["h", "noise"], ["e", "warn/err"], ["p", "pause"], ["c", "clear"]);
    parts.push(["r", "refresh"], ["q", "quit"]);
  }
  return (
    <Text wrap="truncate">
      {" "}
      {parts.map(([k, label], i) => (
        <Text key={i}>
          <Text dimColor>{`[${k}]`}</Text> {label}{"  "}
        </Text>
      ))}
    </Text>
  );
}

// ── App state shape ─────────────────────────────────────────────────────────

interface AppState {
  view: TopLevelView;
  detail: DetailView | null;
  detailId: string | null;
  selectedIndex: number;
  contentHeight: number;
  companyId: string | null;
  status: StatusResponse | null;
  workflows: WorkflowSummary[];
  approvals: ApprovalSummary[];
  pendingApprovals: number | null;
  logs: LogLine[];
  logsConnected: boolean;
  lastLogEventAt: Date | null;
  heartbeatFilterEnabled: boolean;
  logSeverityMode: LogSeverityMode;
  logsPaused: boolean;
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
  newTaskForm: NewTaskFormState;
}

// ── Root component ──────────────────────────────────────────────────────────

export function App({ opts }: { opts: ForgeConsoleShellOptions }): React.ReactElement {
  const { cols, rows } = useTerminalSize();
  const contentHeight = Math.max(6, rows - 5);
  const client = useRef(new ConsoleClient(`http://localhost:${opts.port}`)).current;

  const [st, setSt] = useState<AppState>({
    view: "workflows",
    detail: null,
    detailId: null,
    selectedIndex: 0,
    contentHeight,
    companyId: opts.initialCompanyId ?? null,
    status: null,
    workflows: [],
    approvals: [],
    pendingApprovals: null,
    logs: [],
    logsConnected: false,
    lastLogEventAt: null,
    heartbeatFilterEnabled: true,
    logSeverityMode: "all",
    logsPaused: false,
    lastUpdatedAt: null,
    lastRefreshError: null,
    shutdownRequested: false,
    workflowDetail: null,
    workflowDetailLoading: false,
    workflowDetailError: null,
    approvalDetail: null,
    approvalDetailLoading: false,
    approvalDetailError: null,
    approvalActionLoading: false,
    flashMessage: null,
    flashTone: null,
    detailScrollOffset: 0,
    newTaskForm: EMPTY_FORM,
  });

  // keep contentHeight in state in sync with terminal size
  useEffect(() => {
    setSt((s) => (s.contentHeight === contentHeight ? s : { ...s, contentHeight }));
  }, [contentHeight]);

  const stateRef = useRef(st);
  stateRef.current = st;
  const refreshInFlight = useRef(false);

  // ── Data refresh ──────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    const cur = stateRef.current;
    const selWfId = cur.view === "workflows" ? cur.workflows[cur.selectedIndex]?.id ?? null : null;
    const selApId = cur.view === "approvals" ? cur.approvals[cur.selectedIndex]?.id ?? null : null;
    try {
      let companyId = cur.companyId;
      if (!companyId) companyId = await client.resolveCompanyId();
      const status = await client.getStatus(companyId);
      const workflows = await client.getWorkflows(companyId);
      const approvals = companyId ? await client.getApprovals(companyId) : [];
      setSt((s) => {
        let selectedIndex = s.selectedIndex;
        if (s.view === "workflows") {
          const idx = selWfId ? workflows.findIndex((w) => w.id === selWfId) : -1;
          selectedIndex = idx >= 0 ? idx : clampIndex(s.selectedIndex, workflows.length);
        } else if (s.view === "approvals") {
          const idx = selApId ? approvals.findIndex((a) => a.id === selApId) : -1;
          selectedIndex = idx >= 0 ? idx : clampIndex(s.selectedIndex, approvals.length);
        }
        return {
          ...s,
          companyId,
          status,
          workflows,
          approvals,
          pendingApprovals: approvals.length,
          selectedIndex,
          lastUpdatedAt: new Date(),
          lastRefreshError: null,
        };
      });
    } catch (err) {
      setSt((s) => ({ ...s, lastRefreshError: err instanceof Error ? err.message : String(err) }));
    } finally {
      refreshInFlight.current = false;
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  // ── WebSocket log stream ────────────────────────────────────────────────────
  const pendingLogs = useRef<LogDescriptor[]>([]);
  useEffect(() => {
    let ws: WsClient | null = null;
    let reconnect: NodeJS.Timeout | null = null;
    let disposed = false;

    const push = (d: LogDescriptor) => pendingLogs.current.push(d);

    const connect = async () => {
      if (disposed) return;
      try {
        const wsModule = await import("ws");
        const WS = wsModule.default;
        ws = new WS(`ws://localhost:${opts.port}/ws`) as unknown as WsClient;
        ws.on("open", () => {
          setSt((s) => ({ ...s, logsConnected: true }));
          push({ text: "websocket connected", level: "info", category: "STREAM", lowSignal: false, sourceType: "stream.open" });
        });
        ws.on("close", () => {
          setSt((s) => ({ ...s, logsConnected: false }));
          push({ text: "websocket disconnected", level: "warn", category: "STREAM", lowSignal: false, sourceType: "stream.close" });
          if (!disposed && !reconnect) reconnect = setTimeout(() => { reconnect = null; void connect(); }, 3000);
        });
        ws.on("error", () => {
          setSt((s) => ({ ...s, logsConnected: false }));
        });
        ws.on("message", (...args: unknown[]) => {
          const event = parseEvent(args[0] as Buffer | string);
          if (!event) return;
          push(describeEvent(event));
        });
      } catch (err) {
        push({ text: `Log stream unavailable: ${err instanceof Error ? err.message : String(err)}`, level: "warn", category: "STREAM", lowSignal: false, sourceType: "stream.error" });
      }
    };

    void connect();
    // Flush buffered log lines on a fixed cadence to bound render frequency.
    const flush = setInterval(() => {
      if (pendingLogs.current.length === 0) return;
      const batch = pendingLogs.current;
      pendingLogs.current = [];
      setSt((s) => {
        if (s.logsPaused) return { ...s, lastLogEventAt: new Date() };
        let logs = s.logs;
        for (const d of batch) logs = appendLog(logs, d);
        return { ...s, logs, lastLogEventAt: new Date() };
      });
    }, 150);

    return () => {
      disposed = true;
      if (reconnect) clearTimeout(reconnect);
      clearInterval(flush);
      if (ws) ws.close();
    };
  }, [opts.port]);

  // ── Detail fetchers ─────────────────────────────────────────────────────────
  const openWorkflowDetail = useCallback(async (id: string) => {
    try {
      const workflow = await client.getWorkflowDetail(id);
      setSt((s) => (s.detailId === id && s.detail === "workflow-detail"
        ? { ...s, workflowDetail: workflow, workflowDetailLoading: false, workflowDetailError: null }
        : s));
    } catch (err) {
      setSt((s) => (s.detailId === id && s.detail === "workflow-detail"
        ? { ...s, workflowDetailLoading: false, workflowDetailError: err instanceof Error ? err.message : String(err) }
        : s));
    }
  }, [client]);

  const openApprovalDetail = useCallback(async (id: string) => {
    try {
      const approval = await client.getApprovalDetail(id);
      setSt((s) => (s.detailId === id && s.detail === "approval-detail"
        ? { ...s, approvalDetail: approval, approvalDetailLoading: false, approvalDetailError: null }
        : s));
    } catch (err) {
      setSt((s) => (s.detailId === id && s.detail === "approval-detail"
        ? { ...s, approvalDetailLoading: false, approvalDetailError: err instanceof Error ? err.message : String(err) }
        : s));
    }
  }, [client]);

  const submitNewTask = useCallback(async () => {
    const form = stateRef.current.newTaskForm;
    if (!form.title.trim()) {
      setSt((s) => ({ ...s, newTaskForm: { ...s.newTaskForm, submitError: "Title is required." } }));
      return;
    }
    setSt((s) => ({ ...s, newTaskForm: { ...s.newTaskForm, submitting: true, submitError: null } }));
    try {
      await client.submitIntake({ type: form.workType, title: form.title.trim(), executionMode: form.executionMode });
      setSt((s) => ({ ...s, detail: null, detailId: null, view: "workflows", newTaskForm: EMPTY_FORM }));
      await refresh();
    } catch (err) {
      setSt((s) => ({ ...s, newTaskForm: { ...s.newTaskForm, submitting: false, submitError: err instanceof Error ? err.message : String(err) } }));
    }
  }, [client, refresh]);

  const applyApprovalDecision = useCallback(async (decision: "approve" | "reject") => {
    const cur = stateRef.current;
    const detail = cur.approvalDetail;
    if (!cur.detailId || cur.detail !== "approval-detail" || cur.approvalActionLoading) return;
    if (!detail || detail.id !== cur.detailId) {
      setSt((s) => ({ ...s, flashMessage: "Approval context is still loading.", flashTone: "info" }));
      return;
    }
    setSt((s) => ({ ...s, approvalActionLoading: true, flashMessage: null, flashTone: null }));
    try {
      await client.decideApproval(detail, decision);
      setSt((s) => ({
        ...s,
        detail: null,
        detailId: null,
        approvalDetail: null,
        approvalActionLoading: false,
        detailScrollOffset: 0,
        flashMessage: `${decision === "approve" ? "Approved" : "Rejected"} ${shortId(detail.id)}`,
        flashTone: "success",
      }));
      await refresh();
    } catch (err) {
      setSt((s) => ({ ...s, approvalActionLoading: false, flashMessage: err instanceof Error ? err.message : String(err), flashTone: "error" }));
    }
  }, [client, refresh]);

  const requestShutdown = useCallback(() => {
    setSt((s) => {
      if (s.shutdownRequested) return s;
      opts.onRequestShutdown();
      return { ...s, shutdownRequested: true };
    });
  }, [opts]);

  // ── Keyboard ────────────────────────────────────────────────────────────────
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      requestShutdown();
      return;
    }
    if (key.escape) {
      setSt((s) => {
        if (!s.detail) return s;
        if (s.detail === "new-task" && s.newTaskForm.submitting) return s;
        return { ...s, detail: null, detailId: null, detailScrollOffset: 0, workflowDetail: null, approvalDetail: null };
      });
      return;
    }

    // New-task form
    if (st.detail === "new-task") {
      handleNewTaskKey(input, key);
      return;
    }

    // Other detail views
    if (st.detail) {
      if (key.upArrow) {
        setSt((s) => ({ ...s, detailScrollOffset: Math.max(0, s.detailScrollOffset - 1) }));
      } else if (key.downArrow) {
        setSt((s) => ({ ...s, detailScrollOffset: s.detailScrollOffset + 1 }));
      } else if (input === "a" && st.detail === "approval-detail") {
        void applyApprovalDecision("approve");
      } else if (input === "r") {
        if (st.detail === "approval-detail") void applyApprovalDecision("reject");
        else if (st.detail === "workflow-detail" && st.detailId) {
          setSt((s) => ({ ...s, workflowDetailLoading: true }));
          void openWorkflowDetail(st.detailId);
        }
      } else if (input === "q") {
        requestShutdown();
      }
      return;
    }

    // Top-level
    if (input === "o") setSt((s) => ({ ...s, view: "overview", selectedIndex: 0 }));
    else if (input === "w") setSt((s) => ({ ...s, view: "workflows", selectedIndex: clampIndex(0, s.workflows.length) }));
    else if (input === "a") setSt((s) => ({ ...s, view: "approvals", selectedIndex: clampIndex(0, s.approvals.length) }));
    else if (input === "l") setSt((s) => ({ ...s, view: "logs", selectedIndex: 0 }));
    else if (input === "n") setSt((s) => ({ ...s, detail: "new-task", detailId: null, newTaskForm: EMPTY_FORM }));
    else if (input === "g") {
      setSt((s) => {
        if (s.view !== "workflows") return s;
        const idx = s.workflows.findIndex((w) => ["running", "in_progress", "approval_pending"].includes((w.status ?? "").toLowerCase()));
        return idx >= 0 ? { ...s, selectedIndex: idx } : s;
      });
    } else if (key.upArrow) {
      setSt((s) => {
        if (s.view !== "workflows" && s.view !== "approvals") return s;
        const len = s.view === "approvals" ? s.approvals.length : s.workflows.length;
        return { ...s, selectedIndex: clampIndex(s.selectedIndex - 1, len) };
      });
    } else if (key.downArrow) {
      setSt((s) => {
        if (s.view !== "workflows" && s.view !== "approvals") return s;
        const len = s.view === "approvals" ? s.approvals.length : s.workflows.length;
        return { ...s, selectedIndex: clampIndex(s.selectedIndex + 1, len) };
      });
    } else if (key.return) {
      const cur = stateRef.current;
      if (cur.view === "workflows" && cur.workflows.length > 0) {
        const wf = cur.workflows[cur.selectedIndex];
        if (wf) {
          setSt((s) => ({ ...s, detail: "workflow-detail", detailId: wf.id, workflowDetail: null, workflowDetailLoading: true, workflowDetailError: null, detailScrollOffset: 0 }));
          void openWorkflowDetail(wf.id);
        }
      } else if (cur.view === "approvals" && cur.approvals.length > 0) {
        const ap = cur.approvals[cur.selectedIndex];
        if (ap) {
          setSt((s) => ({ ...s, detail: "approval-detail", detailId: ap.id, approvalDetail: null, approvalDetailLoading: true, approvalDetailError: null, flashMessage: null, flashTone: null, detailScrollOffset: 0 }));
          void openApprovalDetail(ap.id);
        }
      }
    } else if (input === "h" && st.view === "logs") {
      setSt((s) => ({ ...s, heartbeatFilterEnabled: !s.heartbeatFilterEnabled }));
    } else if (input === "e" && st.view === "logs") {
      setSt((s) => ({ ...s, logSeverityMode: s.logSeverityMode === "all" ? "warn-error" : "all" }));
    } else if (input === "p" && st.view === "logs") {
      setSt((s) => ({ ...s, logsPaused: !s.logsPaused }));
    } else if (input === "c" && st.view === "logs") {
      setSt((s) => ({ ...s, logs: [], lastLogEventAt: null, flashMessage: "Logs cleared", flashTone: "info" }));
    } else if (input === "r") {
      void refresh();
    } else if (input === "q") {
      requestShutdown();
    }
  });

  function handleNewTaskKey(input: string, key: { tab?: boolean; shift?: boolean; leftArrow?: boolean; rightArrow?: boolean; upArrow?: boolean; downArrow?: boolean; return?: boolean; ctrl?: boolean; meta?: boolean; backspace?: boolean; delete?: boolean; escape?: boolean }): void {
    setSt((s) => {
      const form = s.newTaskForm;
      if (form.submitting) return s;
      const update = (f: Partial<NewTaskFormState>): AppState => ({ ...s, newTaskForm: { ...form, ...f } });

      if (key.tab) {
        const idx = FIELD_ORDER.indexOf(form.focusField);
        const next = key.shift
          ? FIELD_ORDER[(idx - 1 + FIELD_ORDER.length) % FIELD_ORDER.length]
          : FIELD_ORDER[(idx + 1) % FIELD_ORDER.length];
        return update({ focusField: next });
      }

      const focus = form.focusField;
      if (focus === "type") {
        if (key.leftArrow || key.rightArrow || input === " ") return update({ workType: form.workType === "feature" ? "bug" : "feature" });
        if (key.downArrow || key.return) return update({ focusField: "title" });
        return s;
      }
      if (focus === "title") {
        if (key.backspace || key.delete) return update({ title: form.title.slice(0, -1) });
        if (key.upArrow) return update({ focusField: "type" });
        if (key.return) {
          if (key.ctrl) { void submitNewTask(); return s; }
          return update({ focusField: "mode" });
        }
        if (key.downArrow) return update({ focusField: "mode" });
        if (input && !key.ctrl && !key.meta && !key.escape && !key.leftArrow && !key.rightArrow && input.charCodeAt(0) >= 32) {
          return update({ title: form.title + input });
        }
        return s;
      }
      if (focus === "mode") {
        if (key.leftArrow || key.rightArrow || input === " ") return update({ executionMode: form.executionMode === "fast" ? "structured" : "fast" });
        if (key.upArrow) return update({ focusField: "title" });
        if (key.downArrow || key.return) return update({ focusField: "submit" });
        return s;
      }
      if (focus === "submit") {
        if (key.upArrow) return update({ focusField: "mode" });
        if (key.return || input === " ") { void submitNewTask(); return s; }
        return s;
      }
      return s;
    });
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const breadcrumb = st.detail
    ? `${st.view.toUpperCase()}  ›  ${st.detail.toUpperCase().replace("-", " ")}`
    : st.view.toUpperCase();

  let body: React.ReactElement;
  if (st.detail === "new-task") body = <NewTaskView form={st.newTaskForm} />;
  else if (st.detail === "workflow-detail") body = <WorkflowDetailView st={st} />;
  else if (st.detail === "approval-detail") body = <ApprovalDetailView st={st} />;
  else if (st.view === "overview") body = <OverviewView st={st} />;
  else if (st.view === "workflows") body = <WorkflowsView st={st} />;
  else if (st.view === "approvals") body = <ApprovalsView st={st} />;
  else body = <LogsView st={st} />;

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      {/* Header */}
      <Box>
        <Text bold>{" FORGE CONSOLE"}</Text>
        <Text color="cyan">{"  "}{breadcrumb}</Text>
        <Box flexGrow={1} />
        <Text dimColor>{`localhost:${opts.port}  ${nowTime()} `}</Text>
      </Box>
      <Text dimColor>{"─".repeat(cols)}</Text>

      {/* Content */}
      <Box flexDirection="column" height={contentHeight} overflow="hidden">
        {body}
      </Box>

      {/* Footer */}
      <Text dimColor>{"─".repeat(cols)}</Text>
      <Box>
        {st.shutdownRequested ? (
          <Text color="yellow">{" Shutting down runtime…"}</Text>
        ) : (
          <Text>
            {" "}
            {st.logsConnected ? <Text color="green">●</Text> : <Text color="yellow">●</Text>}
            {" "}
            <Text dimColor>{st.lastUpdatedAt ? `updated ${st.lastUpdatedAt.toLocaleTimeString()}` : "pending"}</Text>
            {st.lastRefreshError ? <Text color="yellow">{`  ⚠ ${st.lastRefreshError.slice(0, 60)}`}</Text> : null}
            {st.flashMessage ? (
              <Text color={st.flashTone === "success" ? "green" : st.flashTone === "error" ? "yellow" : "gray"}>{`  ${st.flashMessage}`}</Text>
            ) : null}
          </Text>
        )}
      </Box>
      <Keymap st={st} />
    </Box>
  );
}
