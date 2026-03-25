import { fetchWorkflows, WorkflowSummary } from '../../api/workflows';
import { EmptyState } from '../shared/empty-state';
import { SkeletonRows } from '../shared/skeleton';
import { esc } from '../../api/utils';
import { router } from '../../router/router';

const STATUS_BADGE: Record<string, string> = {
  pending:   'gray',
  running:   'blue',
  completed: 'green',
  failed:    'red',
  cancelled: 'amber',
};

function progressCell(completed: number, total: number): string {
  if (total === 0) return '<span style="color:var(--text3);font-size:12px">—</span>';
  const pct = Math.round((completed / total) * 100);
  const color = pct === 100 ? 'var(--green)' : 'var(--primary)';
  return `
    <div style="display:flex;align-items:center;gap:8px">
      <div class="progress-bar-small">
        <div class="progress-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <span style="font-size:11px;color:var(--text3);font-family:var(--font-mono)">${completed}/${total}</span>
    </div>
  `;
}

function renderRows(workflows: WorkflowSummary[]): string {
  return workflows.map(w => {
    const badgeColor = STATUS_BADGE[w.status] ?? 'gray';
    const title = w.issueTitle
      ? esc(w.issueTitle.slice(0, 48))
      : `<span style="color:var(--text3);font-family:var(--font-mono);font-size:11px">${esc(w.id.slice(0, 12))}…</span>`;
    const stepKey = w.currentStepKey
      ? `<code style="font-size:11px;color:var(--text2)">${esc(w.currentStepKey)}</code>`
      : '<span style="color:var(--text3)">—</span>';
    const started = new Date(w.startedAt).toLocaleString();
    return `
      <tr class="clickable-row" data-run-id="${esc(w.id)}" style="cursor:pointer">
        <td><span class="badge badge-${badgeColor}">${esc(w.type)}</span></td>
        <td>${title}</td>
        <td><span class="badge badge-${badgeColor}"><span class="badge-dot"></span>${esc(w.status)}</span></td>
        <td>${progressCell(w.progress.completed, w.progress.total)}</td>
        <td>${stepKey}</td>
        <td style="font-size:12px;color:var(--text3)">${started}</td>
        <td>
          <button class="btn btn-ghost" style="font-size:12px;padding:4px 10px" data-view="${esc(w.id)}">View →</button>
        </td>
      </tr>
    `;
  }).join('');
}

export function WorkflowsPage(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'queue-page';
  container.setAttribute('data-cleanup', '1');

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Workflows</h1>
        <p class="page-subtitle">Pipeline runs</p>
      </div>
      <div class="status-indicator">
        <span class="dot pulse"></span>
        <span>Live · polling every 5s</span>
      </div>
    </div>
    <div class="card table-card">
      <table class="data-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Title / ID</th>
            <th>Status</th>
            <th>Progress</th>
            <th>Current Step</th>
            <th>Started</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="wf-tbody"></tbody>
      </table>
    </div>
  `;

  const tbody = container.querySelector('#wf-tbody') as HTMLElement;
  tbody.appendChild(SkeletonRows(5, 7));

  const navigate = (id: string) => router.navigate(`#/workflows/${id}`);

  const update = async () => {
    let workflows: WorkflowSummary[];
    try {
      workflows = await fetchWorkflows({ limit: 50 });
    } catch {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--red);font-size:13px">Failed to load workflows. Is the server running?</td></tr>`;
      return;
    }

    tbody.innerHTML = '';

    if (workflows.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 7;
      cell.appendChild(EmptyState({ icon: '⟳', title: 'No workflow runs', description: 'Submit a feature or bug to start a run.' }));
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }

    tbody.innerHTML = renderRows(workflows);

    tbody.querySelectorAll<HTMLElement>('[data-view]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigate(btn.dataset.view!);
      });
    });

    tbody.querySelectorAll<HTMLElement>('.clickable-row').forEach(row => {
      row.addEventListener('click', () => navigate(row.dataset.runId!));
    });
  };

  update();
  const interval = setInterval(update, 5000);
  (container as any).cleanup = () => clearInterval(interval);

  return container;
}
