import { createIssue, fetchIssues } from '../../api/issues';
import { addToast } from './toast';
import { agentsStore, Issue } from '../../store/store';
import { esc } from '../../api/utils';

export function CreateIssueModal(onClose: () => void) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'modal';

  const agents = agentsStore.value;

  modal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">Create Issue</span>
      <button class="modal-close" id="modal-x">×</button>
    </div>
    <form id="issue-form">
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Title <span style="color:var(--red)">*</span></label>
          <input type="text" name="title" placeholder="e.g. Implement auth flow" required autocomplete="off"/>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-group">
            <label class="form-label">Type</label>
            <select name="type">
              <option value="feature">Feature</option>
              <option value="bug">Bug</option>
              <option value="refactor">Refactor</option>
              <option value="release">Release</option>
              <option value="chore">Chore</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Priority</label>
            <select name="priority">
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea name="description" rows="3" placeholder="Optional description..."></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Assignee</label>
          <select name="assignedTo">
            <option value="">Unassigned</option>
            ${agents.map(a => `<option value="${esc(a.slug)}">${esc(a.name)} (${esc(a.slug)})</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" id="cancel-btn">Cancel</button>
        <button type="submit" class="btn btn-primary" id="submit-btn">Create Issue</button>
      </div>
    </form>
  `;

  backdrop.appendChild(modal);

  const form = modal.querySelector('#issue-form') as HTMLFormElement;
  const submitBtn = modal.querySelector('#submit-btn') as HTMLButtonElement;

  const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') doClose(); };
  window.addEventListener('keydown', handleEscape);

  const doClose = () => { onClose(); window.removeEventListener('keydown', handleEscape); };

  modal.querySelector('#modal-x')!.addEventListener('click', doClose);
  modal.querySelector('#cancel-btn')!.addEventListener('click', doClose);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) doClose(); });

  form.onsubmit = async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      await createIssue({ ...data, status: 'open' } as Partial<Issue>);
      addToast('Issue created', 'success');
      fetchIssues();
      doClose();
    } catch {
      addToast('Failed to create issue', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Issue';
    }
  };

  return backdrop;
}
