import { fetchSprints } from '../../api/sprints';
import { esc } from '../../api/utils';

export function SprintsPage() {
  const container = document.createElement('div');
  container.className = 'sprints-page';
  
  const header = document.createElement('div');
  header.className = 'page-header';
  header.innerHTML = `
    <h1>Sprints</h1>
    <button class="btn btn-primary" id="create-sprint-btn">+ New Sprint</button>
  `;
  container.appendChild(header);

  const listContainer = document.createElement('div');
  listContainer.className = 'sprints-list';
  
  fetchSprints().then(sprints => {
    if (sprints.length === 0) {
      listContainer.innerHTML = '<div class="card">No sprints found. Start by creating one!</div>';
      return;
    }

    listContainer.innerHTML = sprints.map(sprint => `
      <div class="card sprint-card">
        <div class="sprint-header">
          <h3>${esc(sprint.name)}</h3>
          <span class="badge badge-${sprint.status === 'active' ? 'green' : (sprint.status === 'planning' ? 'amber' : 'text3')}">${esc(sprint.status)}</span>
        </div>
        <div class="sprint-dates">
          ${sprint.startDate ? new Date(sprint.startDate).toLocaleDateString() : 'TBD'} - 
          ${sprint.endDate ? new Date(sprint.endDate).toLocaleDateString() : 'TBD'}
        </div>
        <div class="sprint-actions">
          <button class="btn btn-outline">View Details</button>
          ${sprint.status === 'planning' ? '<button class="btn btn-primary">Start Sprint</button>' : ''}
        </div>
      </div>
    `).join('');
  }).catch(err => {
    console.error('Sprints: fetchSprints failed', err);
    listContainer.innerHTML = '<div class="card" style="color: var(--danger);">Failed to load sprints. Please try again later.</div>';
  });

  container.appendChild(listContainer);
  return container;
}
