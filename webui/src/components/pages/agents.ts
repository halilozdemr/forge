import { agentsStore } from '../../store/store';
import { fetchAgents, fireAgent } from '../../api/agents';
import { addToast } from '../shared/toast';
import { HireAgentModal } from '../shared/agent-modals';
import { esc } from '../../api/utils';

export function AgentsPage() {
  const container = document.createElement('div');
  container.className = 'agents-page';
  
  const header = document.createElement('div');
  header.className = 'page-header';
  header.innerHTML = `
    <h1>Agent Roster</h1>
    <button class="btn btn-primary" id="hire-agent-btn">+ Hire Agent</button>
  `;
  container.appendChild(header);

  const hireBtn = header.querySelector('#hire-agent-btn') as HTMLButtonElement;
  hireBtn.onclick = () => {
    const modal = HireAgentModal(() => document.body.removeChild(modal));
    document.body.appendChild(modal);
  };

  const tableContainer = document.createElement('div');
  tableContainer.className = 'card table-card';
  
  agentsStore.subscribe(agents => {
    tableContainer.innerHTML = `
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
        <tbody>
          ${agents.map(agent => `
            <tr>
              <td>
                <div class="agent-info">
                  <strong>${esc(agent.name)}</strong>
                  <span>${esc(agent.slug)}</span>
                </div>
              </td>
              <td><span class="badge badge-indigo">${esc(agent.model)}</span></td>
              <td><span class="badge badge-${agent.status === 'active' ? 'green' : (agent.status === 'paused' ? 'amber' : 'red')}">${esc(agent.status)}</span></td>
              <td>$${agent.cost.toFixed(2)}</td>
              <td>
                <div class="actions">
                  <button class="btn-icon" data-slug="${esc(agent.slug)}" data-action="${esc('edit')}">Edit</button>
                  <button class="btn-icon btn-danger" data-slug="${esc(agent.slug)}" data-action="${esc('fire')}">Fire</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    // Add event listeners to buttons
    tableContainer.querySelectorAll('[data-action="fire"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const slug = (e.target as HTMLElement).getAttribute('data-slug');
        if (slug && confirm(`Are you sure you want to fire agent ${slug}?`)) {
          try {
            await fireAgent(slug);
            addToast(`Agent ${slug} terminated`, 'success');
            fetchAgents();
          } catch (err) {
            addToast(`Failed to fire agent: ${err}`, 'error');
          }
        }
      });
    });
  });

  fetchAgents(); // Initial fetch
  
  container.appendChild(tableContainer);
  return container;
}
