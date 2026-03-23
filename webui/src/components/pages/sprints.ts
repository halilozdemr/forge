import { fetchSprints, Sprint } from '../../api/sprints';
import { EmptyState } from '../shared/empty-state';
import { SkeletonCard } from '../shared/skeleton';
import { esc } from '../../api/utils';

function relativeDate(dateStr?: string): string {
  if (!dateStr) return 'TBD';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.round((d.getTime() - now.getTime()) / 86400000);
  if (diff < 0) return `${Math.abs(diff)}d ago`;
  if (diff === 0) return 'today';
  return `in ${diff}d`;
}

export function SprintsPage() {
  const container = document.createElement('div');
  container.className = 'sprints-page';

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Sprints</h1>
        <p class="page-subtitle">Plan and track sprint cycles</p>
      </div>
      <button class="btn btn-primary" id="new-sprint-btn">+ New Sprint</button>
    </div>
    <div class="sprints-list" id="sprints-list"></div>
  `;

  const list = container.querySelector('#sprints-list') as HTMLElement;

  // Skeleton
  const skWrap = document.createElement('div');
  skWrap.className = 'overview-grid';
  for (let i = 0; i < 3; i++) skWrap.appendChild(SkeletonCard());
  list.appendChild(skWrap);

  fetchSprints().then((sprints: Sprint[]) => {
    list.innerHTML = '';

    if (sprints.length === 0) {
      list.appendChild(EmptyState({
        icon: '◷',
        title: 'No sprints yet',
        description: 'Create a sprint to start planning your work cycles.',
        action: { label: '+ New Sprint', onClick: () => {} },
      }));
      return;
    }

    sprints.forEach(sprint => {
      const statusColor =
        sprint.status === 'active' ? 'green' :
        sprint.status === 'planning' ? 'cyan' : 'gray';

      const card = document.createElement('div');
      card.className = 'card sprint-card';
      card.innerHTML = `
        <div class="sprint-header">
          <div>
            <div class="sprint-name">${esc(sprint.name)}</div>
            <div class="sprint-dates">
              ${sprint.startDate ? new Date(sprint.startDate).toLocaleDateString() : 'TBD'}
              →
              ${sprint.endDate ? new Date(sprint.endDate).toLocaleDateString() : 'TBD'}
              <span style="color:var(--text3);margin-left:8px">(ends ${relativeDate(sprint.endDate)})</span>
            </div>
          </div>
          <span class="badge badge-${statusColor}">${esc(sprint.status)}</span>
        </div>
        <div class="sprint-progress">
          <div class="sprint-progress-bar">
            <div class="sprint-progress-fill ${sprint.status === 'completed' ? 'done' : ''}"
              style="width:${sprint.status === 'completed' ? 100 : sprint.status === 'active' ? 45 : 0}%">
            </div>
          </div>
          <div class="sprint-progress-label">
            <span>Progress</span>
            <span>${sprint.status === 'completed' ? '100%' : sprint.status === 'active' ? '45%' : '0%'}</span>
          </div>
        </div>
        <div class="sprint-actions">
          <button class="btn btn-outline btn-sm">View Issues</button>
          ${sprint.status === 'planning' ? '<button class="btn btn-primary btn-sm">Start Sprint</button>' : ''}
        </div>
      `;
      list.appendChild(card);
    });
  }).catch(() => {
    list.innerHTML = '';
    list.appendChild(EmptyState({ icon: '⚠', title: 'Failed to load sprints', description: 'Check your connection and try again.' }));
  });

  return container;
}
