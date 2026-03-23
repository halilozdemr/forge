import { issuesStore, Issue } from '../../store/store';
import { fetchIssues, updateIssue } from '../../api/issues';
import { IssueCard } from '../shared/issue-card';
import { addToast } from '../shared/toast';
import { CreateIssueModal } from '../shared/issue-modals';
import { EmptyState } from '../shared/empty-state';
import { SkeletonIssueCard } from '../shared/skeleton';
import { esc } from '../../api/utils';

const COLUMNS = [
  { id: 'open',        label: 'Open' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'review',      label: 'Review' },
  { id: 'done',        label: 'Done' },
];

export function IssuesPage() {
  const container = document.createElement('div');
  container.className = 'issues-page';

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Issues</h1>
        <p class="page-subtitle">Kanban board</p>
      </div>
      <button class="btn btn-primary" id="create-issue-btn">+ Create Issue</button>
    </div>
    <div class="kanban-board">
      ${COLUMNS.map(col => `
        <div class="kanban-column" data-status="${esc(col.id)}">
          <div class="kanban-column-header">
            <h2>${esc(col.label)}</h2>
            <span class="count">0</span>
          </div>
          <div class="kanban-column-content scrollbar"></div>
        </div>
      `).join('')}
    </div>
  `;

  container.querySelector('#create-issue-btn')!.addEventListener('click', () => {
    const modal = CreateIssueModal(() => document.body.removeChild(modal));
    document.body.appendChild(modal);
  });

  const board = container.querySelector('.kanban-board') as HTMLElement;

  // Skeleton placeholders
  COLUMNS.forEach(col => {
    const content = board.querySelector(`[data-status="${col.id}"] .kanban-column-content`) as HTMLElement;
    for (let i = 0; i < 2; i++) content.appendChild(SkeletonIssueCard());
  });

  issuesStore.subscribe(issues => {
    COLUMNS.forEach(col => {
      const content = board.querySelector(`[data-status="${col.id}"] .kanban-column-content`) as HTMLElement;
      const countEl = board.querySelector(`[data-status="${col.id}"] .count`) as HTMLElement;
      const colIssues = issues.filter(i => i.status === col.id);
      countEl.textContent = String(colIssues.length);
      content.innerHTML = '';

      if (colIssues.length === 0) {
        content.appendChild(EmptyState({ title: 'No issues', description: `Drop issues here` }));
        return;
      }

      colIssues.forEach(issue => {
        const card = IssueCard(issue);
        card.addEventListener('dragstart', (e: Event) => {
          (e as DragEvent).dataTransfer?.setData('text/plain', issue.id);
          card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
        content.appendChild(card);
      });
    });
  });

  board.querySelectorAll('.kanban-column-content').forEach(col => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', async (e: Event) => {
      const de = e as DragEvent;
      e.preventDefault();
      col.classList.remove('drag-over');
      const id = de.dataTransfer?.getData('text/plain');
      const newStatus = (col.parentElement as HTMLElement).dataset.status as Issue['status'];
      if (id && newStatus) {
        try {
          await updateIssue(id, { status: newStatus });
          addToast(`Issue moved to ${newStatus}`, 'success');
          fetchIssues();
        } catch {
          addToast('Failed to move issue', 'error');
        }
      }
    });
  });

  fetchIssues();
  return container;
}
