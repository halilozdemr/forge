import { Issue } from '../../store/store';
import { esc } from '../../api/utils';

export function IssueCard(issue: Issue) {
  const card = document.createElement('div');
  card.className = 'card issue-card';
  card.draggable = true;
  card.dataset.id = issue.id;
  
  const typeColors: Record<string, string> = {
    feature: 'green',
    bug: 'red',
    refactor: 'indigo',
    release: 'amber',
    chore: 'text2'
  };
  const typeColor = typeColors[issue.type] || 'text2';

  card.innerHTML = `
    <div class="issue-card-header">
      <span class="badge badge-${typeColor}">${esc(issue.type)}</span>
      <span class="issue-id">#${esc(issue.id.slice(0, 4))}</span>
    </div>
    <div class="issue-card-title">${esc(issue.title)}</div>
    <div class="issue-card-footer">
      <span class="issue-assignee">${esc(issue.assignedTo || 'Unassigned')}</span>
    </div>
  `;

  return card;
}
