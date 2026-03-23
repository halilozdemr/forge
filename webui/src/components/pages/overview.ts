import { healthStore, agentsStore } from '../../store/store';
import { fetchBudgetUsage, BudgetUsage } from '../../api/budget';
import { fetchQueueJobs } from '../../api/queue';
import { fetchAgents } from '../../api/agents';
import { SkeletonCard } from '../shared/skeleton';

export function OverviewPage() {
  const container = document.createElement('div');
  container.className = 'overview-page';

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Overview</h1>
        <p class="page-subtitle">System status and key metrics</p>
      </div>
    </div>
    <div class="overview-grid" id="overview-grid"></div>
  `;

  const grid = container.querySelector('#overview-grid') as HTMLElement;
  for (let i = 0; i < 4; i++) grid.appendChild(SkeletonCard());

  // 1. Health card
  const healthCard = document.createElement('div');
  healthCard.className = 'card stat-card card-interactive';
  healthStore.subscribe(status => {
    if (!status) {
      healthCard.innerHTML = `<div class="stat-label">System Health</div><div class="stat-value" style="font-size:1.2rem">Checking...</div>`;
      return;
    }
    const s = status.status;
    const color = s === 'healthy' ? 'green' : s === 'degraded' ? 'amber' : 'red';
    const c = status.components ?? { db: false, redis: false, worker: false };
    healthCard.innerHTML = `
      <div class="stat-icon" style="background:var(--${color}-subtle);color:var(--${color})">⚡</div>
      <div class="stat-label">System Health</div>
      <div class="stat-value" style="font-size:1.4rem;color:var(--${color})">${s}</div>
      <div class="health-details">
        <div class="health-item"><span>Database</span><span class="badge badge-${c.db?'green':'red'}">${c.db?'OK':'DOWN'}</span></div>
        <div class="health-item"><span>Redis</span><span class="badge badge-${c.redis?'green':'red'}">${c.redis?'OK':'DOWN'}</span></div>
        <div class="health-item"><span>Worker</span><span class="badge badge-${c.worker?'green':'red'}">${c.worker?'OK':'DOWN'}</span></div>
      </div>
    `;
  });

  // 2. Budget card
  const budgetCard = document.createElement('div');
  budgetCard.className = 'card stat-card card-interactive';
  budgetCard.innerHTML = `
    <div class="stat-icon" style="background:var(--green-subtle);color:var(--green)">$</div>
    <div class="stat-label">Monthly Cost</div>
    <div class="stat-value">—</div>
  `;
  fetchBudgetUsage().then((u: BudgetUsage | null) => {
    if (!u) return;
    budgetCard.innerHTML = `
      <div class="stat-icon" style="background:var(--green-subtle);color:var(--green)">$</div>
      <div class="stat-label">Monthly Cost</div>
      <div class="stat-value">$${u.totalUsd.toFixed(2)}</div>
      <div class="token-summary">
        <span>In: ${(u.inputTokens/1000).toFixed(0)}k</span>
        <span>Out: ${(u.outputTokens/1000).toFixed(0)}k</span>
      </div>
    `;
  }).catch(() => {});

  // 3. Agents card
  const agentsCard = document.createElement('div');
  agentsCard.className = 'card stat-card card-interactive';
  agentsStore.subscribe(agents => {
    const active = agents.filter(a => a.status === 'active').length;
    agentsCard.innerHTML = `
      <div class="stat-icon" style="background:var(--purple-subtle);color:var(--purple)">◉</div>
      <div class="stat-label">Agents</div>
      <div class="stat-value">${active} <span style="font-size:1rem;color:var(--text3)">/ ${agents.length}</span></div>
      <div class="stat-sub">${active} active · ${agents.length - active} idle</div>
    `;
  });
  fetchAgents();

  // 4. Queue card
  const queueCard = document.createElement('div');
  queueCard.className = 'card stat-card card-interactive';
  queueCard.innerHTML = `
    <div class="stat-icon" style="background:var(--amber-subtle);color:var(--amber)">↗</div>
    <div class="stat-label">Queue</div>
    <div class="stat-value">—</div>
  `;
  fetchQueueJobs().then(jobs => {
    const active = jobs.filter(j => j.status === 'active').length;
    const failed = jobs.filter(j => j.status === 'failed').length;
    queueCard.innerHTML = `
      <div class="stat-icon" style="background:var(--amber-subtle);color:var(--amber)">↗</div>
      <div class="stat-label">Queue</div>
      <div class="stat-value">${jobs.length}</div>
      <div class="stat-sub">${active} active · ${failed} failed</div>
    `;
  }).catch(() => {});

  grid.innerHTML = '';
  [healthCard, budgetCard, agentsCard, queueCard].forEach(c => grid.appendChild(c));
  return container;
}
