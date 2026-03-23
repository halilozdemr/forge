import { fetchAgents, hireAgent, updateAgent } from '../../api/agents';
import { esc } from '../../api/utils';
import { addToast } from './toast';
import { Agent } from '../../store/store';

const MODELS = [
  { provider: 'claude-cli', model: 'sonnet',        label: 'Claude Sonnet',      color: 'var(--purple)' },
  { provider: 'codex-cli', model: 'gpt-5.4',        label: 'GPT-5.4',            color: 'var(--cyan)' },
  { provider: 'codex-cli', model: 'gpt-5.3-codex',  label: 'GPT-5.3 Codex',      color: 'var(--primary)' },
  { provider: 'opencode-cli', model: 'default',     label: 'OpenCode (default)', color: 'var(--green)' },
];

const EDITABLE_STATUSES: Agent['status'][] = ['idle', 'active', 'paused'];

function attachModalCloseHandlers(backdrop: HTMLDivElement, modal: HTMLDivElement, onClose: () => void) {
  const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') doClose(); };
  window.addEventListener('keydown', handleEscape);

  const doClose = () => {
    onClose();
    window.removeEventListener('keydown', handleEscape);
  };

  modal.querySelector('#modal-x')?.addEventListener('click', doClose);
  modal.querySelector('#cancel-btn')?.addEventListener('click', doClose);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) doClose();
  });

  return doClose;
}

function normalizeOptionalText(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readPermissions(agent: Agent): string {
  if (typeof agent.permissions === 'string' && agent.permissions.trim().length > 0) {
    try {
      return JSON.stringify(JSON.parse(agent.permissions), null, 2);
    } catch {
      return agent.permissions;
    }
  }

  if (agent.permissions && typeof agent.permissions === 'object') {
    return JSON.stringify(agent.permissions, null, 2);
  }

  return '{\n  "read": true\n}';
}

function parsePermissions(value: string): Record<string, boolean> {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Permissions must be a JSON object.');
  }

  for (const [key, entry] of Object.entries(parsed)) {
    if (typeof entry !== 'boolean') {
      throw new Error(`permissions.${key} must be boolean.`);
    }
  }

  return parsed as Record<string, boolean>;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null) {
    const data = (error as { data?: { error?: string; message?: string } }).data;
    if (data?.error) return data.error;
    if (data?.message) return data.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

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
  const doClose = attachModalCloseHandlers(backdrop, modal, onClose);

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

export function EditAgentModal(agent: Agent, onClose: () => void) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'modal';

  modal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">Edit Agent</span>
      <button class="modal-close" id="modal-x">&times;</button>
    </div>
    <form id="edit-form">
      <div class="modal-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-group">
            <label class="form-label">Slug</label>
            <input type="text" value="${esc(agent.slug)}" disabled />
            <span class="form-hint">Agent slug is immutable.</span>
          </div>
          <div class="form-group">
            <label class="form-label">Status</label>
            <select name="status">
              ${EDITABLE_STATUSES.map((status) => `
                <option value="${status}" ${agent.status === status ? 'selected' : ''}>${status}</option>
              `).join('')}
            </select>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-group">
            <label class="form-label">Name <span style="color:var(--red)">*</span></label>
            <input type="text" name="name" value="${esc(agent.name)}" required autocomplete="off" />
          </div>
          <div class="form-group">
            <label class="form-label">Role <span style="color:var(--red)">*</span></label>
            <input type="text" name="role" value="${esc(agent.role ?? '')}" required autocomplete="off" />
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-group">
            <label class="form-label">Provider <span style="color:var(--red)">*</span></label>
            <input type="text" name="modelProvider" value="${esc(agent.modelProvider ?? '')}" required autocomplete="off" />
          </div>
          <div class="form-group">
            <label class="form-label">Model <span style="color:var(--red)">*</span></label>
            <input type="text" name="model" value="${esc(agent.model)}" required autocomplete="off" />
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-group">
            <label class="form-label">Reports To</label>
            <input type="text" name="reportsTo" value="${esc(agent.reportsTo ?? '')}" placeholder="blank clears the value" autocomplete="off" />
          </div>
          <div class="form-group">
            <label class="form-label">Heartbeat Cron</label>
            <input type="text" name="heartbeatCron" value="${esc(agent.heartbeatCron ?? '')}" placeholder="blank clears the value" autocomplete="off" />
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-group">
            <label class="form-label">Prompt File</label>
            <input type="text" name="promptFile" value="${esc(agent.promptFile ?? '')}" placeholder="blank clears the value" autocomplete="off" />
          </div>
          <div class="form-group">
            <label class="form-label">Max Concurrent</label>
            <input type="number" min="1" step="1" name="maxConcurrent" value="${agent.maxConcurrent ?? 1}" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Permissions JSON</label>
          <textarea name="permissions" rows="7" style="font-family:var(--font-mono);font-size:12px;resize:vertical">${esc(readPermissions(agent))}</textarea>
          <span class="form-hint">Boolean map, for example <code>{"read": true, "task": true}</code>.</span>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" id="cancel-btn">Cancel</button>
        <button type="submit" class="btn btn-primary" id="submit-btn">Save Changes</button>
      </div>
    </form>
  `;

  backdrop.appendChild(modal);

  const form = modal.querySelector('#edit-form') as HTMLFormElement;
  const submitBtn = modal.querySelector('#submit-btn') as HTMLButtonElement;
  const doClose = attachModalCloseHandlers(backdrop, modal, onClose);

  form.onsubmit = async (e) => {
    e.preventDefault();

    const fd = new FormData(form);
    const payload: Record<string, unknown> = {};

    const name = String(fd.get('name') ?? '').trim();
    const role = String(fd.get('role') ?? '').trim();
    const modelProvider = String(fd.get('modelProvider') ?? '').trim();
    const model = String(fd.get('model') ?? '').trim();
    const status = String(fd.get('status') ?? '').trim() as Agent['status'];
    const reportsTo = normalizeOptionalText(fd.get('reportsTo'));
    const heartbeatCron = normalizeOptionalText(fd.get('heartbeatCron'));
    const promptFile = normalizeOptionalText(fd.get('promptFile'));
    const maxConcurrent = Number.parseInt(String(fd.get('maxConcurrent') ?? ''), 10);
    const permissionsRaw = String(fd.get('permissions') ?? '').trim();

    if (name !== agent.name) payload.name = name;
    if (role !== (agent.role ?? '')) payload.role = role;
    if (modelProvider !== (agent.modelProvider ?? '')) payload.modelProvider = modelProvider;
    if (model !== agent.model) payload.model = model;
    if (status !== agent.status) payload.status = status;
    if (reportsTo !== (agent.reportsTo ?? null)) payload.reportsTo = reportsTo;
    if (heartbeatCron !== (agent.heartbeatCron ?? null)) payload.heartbeatCron = heartbeatCron;
    if (promptFile !== (agent.promptFile ?? null)) payload.promptFile = promptFile;
    if (!Number.isNaN(maxConcurrent) && maxConcurrent !== (agent.maxConcurrent ?? 1)) payload.maxConcurrent = maxConcurrent;

    try {
      const nextPermissions = parsePermissions(permissionsRaw);
      const currentPermissions = parsePermissions(readPermissions(agent));
      if (JSON.stringify(nextPermissions) !== JSON.stringify(currentPermissions)) {
        payload.permissions = nextPermissions;
      }
    } catch (error) {
      addToast(getErrorMessage(error, 'Permissions JSON is invalid'), 'error');
      return;
    }

    if (Object.keys(payload).length === 0) {
      addToast('No changes to save', 'info');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    try {
      await updateAgent(agent.slug, payload);
      addToast(`Agent ${agent.slug} updated`, 'success');
      await fetchAgents();
      doClose();
    } catch (error) {
      addToast(getErrorMessage(error, 'Failed to update agent'), 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save Changes';
    }
  };

  return backdrop;
}
