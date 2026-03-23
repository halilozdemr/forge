import { Issue } from '../../store/store';
import { esc } from '../../api/utils';

const TYPE_COLOR: Record<string, string> = {
  feature:  'blue',
  bug:      'red',
  refactor: 'purple',
  release:  'green',
  chore:    'gray',
};

export function IssueCard(issue: Issue) {
  const card = document.createElement('div');
  card.className = 'card issue-card';
  card.draggable = true;
  card.dataset.id = issue.id;

  const typeColor = TYPE_COLOR[issue.type] ?? 'gray';
  const idShort = issue.id.slice(0, 6).toUpperCase();

  card.innerHTML = `
    <div class="issue-card-header">
      <span class="badge badge-${typeColor}">${esc(issue.type)}</span>
      <span class="issue-id">${esc(idShort)}</span>
    </div>
    <div class="issue-card-title">${esc(issue.title)}</div>
    <div class="issue-card-footer">
      <span class="issue-assignee">${esc(issue.assignedTo || 'Unassigned')}</span>
    </div>
  `;

  return card;
}
