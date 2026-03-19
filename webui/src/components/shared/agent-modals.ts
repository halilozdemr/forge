import { hireAgent, fetchAgents } from '../../api/agents';
import { addToast } from './toast';
import { Agent } from '../../store/store';

export function HireAgentModal(onClose: () => void) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <h2>Hire New Agent</h2>
    <form id="hire-form" style="display: flex; flex-direction: column; gap: 16px; margin-top: 16px;">
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <label>Slug (unique ID)</label>
        <input type="text" name="slug" placeholder="e.g. architect" required>
      </div>
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <label>Name</label>
        <input type="text" name="name" placeholder="e.g. Senior Architect" required>
      </div>
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <label>Model</label>
        <select name="model">
          <option value="bridge/claude-cli-sonnet">Claude 3.5 Sonnet</option>
          <option value="openrouter/deepseek/deepseek-chat">DeepSeek V3</option>
          <option value="openrouter/google/gemini-2.0-flash-001">Gemini 2.0 Flash</option>
        </select>
      </div>
      <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 8px;">
        <button type="button" class="btn btn-outline" id="cancel-btn">Cancel</button>
        <button type="submit" class="btn btn-primary" id="submit-btn">Hire Agent</button>
      </div>
    </form>
  `;

  backdrop.appendChild(modal);

  const form = modal.querySelector('#hire-form') as HTMLFormElement;
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
    submitBtn.innerText = 'Hiring...';

    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    
    try {
      await hireAgent(data as Partial<Agent>);
      addToast(`Agent ${data.slug} hired successfully`, 'success');
      fetchAgents();
      doClose();
    } catch (err) {
      addToast(`Failed to hire agent: ${err}`, 'error');
      submitBtn.disabled = false;
      submitBtn.innerText = 'Hire Agent';
    }
  };

  return backdrop;
}
