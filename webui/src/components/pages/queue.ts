import { fetchQueueJobs } from '../../api/queue';
import { esc } from '../../api/utils';

export function QueuePage() {
  const container = document.createElement('div');
  container.className = 'queue-page';
  container.setAttribute('data-cleanup', '1');
  
  const header = document.createElement('div');
  header.className = 'page-header';
  header.innerHTML = `
    <h1>Live Queue</h1>
    <div class="status-indicator">
      <span class="dot pulse"></span> Live Polling (3s)
    </div>
  `;
  container.appendChild(header);

  const tableCard = document.createElement('div');
  tableCard.className = 'card table-card';
  tableCard.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Name</th>
          <th>Status</th>
          <th>Progress</th>
          <th>Created</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="queue-tbody">
        <tr><td colspan="6" style="text-align: center; padding: 32px; color: var(--text3);">Loading queue...</td></tr>
      </tbody>
    </table>
  `;
  container.appendChild(tableCard);

  const tbody = tableCard.querySelector('#queue-tbody') as HTMLElement;

  const updateTable = async () => {
    const jobs = await fetchQueueJobs();
    if (jobs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 32px; color: var(--text3);">No active jobs in queue.</td></tr>';
      return;
    }

    tbody.innerHTML = jobs.map(job => `
      <tr>
        <td><code style="font-size: 11px;">${esc(job.id.slice(0, 8))}</code></td>
        <td><strong>${esc(job.name || 'default')}</strong></td>
        <td><span class="badge badge-${getStatusColor(job.status)}">${esc(job.status)}</span></td>
        <td>
          <div class="progress-bar-small">
            <div class="progress-fill" style="width: ${job.progress || 0}%"></div>
          </div>
        </td>
        <td style="font-size: 12px; color: var(--text3);">${new Date(job.timestamp).toLocaleTimeString()}</td>
        <td><button class="btn-icon" data-id="${esc(job.id)}">Details</button></td>
      </tr>
    `).join('');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'indigo';
      case 'completed': return 'green';
      case 'failed': return 'red';
      case 'delayed': return 'amber';
      default: return 'text3';
    }
  };

  updateTable();
  const interval = setInterval(updateTable, 3000);

  // Clean up interval when component is removed
  (container as any).cleanup = () => clearInterval(interval);

  return container;
}
