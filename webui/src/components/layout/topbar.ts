import { healthStore, activeJobsCount } from '../../store/store';

const ROUTE_LABELS: Record<string, string> = {
  '#/':        'Overview',
  '#/agents':  'Agents',
  '#/issues':  'Issues',
  '#/sprints': 'Sprints',
  '#/queue':   'Queue',
  '#/budget':  'Budget',
};

export function Topbar() {
  const header = document.createElement('header');
  header.className = 'topbar';

  // Left — breadcrumb
  const left = document.createElement('div');
  left.className = 'topbar-left';
  left.innerHTML = `
    <div class="breadcrumb">
      <span>Forge</span>
      <span class="breadcrumb-sep">/</span>
      <span class="breadcrumb-current" id="topbar-page">Overview</span>
    </div>
  `;

  // Right — jobs count + health badge + ⌘K
  const right = document.createElement('div');
  right.className = 'topbar-right';
  right.innerHTML = `
    <div class="topbar-jobs-badge" id="topbar-jobs" style="display:none">
      <span class="dot pulse"></span>
      <span id="topbar-jobs-count">0</span> active
    </div>
    <div id="topbar-health"></div>
    <button class="topbar-kbd-btn" id="topbar-cmd-btn" title="Open command palette">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="6.5" cy="6.5" r="4.5"/><path d="M11 11l3 3" stroke-linecap="round"/>
      </svg>
      <span>Search</span>
      <kbd>⌘K</kbd>
    </button>
  `;

  header.appendChild(left);
  header.appendChild(right);

  // Reactive: page label
  const pageEl = left.querySelector('#topbar-page') as HTMLElement;
  const updatePage = () => {
    const hash = window.location.hash || '#/';
    pageEl.textContent = ROUTE_LABELS[hash] ?? 'Overview';
  };
  window.addEventListener('hashchange', updatePage);
  updatePage();

  // Reactive: health badge
  const healthEl = right.querySelector('#topbar-health') as HTMLElement;
  healthStore.subscribe(status => {
    if (!status) {
      healthEl.innerHTML = '<span class="badge badge-amber">Checking</span>';
      return;
    }
    const color = status.status === 'healthy' ? 'green' : status.status === 'degraded' ? 'amber' : 'red';
    healthEl.innerHTML = `<span class="badge badge-${color}">${status.status}</span>`;
  });

  // Reactive: active jobs
  const jobsBadge = right.querySelector('#topbar-jobs') as HTMLElement;
  const jobsCount = right.querySelector('#topbar-jobs-count') as HTMLElement;
  activeJobsCount.subscribe(count => {
    jobsBadge.style.display = count > 0 ? 'flex' : 'none';
    jobsCount.textContent = String(count);
  });

  // ⌘K button → dispatch custom event (CommandPalette listens)
  const cmdBtn = right.querySelector('#topbar-cmd-btn') as HTMLButtonElement;
  cmdBtn.onclick = () => window.dispatchEvent(new CustomEvent('forge:open-palette'));

  return header;
}
