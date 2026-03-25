import { fetchApprovalInbox, approveApproval, rejectApproval, ApprovalItem } from '../../api/approvals';
import { addToast } from '../shared/toast';
import { EmptyState } from '../shared/empty-state';
import { SkeletonRows } from '../shared/skeleton';
import { esc } from '../../api/utils';

const TYPE_BADGE: Record<string, string> = {
  hire_agent:      'purple',
  budget_override: 'amber',
  ceo_strategy:    'blue',
};

function relativeTime(iso: string): string {
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export function ApprovalsPage(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'queue-page';
  container.setAttribute('data-cleanup', '1');

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Approvals</h1>
        <p class="page-subtitle">Pending decisions</p>
      </div>
      <div class="status-indicator">
        <span class="dot pulse"></span>
        <span>Live · polling every 10s</span>
      </div>
    </div>
    <div class="card table-card">
      <table class="data-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Description</th>
            <th>Requested By</th>
            <th>Age</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="approvals-tbody"></tbody>
      </table>
    </div>
  `;

  const tbody = container.querySelector('#approvals-tbody') as HTMLElement;
  tbody.appendChild(SkeletonRows(3, 5));

  const update = async () => {
    let approvals: ApprovalItem[];
    try {
      approvals = await fetchApprovalInbox('pending');
    } catch {
      return;
    }

    tbody.innerHTML = '';

    if (approvals.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.appendChild(EmptyState({ icon: '✓', title: 'No pending approvals', description: 'All decisions are up to date.' }));
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }

    tbody.innerHTML = approvals.map(a => {
      const badgeColor = TYPE_BADGE[a.type] ?? 'gray';
      return `
        <tr>
          <td><span class="badge badge-${badgeColor}">${esc(a.type.replace('_', ' '))}</span></td>
          <td style="font-size:13px;color:var(--text1);max-width:320px">${esc(a.description)}</td>
          <td style="font-size:12px;color:var(--text2)">${esc(a.requestedBy)}</td>
          <td style="font-size:12px;color:var(--text3)">${relativeTime(a.requestedAt)}</td>
          <td>
            <div style="display:flex;gap:6px">
              <button class="btn btn-primary approve-btn" data-id="${esc(a.id)}" style="font-size:12px;padding:4px 10px">Approve</button>
              <button class="btn btn-danger reject-btn"  data-id="${esc(a.id)}" style="font-size:12px;padding:4px 10px">Reject</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll<HTMLButtonElement>('.approve-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await approveApproval(btn.dataset.id!);
          addToast('Approved successfully', 'success');
          await update();
        } catch {
          addToast('Failed to approve', 'error');
          btn.disabled = false;
        }
      });
    });

    tbody.querySelectorAll<HTMLButtonElement>('.reject-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await rejectApproval(btn.dataset.id!);
          addToast('Rejected successfully', 'success');
          await update();
        } catch {
          addToast('Failed to reject', 'error');
          btn.disabled = false;
        }
      });
    });
  };

  update();
  const interval = setInterval(update, 10000);
  (container as any).cleanup = () => clearInterval(interval);

  return container;
}
