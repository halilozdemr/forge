import { agentsStore, Agent } from '../../store/store';
import { fetchAgents, fireAgent } from '../../api/agents';
import { addToast } from '../shared/toast';
import { showConfirm } from '../shared/confirm-dialog';
import { HireAgentModal } from '../shared/agent-modals';
import { SkeletonRows } from '../shared/skeleton';
import { EmptyState } from '../shared/empty-state';
import { esc } from '../../api/utils';

const MODEL_COLOR: Record<string, string> = {
  'bridge/claude-cli-sonnet': 'purple',
  'openrouter/deepseek/deepseek-chat': 'cyan',
  'openrouter/google/gemini-2.0-flash-001': 'blue',
};

const STATUS_COLOR: Record<Agent['status'], string> = {
  active: 'green',
  idle:   'gray',
  paused: 'amber',
  error:  'red',
};

export function AgentsPage() {
  const container = document.createElement('div');
  container.className = 'agents-page';

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Agents</h1>
        <p class="page-subtitle">Manage your AI agent roster</p>
      </div>
      <button class="btn btn-primary" id="hire-btn">+ Hire Agent</button>
    </div>
    <div class="card table-card" id="agents-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Model</th>
            <th>Status</th>
            <th>Cost</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="agents-tbody">
          ${[...Array(3)].map(() => '').join('')}
        </tbody>
      </table>
    </div>
  `;

  const tbody = container.querySelector('#agents-tbody') as HTMLElement;
  tbody.appendChild(SkeletonRows(3, 5));

  container.querySelector('#hire-btn')!.addEventListener('click', () => {
    const modal = HireAgentModal(() => document.body.removeChild(modal));
    document.body.appendChild(modal);
  });

  agentsStore.subscribe(agents => {
    if (agents.length === 0) {
      tbody.innerHTML = '';
      const emptyRow = document.createElement('tr');
      const emptyCell = document.createElement('td');
      emptyCell.colSpan = 5;
      emptyCell.appendChild(EmptyState({
        icon: '◉',
        title: 'No agents yet',
        description: 'Hire your first AI agent to get started.',
        action: { label: '+ Hire Agent', onClick: () => {
          const modal = HireAgentModal(() => document.body.removeChild(modal));
          document.body.appendChild(modal);
        }},
      }));
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
      return;
    }

    tbody.innerHTML = agents.map(agent => {
      const modelKey = Object.keys(MODEL_COLOR).find(k => agent.model.includes(k.split('/').pop()!)) ?? '';
      const modelColor = MODEL_COLOR[modelKey] ?? 'gray';
      const modelLabel = agent.model.split('/').pop() ?? agent.model;
      const statusColor = STATUS_COLOR[agent.status] ?? 'gray';
      return `
        <tr>
          <td>
            <div class="agent-info">
              <strong>${esc(agent.name)}</strong>
              <span>${esc(agent.slug)}</span>
            </div>
          </td>
          <td><span class="badge badge-${modelColor}">${esc(modelLabel)}</span></td>
          <td>
            <span class="badge badge-${statusColor}">
              <span class="badge-dot"></span>${esc(agent.status)}
            </span>
          </td>
          <td style="font-family:var(--font-mono);font-size:13px">$${(agent.cost ?? 0).toFixed(4)}</td>
          <td>
            <div class="actions">
              <button class="btn-icon btn-danger" data-slug="${esc(agent.slug)}" data-action="fire">Fire</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('[data-action="fire"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const slug = (btn as HTMLElement).dataset.slug!;
        const ok = await showConfirm({
          title: 'Fire Agent',
          message: `Are you sure you want to terminate agent <strong>${esc(slug)}</strong>? This cannot be undone.`,
          confirmLabel: 'Fire Agent',
          danger: true,
        });
        if (!ok) return;
        try {
          await fireAgent(slug);
          addToast(`Agent ${slug} terminated`, 'success');
          fetchAgents();
        } catch {
          addToast(`Failed to fire agent`, 'error');
        }
      });
    });
  });

  fetchAgents();
  return container;
}
