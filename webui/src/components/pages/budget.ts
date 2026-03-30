import { fetchBudgetUsage, fetchBudgetPolicies } from '../../api/budget';
import { EmptyState } from '../shared/empty-state';
import { SkeletonCard } from '../shared/skeleton';
import { SkeletonRows } from '../shared/skeleton';
import { esc } from '../../api/utils';
import { CONFIG } from '../../config';

export function BudgetPage() {
  const container = document.createElement('div');
  container.className = 'budget-page';
  container.setAttribute('data-cleanup', '1');

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Budget</h1>
        <p class="page-subtitle">Cost tracking and spend policies</p>
      </div>
    </div>
    <div class="overview-grid" id="budget-stats">
    </div>
    <div class="card table-card" style="margin-top:24px">
      <div class="table-header">
        <h2>Active Policies</h2>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Monthly Limit</th>
            <th>Alert At</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody id="policies-tbody"></tbody>
      </table>
    </div>
  `;

  const statsGrid = container.querySelector('#budget-stats') as HTMLElement;
  const policiesTbody = container.querySelector('#policies-tbody') as HTMLElement;

  // Skeleton
  for (let i = 0; i < 2; i++) statsGrid.appendChild(SkeletonCard());
  policiesTbody.appendChild(SkeletonRows(2, 4));

  const loadUsage = async () => {
    const usage = await fetchBudgetUsage();
    statsGrid.innerHTML = '';
    if (!usage) {
      statsGrid.innerHTML = '<p style="color:var(--text3);font-size:13px">No usage data available.</p>';
      return;
    }

    const limit = 100; // placeholder limit
    const pct = Math.min((usage.totalUsd / limit) * 100, 100);
    const fillClass = pct > 90 ? 'danger' : pct > 70 ? 'warning' : '';

    const costCard = document.createElement('div');
    costCard.className = 'card stat-card';
    costCard.innerHTML = `
      <div class="stat-icon" style="background:var(--green-subtle);color:var(--green)">$</div>
      <div class="stat-label">Total Spend (${usage.month || 'this month'})</div>
      <div class="stat-value">$${usage.totalUsd.toFixed(2)}</div>
      <div class="usage-bar"><div class="usage-fill ${fillClass}" style="width:${pct}%"></div></div>
      <div class="token-summary">
        <span>In: ${(usage.inputTokens/1000).toFixed(0)}k</span>
        <span>Out: ${(usage.outputTokens/1000).toFixed(0)}k</span>
        <span>Total: ${(usage.totalTokens/1000).toFixed(0)}k tokens</span>
      </div>
    `;

    const tokenCard = document.createElement('div');
    tokenCard.className = 'card stat-card';
    tokenCard.innerHTML = `
      <div class="stat-icon" style="background:var(--primary-subtle);color:var(--primary)">~</div>
      <div class="stat-label">Total Tokens</div>
      <div class="stat-value">${(usage.totalTokens/1000).toFixed(1)}k</div>
      <div class="stat-sub">Avg cost per 1k tokens: $${(usage.totalUsd / (usage.totalTokens / 1000)).toFixed(4)}</div>
    `;

    statsGrid.appendChild(costCard);
    statsGrid.appendChild(tokenCard);
  };

  const loadPolicies = async () => {
    const policies = await fetchBudgetPolicies();
    policiesTbody.innerHTML = '';

    if (policies.length === 0) {
      const emptyRow = document.createElement('tr');
      const emptyCell = document.createElement('td');
      emptyCell.colSpan = 4;
      emptyCell.appendChild(EmptyState({ icon: '⊡', title: 'No policies', description: 'No budget policies are configured.' }));
      emptyRow.appendChild(emptyCell);
      policiesTbody.appendChild(emptyRow);
      return;
    }

    policiesTbody.innerHTML = policies.map(p => `
      <tr>
        <td><code style="font-family:var(--font-mono);font-size:11px;color:var(--text3)">${esc(p.id.slice(0,8))}</code></td>
        <td><strong>$${p.monthlyLimit.toFixed(0)}</strong></td>
        <td>${Math.round(p.alertThreshold * 100)}%</td>
        <td style="font-size:12px;color:var(--text3)">${new Date(p.createdAt).toLocaleDateString()}</td>
      </tr>
    `).join('');
  };

  Promise.all([loadUsage(), loadPolicies()]).catch(() => {});

  const interval = setInterval(() => Promise.all([loadUsage(), loadPolicies()]).catch(() => {}), CONFIG.POLLING_INTERVAL_MS);
  (container as any).cleanup = () => clearInterval(interval);

  return container;
}
