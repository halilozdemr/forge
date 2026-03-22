import { healthStore, agentsStore } from '../../store/store';
import { fetchBudgetUsage, BudgetUsage } from '../../api/budget';
import { fetchQueueJobs } from '../../api/queue';
import { fetchAgents } from '../../api/agents';
import { esc } from '../../api/utils';

export function OverviewPage() {
  const container = document.createElement('div');
  container.className = 'overview-page';
  
  const header = document.createElement('h1');
  header.className = 'page-title';
  header.innerText = 'System Overview';
  container.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'overview-grid';

  // 1. Health Card
  const healthCard = document.createElement('div');
  healthCard.className = 'card health-card';
  healthStore.subscribe(status => {
    if (!status) {
      healthCard.innerHTML = '<h3>System Health</h3><p>Loading...</p>';
      return;
    }
    const color = status.status === 'healthy' ? 'green' : (status.status === 'degraded' ? 'amber' : 'red');
    const components = status.components || { db: false, redis: false, worker: false };
    healthCard.innerHTML = `
      <h3>System Health</h3>
      <div class="status-summary">
        <span class="badge badge-${color}">${esc(status.status.toUpperCase())}</span>
      </div>
      <div class="health-details">
        <div class="health-item">DB: <span class="badge badge-${components.db ? 'green' : 'red'}">${components.db ? 'OK' : 'DOWN'}</span></div>
        <div class="health-item">Redis: <span class="badge badge-${components.redis ? 'green' : 'red'}">${components.redis ? 'OK' : 'DOWN'}</span></div>
        <div class="health-item">Worker: <span class="badge badge-${components.worker ? 'green' : 'red'}">${components.worker ? 'OK' : 'DOWN'}</span></div>
      </div>
    `;
  });
  grid.appendChild(healthCard);

  // 2. Budget Card
  const budgetCard = document.createElement('div');
  budgetCard.className = 'card budget-card';
  fetchBudgetUsage().then((usage: BudgetUsage | null) => {
    if (!usage) {
      budgetCard.innerHTML = '<h3>Monthly Cost</h3><p>N/A</p>';
      return;
    }
    budgetCard.innerHTML = `
      <h3>Monthly Cost</h3>
      <div class="cost-value">$${usage.totalUsd.toFixed(2)}</div>
      <div class="token-summary">
        <div>In: ${usage.inputTokens.toLocaleString()}</div>
        <div>Out: ${usage.outputTokens.toLocaleString()}</div>
      </div>
    `;
  }).catch(err => {
    console.error('Overview: fetchBudgetUsage failed', err);
    budgetCard.innerHTML = '<h3>Monthly Cost</h3><p>Error loading cost</p>';
  });
  grid.appendChild(budgetCard);

  // 3. Agents Card
  const agentsCard = document.createElement('div');
  agentsCard.className = 'card agents-card';
  agentsStore.subscribe(agents => {
    const total = agents.length;
    const active = agents.filter(a => a.status === 'active').length;
    agentsCard.innerHTML = `
      <h3>Agents</h3>
      <div class="stats-value">${active} / ${total}</div>
      <p>Agents active</p>
    `;
  });
  fetchAgents(); // Initial fetch
  grid.appendChild(agentsCard);

  // 4. Queue Card
  const queueCard = document.createElement('div');
  queueCard.className = 'card queue-card';
  fetchQueueJobs().then(jobs => {
    queueCard.innerHTML = `
      <h3>Queue</h3>
      <div class="stats-value">${jobs.length}</div>
      <p>Recent jobs (24h)</p>
    `;
  }).catch(err => {
    console.error('Overview: fetchQueueJobs failed', err);
    queueCard.innerHTML = '<h3>Queue</h3><p>Error loading queue</p>';
  });
  grid.appendChild(queueCard);

  container.appendChild(grid);
  return container;
}
