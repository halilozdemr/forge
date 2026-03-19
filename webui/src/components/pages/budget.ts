import { fetchBudgetUsage, fetchBudgetPolicies } from '../../api/budget';
import { esc } from '../../api/utils';
import { CONFIG } from '../../config';

export function BudgetPage() {
  const container = document.createElement('div');
  container.className = 'budget-page';
  container.setAttribute('data-cleanup', '1');
  
  const header = document.createElement('div');
  header.className = 'page-header';
  header.innerHTML = `
    <h1>Budget & Policies</h1>
    <button class="btn btn-primary" id="add-policy-btn">+ Add Policy</button>
  `;
  container.appendChild(header);

  const statsGrid = document.createElement('div');
  statsGrid.className = 'overview-grid'; // Reuse overview grid styles
  container.appendChild(statsGrid);

  const tableCard = document.createElement('div');
  tableCard.className = 'card table-card';
  tableCard.style.marginTop = '24px';
  tableCard.innerHTML = `
    <div style="padding: 16px 24px; border-bottom: 1px solid var(--border);">
      <h2 style="font-size: 14px; font-weight: 600;">Active Policies</h2>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Monthly Limit</th>
          <th>Alert Threshold</th>
          <th>Created</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="policies-tbody"></tbody>
    </table>
  `;
  container.appendChild(tableCard);

  const updateUsage = async () => {
    const usage = await fetchBudgetUsage();
    if (!usage) return;

    statsGrid.innerHTML = `
      <div class="card">
        <label>Total Spend (USD)</label>
        <div class="cost-value">$${usage.totalUsd.toFixed(2)}</div>
        <div class="token-summary">
          <span>In: ${Math.round(usage.inputTokens / 1000)}k</span>
          <span>Out: ${Math.round(usage.outputTokens / 1000)}k</span>
        </div>
      </div>
      <div class="card">
        <label>Total Tokens</label>
        <div class="stats-value">${(usage.totalTokens / 1000).toFixed(1)}k</div>
        <label>Current Month</label>
      </div>
    `;
  };

  const updatePolicies = async () => {
    const policies = await fetchBudgetPolicies();
    const tbody = tableCard.querySelector('#policies-tbody') as HTMLElement;
    
    if (policies.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 24px; color: var(--text3);">No policies defined.</td></tr>';
      return;
    }

    tbody.innerHTML = policies.map(policy => `
      <tr>
        <td><code style="font-size: 11px;">${esc(policy.id.slice(0, 8))}</code></td>
        <td><strong>$${policy.monthlyLimit.toFixed(0)}</strong></td>
        <td>${policy.alertThreshold * 100}%</td>
        <td style="font-size: 12px; color: var(--text3);">${new Date(policy.createdAt).toLocaleDateString()}</td>
        <td><button class="btn-icon btn-danger">Delete</button></td>
      </tr>
    `).join('');
  };

  const updateAll = async () => {
    await Promise.all([
      updateUsage(),
      updatePolicies()
    ]).catch(err => {
      console.error('Budget: updateAll failed', err);
    });
  };

  updateAll();
  const interval = setInterval(updateAll, CONFIG.POLLING_INTERVAL_MS);

  (container as any).cleanup = () => clearInterval(interval);

  return container;
}
