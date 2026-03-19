import { createIssue, fetchIssues } from '../../api/issues';
import { addToast } from './toast';
import { agentsStore, Issue } from '../../store/store';

export function CreateIssueModal(onClose: () => void) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  
  const modal = document.createElement('div');
  modal.className = 'modal';
  
  const agents = agentsStore.value;

  modal.innerHTML = `
    <h2>Create New Issue</h2>
    <form id="issue-form" style="display: flex; flex-direction: column; gap: 16px; margin-top: 16px;">
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <label>Title</label>
        <input type="text" name="title" placeholder="e.g. Implement auth flow" required>
      </div>
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <label>Type</label>
        <select name="type">
          <option value="feature">Feature</option>
          <option value="bug">Bug</option>
          <option value="refactor">Refactor</option>
          <option value="release">Release</option>
          <option value="chore">Chore</option>
        </select>
      </div>
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <label>Assignee</label>
        <select name="assignedTo">
          <option value="">Unassigned</option>
          ${agents.map(a => `<option value="${a.slug}">${a.name} (${a.slug})</option>`).join('')}
        </select>
      </div>
      <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 8px;">
        <button type="button" class="btn btn-outline" id="cancel-btn">Cancel</button>
        <button type="submit" class="btn btn-primary" id="submit-btn">Create Issue</button>
      </div>
    </form>
  `;

  backdrop.appendChild(modal);

  const form = modal.querySelector('#issue-form') as HTMLFormElement;
  const cancelBtn = modal.querySelector('#cancel-btn') as HTMLButtonElement;
  const submitBtn = modal.querySelector('#submit-btn') as HTMLButtonElement;

  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      window.removeEventListener('keydown', handleEscape);
    }
  };
  window.addEventListener('keydown', handleEscape);

  const doClose = () => {
    onClose();
    window.removeEventListener('keydown', handleEscape);
  };

  cancelBtn.onclick = doClose;
  backdrop.onclick = (e) => { if (e.target === backdrop) doClose(); };

  form.onsubmit = async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.innerText = 'Creating...';

    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    
    try {
      await createIssue({ ...data, status: 'open' } as Partial<Issue>);
      addToast(`Issue created successfully`, 'success');
      fetchIssues();
      doClose();
    } catch (err) {
      addToast(`Failed to create issue: ${err}`, 'error');
      submitBtn.disabled = false;
      submitBtn.innerText = 'Create Issue';
    }
  };

  return backdrop;
}
