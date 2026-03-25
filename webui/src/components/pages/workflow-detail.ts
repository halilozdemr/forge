import { fetchWorkflow, cancelWorkflow, retryWorkflowStep, fetchWorkflowLogs, fetchWorkflowArtifacts, WorkflowDetail, WorkflowArtifact, StepLog } from '../../api/workflows';
import { addToast } from '../shared/toast';
import { SkeletonRows } from '../shared/skeleton';
import { esc } from '../../api/utils';
import { router } from '../../router/router';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

const STATUS_BADGE: Record<string, string> = {
  pending:   'gray',
  running:   'blue',
  completed: 'green',
  failed:    'red',
  cancelled: 'amber',
};

const STEP_STATUS_BADGE: Record<string, string> = {
  pending:   'gray',
  queued:    'blue',
  running:   'amber',
  completed: 'green',
  failed:    'red',
  cancelled: 'gray',
};

function durationLabel(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return '—';
  const end = completedAt ? new Date(completedAt) : new Date();
  const secs = Math.round((end.getTime() - new Date(startedAt).getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function progressBar(completed: number, total: number): string {
  if (total === 0) return '<span style="color:var(--text3)">—</span>';
  const pct = Math.round((completed / total) * 100);
  const color = pct === 100 ? 'var(--green)' : 'var(--primary)';
  return `
    <div style="display:flex;align-items:center;gap:10px">
      <div class="progress-bar-small" style="width:120px">
        <div class="progress-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <span style="font-size:12px;color:var(--text3);font-family:var(--font-mono)">${completed}/${total} steps (${pct}%)</span>
    </div>
  `;
}

function renderSummary(w: WorkflowDetail): string {
  const badgeColor = STATUS_BADGE[w.status] ?? 'gray';
  const issueLine = w.issue
    ? `<div class="health-item"><span>Issue</span><span style="color:var(--text1)">${esc(w.issue.title)} <span class="badge badge-gray" style="font-size:10px">${esc(w.issue.type)}</span></span></div>`
    : '';
  const errorBlock = w.lastError
    ? `<div style="margin-top:14px;padding:10px 14px;background:var(--red-subtle);border-radius:6px;border:1px solid var(--red);color:var(--red);font-size:12px;font-family:var(--font-mono)">${esc(w.lastError)}</div>`
    : '';
  return `
    <div class="card" style="margin-bottom:20px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <span class="badge badge-${badgeColor}" style="font-size:13px"><span class="badge-dot"></span>${esc(w.status)}</span>
            <span class="badge badge-gray">${esc(w.type)}</span>
          </div>
          <code style="font-size:11px;color:var(--text3);font-family:var(--font-mono)">${esc(w.id)}</code>
        </div>
        <div id="run-actions" style="display:flex;gap:8px;align-items:flex-start"></div>
      </div>
      <div class="health-details" style="margin-top:14px">
        ${issueLine}
        <div class="health-item"><span>Progress</span><span>${progressBar(w.progress.completed, w.progress.total)}</span></div>
        ${w.currentStepKey ? `<div class="health-item"><span>Current step</span><code style="font-size:12px">${esc(w.currentStepKey)}</code></div>` : ''}
        <div class="health-item"><span>Entry agent</span><code style="font-size:12px">${esc(w.entryAgentSlug)}</code></div>
        <div class="health-item"><span>Started</span><span style="font-size:12px;color:var(--text2)">${new Date(w.startedAt).toLocaleString()}</span></div>
        ${w.completedAt ? `<div class="health-item"><span>Completed</span><span style="font-size:12px;color:var(--text2)">${new Date(w.completedAt).toLocaleString()}</span></div>` : ''}
      </div>
      ${errorBlock}
    </div>
  `;
}

function renderSteps(w: WorkflowDetail): string {
  if (w.steps.length === 0) {
    return '<div class="card" style="padding:24px;text-align:center;color:var(--text3)">No steps recorded yet.</div>';
  }
  const rows = w.steps.map(s => {
    const badgeColor = STEP_STATUS_BADGE[s.status] ?? 'gray';
    const dur = durationLabel(s.startedAt, s.completedAt);
    const summary = s.resultSummary
      ? `<div style="margin-top:4px;font-size:11px;color:var(--text3);font-family:var(--font-mono);white-space:pre-wrap;max-width:360px;overflow:hidden;text-overflow:ellipsis">${esc(s.resultSummary.slice(0, 200))}</div>`
      : '';
    const retryBtn = s.status === 'failed'
      ? `<button class="btn btn-ghost retry-step-btn" style="font-size:11px;padding:3px 8px;color:var(--amber)" data-step="${esc(s.stepKey)}">Retry</button>`
      : '';
    const logsBtn = `<button class="btn btn-ghost view-logs-btn" style="font-size:11px;padding:3px 8px" data-step="${esc(s.stepKey)}">Logs</button>`;
    return `
      <tr>
        <td><span class="badge badge-${badgeColor}"><span class="badge-dot"></span>${esc(s.status)}</span></td>
        <td><code style="font-size:12px">${esc(s.stepKey)}</code></td>
        <td style="color:var(--text2);font-size:12px">${esc(s.agentSlug)}</td>
        <td style="font-size:12px;color:var(--text3);font-family:var(--font-mono)">${dur}</td>
        <td style="font-size:11px;color:var(--text3)">${s.attempts > 1 ? `×${s.attempts}` : ''}</td>
        <td>${summary}</td>
        <td style="display:flex;gap:4px">${retryBtn}${logsBtn}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="card table-card">
      <div style="padding:12px 16px 0;font-size:13px;font-weight:600;color:var(--text1)">Step Timeline</div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Step</th>
            <th>Agent</th>
            <th>Duration</th>
            <th>Attempts</th>
            <th>Summary</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderLogViewer(stepKey: string, logs: StepLog[], nextCursor: number | null): string {
  const header = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px 0">
      <span style="font-size:13px;font-weight:600;color:var(--text1)">
        Step Logs <code style="font-size:11px;font-weight:400;color:var(--text3)">${esc(stepKey)}</code>
        <span style="font-size:11px;font-weight:400;color:var(--text3)">&nbsp;·&nbsp;${logs.length} lines${nextCursor !== null ? ' (truncated)' : ''}</span>
      </span>
      <button class="btn btn-ghost close-logs-btn" style="font-size:12px;padding:2px 8px">✕ Close</button>
    </div>
  `;
  if (logs.length === 0) {
    return `<div class="card" style="margin-top:20px">${header}<div style="padding:16px 16px 12px;color:var(--text3);font-size:12px">No log lines recorded for this step.</div></div>`;
  }
  const lines = logs.map(l => esc(l.text)).join('\n');
  return `
    <div class="card" style="margin-top:20px">
      ${header}
      <pre style="margin:10px 16px 16px;padding:12px;background:var(--surface2);border-radius:6px;font-size:11px;line-height:1.6;color:var(--text1);overflow-x:auto;white-space:pre-wrap;word-break:break-all;max-height:420px;overflow-y:auto">${lines}</pre>
    </div>
  `;
}

const ARTIFACT_TYPE_BADGE: Record<string, string> = {
  code_block:        'blue',
  execution_summary: 'gray',
  doc:               'green',
  test:              'purple',
  pr:                'amber',
};

function renderArtifacts(artifacts: WorkflowArtifact[]): string {
  if (artifacts.length === 0) {
    return '<div class="card" style="padding:24px;text-align:center;color:var(--text3);margin-top:20px">No artifacts yet.</div>';
  }
  const rows = artifacts.map(a => {
    const badge = ARTIFACT_TYPE_BADGE[a.artifactType ?? a.type] ?? 'gray';
    const preview = a.content.length > 120 ? a.content.slice(0, 120) + '…' : a.content;
    const stepLabel = a.pipelineStepRunId
      ? `<code style="font-size:10px;color:var(--text3)">${esc(a.pipelineStepRunId.slice(-8))}</code>`
      : '<span style="color:var(--text3)">—</span>';
    return `
      <tr>
        <td><span class="badge badge-${badge}" style="font-size:11px">${esc(a.artifactType ?? a.type)}</span></td>
        <td style="font-size:12px;color:var(--text1);max-width:180px">${esc(a.title)}</td>
        <td style="font-size:11px;color:var(--text2)">${esc(a.agentSlug)}</td>
        <td style="font-size:11px;color:var(--text3);font-family:var(--font-mono);max-width:280px;white-space:pre-wrap">${esc(preview)}</td>
        <td>${stepLabel}</td>
      </tr>
    `;
  }).join('');
  return `
    <div class="card table-card" style="margin-top:20px">
      <div style="padding:12px 16px 0;font-size:13px;font-weight:600;color:var(--text1)">Artifacts <span style="font-size:11px;font-weight:400;color:var(--text3)">(${artifacts.length})</span></div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Title</th>
            <th>Agent</th>
            <th>Preview</th>
            <th>Step</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

export function WorkflowDetailPage(runId: string): HTMLElement {
  const container = document.createElement('div');
  container.className = 'queue-page';
  container.setAttribute('data-cleanup', '1');

  container.innerHTML = `
    <div class="page-header">
      <div style="display:flex;align-items:center;gap:12px">
        <button class="btn btn-ghost" id="back-btn" style="font-size:13px">← Workflows</button>
        <div>
          <h1 class="page-title">Workflow Detail</h1>
          <p class="page-subtitle" style="font-family:var(--font-mono);font-size:11px">${esc(runId)}</p>
        </div>
      </div>
      <div class="status-indicator" id="poll-indicator">
        <span class="dot pulse"></span>
        <span>Polling every 4s</span>
      </div>
    </div>
    <div id="wf-summary-slot"></div>
    <div id="wf-steps-slot"></div>
    <div id="wf-logs-slot"></div>
    <div id="wf-artifacts-slot"></div>
  `;

  container.querySelector('#back-btn')!.addEventListener('click', () => router.navigate('#/workflows'));

  const summarySlot = container.querySelector('#wf-summary-slot') as HTMLElement;
  const stepsSlot = container.querySelector('#wf-steps-slot') as HTMLElement;
  const logsSlot = container.querySelector('#wf-logs-slot') as HTMLElement;
  const artifactsSlot = container.querySelector('#wf-artifacts-slot') as HTMLElement;
  const pollIndicator = container.querySelector('#poll-indicator') as HTMLElement;

  // Skeleton initial state
  const skeletonCard = document.createElement('div');
  skeletonCard.className = 'card';
  skeletonCard.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;padding:4px 0">
      ${Array(4).fill('<div class="skeleton skeleton-text"></div>').join('')}
    </div>
  `;
  summarySlot.appendChild(skeletonCard);
  const skeletonTable = document.createElement('div');
  skeletonTable.className = 'card table-card';
  skeletonTable.innerHTML = `<table class="data-table"><tbody id="sk-tbody"></tbody></table>`;
  stepsSlot.appendChild(skeletonTable);
  (skeletonTable.querySelector('#sk-tbody') as HTMLElement).appendChild(SkeletonRows(4, 7));

  const skeletonArtifacts = document.createElement('div');
  skeletonArtifacts.className = 'card table-card';
  skeletonArtifacts.style.marginTop = '20px';
  skeletonArtifacts.innerHTML = `<table class="data-table"><tbody id="sk-art-tbody"></tbody></table>`;
  artifactsSlot.appendChild(skeletonArtifacts);
  (skeletonArtifacts.querySelector('#sk-art-tbody') as HTMLElement).appendChild(SkeletonRows(2, 5));

  let lastStatus = '';

  const bindActions = (w: WorkflowDetail) => {
    const actionsEl = container.querySelector('#run-actions') as HTMLElement;
    if (!actionsEl) return;
    actionsEl.innerHTML = '';

    if (!TERMINAL.has(w.status)) {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn btn-danger';
      cancelBtn.style.fontSize = '12px';
      cancelBtn.textContent = 'Cancel Run';
      cancelBtn.addEventListener('click', async () => {
        cancelBtn.disabled = true;
        try {
          await cancelWorkflow(w.id);
          addToast('Workflow cancelled', 'success');
          await update();
        } catch {
          addToast('Failed to cancel workflow', 'error');
          cancelBtn.disabled = false;
        }
      });
      actionsEl.appendChild(cancelBtn);
    }
  };

  const bindRetryButtons = (w: WorkflowDetail) => {
    container.querySelectorAll<HTMLButtonElement>('.retry-step-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const stepKey = btn.dataset.step!;
        btn.disabled = true;
        try {
          await retryWorkflowStep(w.id, stepKey);
          addToast(`Step "${stepKey}" queued for retry`, 'success');
          await update();
        } catch {
          addToast(`Failed to retry step "${stepKey}"`, 'error');
          btn.disabled = false;
        }
      });
    });
  };

  const bindLogButtons = () => {
    container.querySelectorAll<HTMLButtonElement>('.view-logs-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const stepKey = btn.dataset.step!;
        btn.disabled = true;
        btn.textContent = '…';
        try {
          const { logs, nextCursor } = await fetchWorkflowLogs(runId, stepKey);
          logsSlot.innerHTML = renderLogViewer(stepKey, logs, nextCursor);
          logsSlot.querySelector('.close-logs-btn')?.addEventListener('click', () => {
            logsSlot.innerHTML = '';
          });
          logsSlot.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch {
          addToast(`Failed to load logs for "${stepKey}"`, 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Logs';
        }
      });
    });
  };

  const update = async () => {
    let w: WorkflowDetail;
    try {
      w = await fetchWorkflow(runId);
    } catch {
      summarySlot.innerHTML = `<div class="card" style="color:var(--red);padding:20px">Failed to load workflow <code style="font-size:11px">${esc(runId)}</code></div>`;
      stepsSlot.innerHTML = '';
      logsSlot.innerHTML = '';
      artifactsSlot.innerHTML = '';
      clearInterval(interval);
      return;
    }

    summarySlot.innerHTML = renderSummary(w);
    stepsSlot.innerHTML = renderSteps(w);

    bindActions(w);
    bindRetryButtons(w);
    bindLogButtons();

    fetchWorkflowArtifacts(runId).then(artifacts => {
      artifactsSlot.innerHTML = renderArtifacts(artifacts);
    }).catch(() => { /* silently skip — artifacts are non-critical */ });

    if (TERMINAL.has(w.status) && lastStatus !== w.status) {
      pollIndicator.innerHTML = `<span style="color:var(--text3);font-size:12px">Run ${w.status}</span>`;
    }
    lastStatus = w.status;

    if (TERMINAL.has(w.status)) {
      clearInterval(interval);
    }
  };

  update();
  let interval = setInterval(update, 4000);
  (container as any).cleanup = () => clearInterval(interval);

  return container;
}
