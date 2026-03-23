import { logsStore, type LogEntry } from '../../store/store';

const AGENT_COLORS: Record<string, string> = {
  pm:           'var(--primary)',
  architect:    'var(--purple)',
  builder:      'var(--green)',
  engineer:     'var(--green)',
  reviewer:     'var(--amber)',
  devops:       'var(--cyan)',
  debugger:     'var(--red)',
  designer:     'var(--claude)',
  scrum_master: 'var(--text3)',
};

function agentColor(slug: string): string {
  return AGENT_COLORS[slug] ?? 'var(--text2)';
}

function formatTime(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 8);
}

export function LiveLogs(): HTMLElement {
  let isOpen = false;
  let autoScroll = true;
  let unsubscribe: (() => void) | null = null;

  const panel = document.createElement('div');
  panel.className = 'live-logs-panel';
  panel.setAttribute('aria-label', 'Live agent logs');

  panel.innerHTML = `
    <div class="live-logs-header" id="ll-header">
      <div class="live-logs-title">
        <span class="live-logs-dot" id="ll-dot"></span>
        <span>Agent Logs</span>
        <span class="live-logs-count" id="ll-count">0</span>
      </div>
      <div class="live-logs-actions">
        <button class="live-logs-btn" id="ll-clear" title="Clear logs">✕ Clear</button>
        <button class="live-logs-btn" id="ll-autoscroll" title="Toggle auto-scroll">↓ Auto</button>
        <button class="live-logs-btn live-logs-toggle" id="ll-toggle" title="Toggle panel">▲</button>
      </div>
    </div>
    <div class="live-logs-body" id="ll-body">
      <div class="live-logs-lines" id="ll-lines"></div>
    </div>
  `;

  const header  = panel.querySelector('#ll-header') as HTMLElement;
  const dot     = panel.querySelector('#ll-dot') as HTMLElement;
  const count   = panel.querySelector('#ll-count') as HTMLElement;
  const body    = panel.querySelector('#ll-body') as HTMLElement;
  const lines   = panel.querySelector('#ll-lines') as HTMLElement;
  const toggle  = panel.querySelector('#ll-toggle') as HTMLButtonElement;
  const clearBtn= panel.querySelector('#ll-clear') as HTMLButtonElement;
  const autoBtn = panel.querySelector('#ll-autoscroll') as HTMLButtonElement;

  function setOpen(open: boolean) {
    isOpen = open;
    panel.classList.toggle('live-logs-open', open);
    toggle.textContent = open ? '▼' : '▲';
    body.style.display = open ? 'flex' : 'none';
  }

  function renderLine(entry: LogEntry) {
    const el = document.createElement('div');
    el.className = 'll-line';
    el.innerHTML =
      `<span class="ll-ts">${formatTime(entry.ts)}</span>` +
      `<span class="ll-agent" style="color:${agentColor(entry.agentSlug)}">@${entry.agentSlug}</span>` +
      `<span class="ll-text">${escapeHtml(entry.line)}</span>`;
    return el;
  }

  function renderAll(entries: LogEntry[]) {
    lines.innerHTML = '';
    const frag = document.createDocumentFragment();
    entries.forEach(e => frag.appendChild(renderLine(e)));
    lines.appendChild(frag);
    count.textContent = String(entries.length);
    if (autoScroll) lines.scrollTop = lines.scrollHeight;
  }

  function appendLine(entry: LogEntry) {
    lines.appendChild(renderLine(entry));
    count.textContent = String(logsStore.value.length);
    // trim DOM if too many nodes
    while (lines.childElementCount > 300) {
      lines.removeChild(lines.firstElementChild!);
    }
    if (autoScroll) lines.scrollTop = lines.scrollHeight;
    // pulse the dot
    dot.classList.remove('ll-dot-pulse');
    void dot.offsetWidth;
    dot.classList.add('ll-dot-pulse');
  }

  // Subscribe
  let prevLen = 0;
  unsubscribe = logsStore.subscribe((entries) => {
    if (entries.length === 0) {
      renderAll([]);
      prevLen = 0;
      return;
    }
    if (entries.length < prevLen) {
      // cleared
      renderAll(entries);
    } else {
      // append new entries only
      for (let i = prevLen; i < entries.length; i++) {
        appendLine(entries[i]);
      }
    }
    prevLen = entries.length;
  });

  // Toggle open/close
  toggle.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!isOpen); });
  header.addEventListener('click', () => setOpen(!isOpen));
  toggle.addEventListener('click', (e) => e.stopPropagation()); // prevent double-fire

  // Clear
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    logsStore.set([]);
  });

  // Auto-scroll toggle
  autoScroll = true;
  autoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    autoScroll = !autoScroll;
    autoBtn.classList.toggle('live-logs-btn-active', autoScroll);
    if (autoScroll) lines.scrollTop = lines.scrollHeight;
  });
  autoBtn.classList.add('live-logs-btn-active');

  // Cleanup on removal
  panel.addEventListener('disconnected', () => unsubscribe?.());

  setOpen(false);
  return panel;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
