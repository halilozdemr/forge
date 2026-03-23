import { hireAgent, fetchAgents } from '../../api/agents';
import { addToast } from './toast';
import { Agent } from '../../store/store';

const MODELS = [
  { provider: 'claude-cli', model: 'sonnet',              label: 'Claude Sonnet',    color: 'var(--purple)' },
  { provider: 'openrouter', model: 'deepseek/deepseek-chat', label: 'DeepSeek V3',     color: 'var(--cyan)' },
  { provider: 'openrouter', model: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash', color: 'var(--primary)' },
];

export function HireAgentModal(onClose: () => void) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'modal';

  modal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">Hire Agent</span>
      <button class="modal-close" id="modal-x">&times;</button>
    </div>
    <form id="hire-form">
      <div class="modal-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-group">
            <label class="form-label">Slug <span style="color:var(--red)">*</span></label>
            <input type="text" name="slug" placeholder="e.g. architect" required autocomplete="off"
              pattern="[a-z0-9-]+" title="lowercase letters, numbers, hyphens only"/>
            <span class="form-hint">Unique identifier &middot; lowercase</span>
          </div>
          <div class="form-group">
            <label class="form-label">Name <span style="color:var(--red)">*</span></label>
            <input type="text" name="name" placeholder="e.g. Senior Architect" required autocomplete="off"/>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Role</label>
          <input type="text" name="role" placeholder="e.g. architect, engineer, reviewer" autocomplete="off"/>
          <span class="form-hint">Agent role for orchestrator pipeline matching</span>
        </div>
        <div class="form-group">
          <label class="form-label">Model</label>
          <select name="modelIndex" id="model-select">
            ${MODELS.map((m, i) => `<option value="${i}">${m.label}</option>`).join('')}
          </select>
          <div id="model-preview" style="margin-top:6px;display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text3)">
            <span style="width:8px;height:8px;border-radius:50%;background:var(--purple);display:inline-block"></span>
            Claude Sonnet
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">System Prompt <span style="color:var(--text3);font-weight:400">(optional)</span></label>
          <textarea name="systemPrompt" rows="4"
            placeholder="Custom instructions for this agent... e.g. You are a senior backend engineer specialized in TypeScript and Node.js."
            style="font-family:var(--font-mono);font-size:12px;resize:vertical"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" id="cancel-btn">Cancel</button>
        <button type="submit" class="btn btn-primary" id="submit-btn">Hire Agent</button>
      </div>
    </form>
  `;

  backdrop.appendChild(modal);

  // Model preview update
  const modelSelect = modal.querySelector('#model-select') as HTMLSelectElement;
  const modelPreview = modal.querySelector('#model-preview') as HTMLElement;
  modelSelect.addEventListener('change', () => {
    const m = MODELS[parseInt(modelSelect.value)];
    if (m) modelPreview.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${m.color};display:inline-block"></span> ${m.label}`;
  });

  const form = modal.querySelector('#hire-form') as HTMLFormElement;
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
    submitBtn.textContent = 'Hiring...';
    const fd = new FormData(form);
    const selectedModel = MODELS[parseInt(fd.get('modelIndex') as string) || 0];
    const agentData: Partial<Agent> = {
      slug: fd.get('slug') as string,
      name: fd.get('name') as string,
      role: (fd.get('role') as string) || (fd.get('name') as string),
      model: selectedModel.model,
      modelProvider: selectedModel.provider,
      systemPrompt: fd.get('systemPrompt') as string || undefined,
    };
    try {
      await hireAgent(agentData);
      addToast(`Agent ${agentData.slug} hired`, 'success');
      fetchAgents();
      doClose();
    } catch {
      addToast('Failed to hire agent', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Hire Agent';
    }
  };

  return backdrop;
}
