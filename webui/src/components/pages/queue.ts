import { fetchQueueJobs, Job } from '../../api/queue';
import { EmptyState } from '../shared/empty-state';
import { SkeletonRows } from '../shared/skeleton';
import { esc } from '../../api/utils';

const STATUS_COLOR: Record<Job['status'], string> = {
  active:    'blue',
  completed: 'green',
  failed:    'red',
  delayed:   'amber',
  waiting:   'gray',
};

export function QueuePage() {
  const container = document.createElement('div');
  container.className = 'queue-page';
  container.setAttribute('data-cleanup', '1');

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Queue</h1>
        <p class="page-subtitle">Live job monitor</p>
      </div>
      <div class="status-indicator">
        <span class="dot pulse"></span>
        <span>Live · polling every 3s</span>
      </div>
    </div>
    <div class="card table-card">
      <table class="data-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Job</th>
            <th>Status</th>
            <th>Progress</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody id="queue-tbody"></tbody>
      </table>
    </div>
  `;

  const tbody = container.querySelector('#queue-tbody') as HTMLElement;
  tbody.appendChild(SkeletonRows(4, 5));

  const update = async () => {
    const jobs = await fetchQueueJobs();
    tbody.innerHTML = '';

    if (jobs.length === 0) {
      const emptyRow = document.createElement('tr');
      const emptyCell = document.createElement('td');
      emptyCell.colSpan = 5;
      emptyCell.appendChild(EmptyState({ icon: '↗', title: 'Queue is empty', description: 'No jobs running right now.' }));
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
      return;
    }

    tbody.innerHTML = jobs.map(job => {
      const color = STATUS_COLOR[job.status] ?? 'gray';
      const progress = job.progress ?? 0;
      const progressColor = job.status === 'failed' ? 'var(--red)' : job.status === 'completed' ? 'var(--green)' : 'var(--primary)';
      return `
        <tr>
          <td><code style="font-family:var(--font-mono);font-size:11px;color:var(--text3)">${esc(job.id.slice(0,8))}</code></td>
          <td><strong style="font-size:13px">${esc(job.name || 'default')}</strong></td>
          <td><span class="badge badge-${color}"><span class="badge-dot"></span>${esc(job.status)}</span></td>
          <td>
            <div style="display:flex;align-items:center;gap:8px">
              <div class="progress-bar-small">
                <div class="progress-fill" style="width:${progress}%;background:${progressColor}"></div>
              </div>
              <span style="font-size:11px;color:var(--text3);font-family:var(--font-mono)">${progress}%</span>
            </div>
          </td>
          <td style="font-size:12px;color:var(--text3);font-family:var(--font-mono)">${new Date(job.timestamp).toLocaleTimeString()}</td>
        </tr>
      `;
    }).join('');
  };

  update();
  const interval = setInterval(update, 3000);
  (container as any).cleanup = () => clearInterval(interval);

  return container;
}
