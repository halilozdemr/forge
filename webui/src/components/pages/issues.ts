import { issuesStore, Issue } from '../../store/store';
import { fetchIssues, updateIssue } from '../../api/issues';
import { IssueCard } from '../shared/issue-card';
import { addToast } from '../shared/toast';
import { CreateIssueModal } from '../shared/issue-modals';
import { esc } from '../../api/utils';

export function IssuesPage() {
  const container = document.createElement('div');
  container.className = 'issues-page';
  
  const header = document.createElement('div');
  header.className = 'page-header';
  header.innerHTML = `
    <h1>Issue Board</h1>
    <button class="btn btn-primary" id="create-issue-btn">+ Create Issue</button>
  `;
  container.appendChild(header);

  const createBtn = header.querySelector('#create-issue-btn') as HTMLButtonElement;
  createBtn.onclick = () => {
    const modal = CreateIssueModal(() => document.body.removeChild(modal));
    document.body.appendChild(modal);
  };

  const board = document.createElement('div');
  board.className = 'kanban-board';
  
  const columns = [
    { id: 'open', label: 'Open' },
    { id: 'in_progress', label: 'In Progress' },
    { id: 'review', label: 'Review' },
    { id: 'done', label: 'Done' }
  ];

  board.innerHTML = columns.map(col => `
    <div class="kanban-column" data-status="${esc(col.id)}">
      <div class="kanban-column-header">
        <h2>${esc(col.label)}</h2>
        <span class="count">0</span>
      </div>
      <div class="kanban-column-content scrollbar"></div>
    </div>
  `).join('');

  issuesStore.subscribe(issues => {
    columns.forEach(col => {
      const colEl = board.querySelector(`[data-status="${col.id}"] .kanban-column-content`) as HTMLElement;
      const countEl = board.querySelector(`[data-status="${col.id}"] .count`) as HTMLElement;
      
      const colIssues = issues.filter(i => i.status === col.id);
      countEl.innerText = colIssues.length.toString();
      
      colEl.innerHTML = '';
      colIssues.forEach(issue => {
        const card = IssueCard(issue);
        
        // Drag and Drop Logic
        card.addEventListener('dragstart', (e: Event) => {
          const de = e as DragEvent;
          de.dataTransfer?.setData('text/plain', issue.id);
          card.classList.add('dragging');
        });
        
        card.addEventListener('dragend', () => {
          card.classList.remove('dragging');
        });

        colEl.appendChild(card);
      });
    });
  });

  // Drop zone logic
  board.querySelectorAll('.kanban-column-content').forEach(colContent => {
    colContent.addEventListener('dragover', (e) => {
      e.preventDefault();
      colContent.classList.add('drag-over');
    });

    colContent.addEventListener('dragleave', () => {
      colContent.classList.remove('drag-over');
    });

    colContent.addEventListener('drop', async (e: Event) => {
      const de = e as DragEvent;
      e.preventDefault();
      colContent.classList.remove('drag-over');
      const id = de.dataTransfer?.getData('text/plain');
      const newStatus = (colContent.parentElement as HTMLElement).dataset.status as Issue['status'];
      
      if (id && newStatus) {
        try {
          await updateIssue(id, { status: newStatus });
          addToast(`Issue #${id.slice(0, 4)} moved to ${newStatus}`, 'success');
          fetchIssues();
        } catch (err) {
          addToast(`Failed to move issue: ${err}`, 'error');
        }
      }
    });
  });

  fetchIssues(); // Initial fetch
  
  container.appendChild(board);
  return container;
}
