import { healthStore } from '../../store/store';

const NAV_ITEMS = [
  { href: '#/',            label: 'Overview',   icon: iconGrid() },
  { href: '#/workflows',   label: 'Workflows',  icon: iconWorkflows() },
  { href: '#/approvals',   label: 'Approvals',  icon: iconApprovals() },
  { href: '#/agents',      label: 'Agents',     icon: iconAgents() },
  { href: '#/queue',       label: 'Queue',      icon: iconQueue() },
  { href: '#/budget',      label: 'Budget',     icon: iconBudget() },
  { href: '#/settings',    label: 'Settings',   icon: iconSettings() },
];

export function Sidebar() {
  const nav = document.createElement('nav');
  nav.className = 'sidebar';

  nav.innerHTML = `
    <div class="sidebar-header">
      <div class="sidebar-logo-mark">F</div>
      <span class="sidebar-logo-text">Forge</span>
      <span class="sidebar-logo-badge">v3</span>
    </div>
    <div class="sidebar-nav scrollbar">
      <div class="sidebar-nav-label">Navigation</div>
      ${NAV_ITEMS.map(item => `
        <a href="${item.href}" class="sidebar-nav-link">
          ${item.icon}
          <span>${item.label}</span>
        </a>
      `).join('')}
    </div>
    <div class="sidebar-footer">
      <div class="sidebar-health-dot" id="sb-health-dot"></div>
      <span class="sidebar-health-text" id="sb-health-text">Checking...</span>
    </div>
  `;

  const dot = nav.querySelector('#sb-health-dot') as HTMLElement;
  const txt = nav.querySelector('#sb-health-text') as HTMLElement;

  healthStore.subscribe(status => {
    dot.className = 'sidebar-health-dot';
    if (!status) { txt.textContent = 'Checking...'; return; }
    if (status.status === 'healthy') {
      txt.textContent = 'All systems OK';
    } else if (status.status === 'degraded') {
      dot.classList.add('degraded');
      txt.textContent = 'Degraded';
    } else {
      dot.classList.add('down');
      txt.textContent = 'System down';
    }
  });

  const updateActive = () => {
    const hash = window.location.hash || '#/';
    nav.querySelectorAll('.sidebar-nav-link').forEach(a => {
      const href = a.getAttribute('href') ?? '';
      const isActive = href === '#/'
        ? hash === '#/'
        : hash === href || hash.startsWith(href + '/');
      a.classList.toggle('active', isActive);
    });
  };
  window.addEventListener('hashchange', updateActive);
  updateActive();

  return nav;
}

function iconApprovals() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 8a6 6 0 1012 0A6 6 0 002 8z"/>
    <path d="M5.5 8.5l2 2 3-3.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function iconWorkflows() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg">
    <rect x="1.5" y="2" width="4" height="3" rx="0.75"/>
    <rect x="6" y="2" width="4" height="3" rx="0.75"/>
    <rect x="10.5" y="2" width="4" height="3" rx="0.75"/>
    <path d="M3.5 5v2.5h4V5" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="3.5" y="7.5" width="4" height="3" rx="0.75"/>
    <path d="M5.5 10.5V13" stroke-linecap="round"/>
    <rect x="3.5" y="13" width="4" height="2" rx="0.75"/>
  </svg>`;
}

function iconGrid() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg">
    <rect x="1.5" y="1.5" width="5" height="5" rx="1"/><rect x="9.5" y="1.5" width="5" height="5" rx="1"/>
    <rect x="1.5" y="9.5" width="5" height="5" rx="1"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/>
  </svg>`;
}

function iconAgents() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="5.5" r="2.5"/><path d="M2.5 14c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/>
  </svg>`;
}

function iconQueue() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 4h12M2 8h8M2 12h5" stroke-linecap="round"/>
    <path d="M12 11l2 1.5L12 14" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function iconBudget() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="8" r="6"/>
    <path d="M8 4.5v1M8 10.5v1M6 6.5a2 2 0 014 0c0 1.5-2 2-2 3.5" stroke-linecap="round"/>
  </svg>`;
}

function iconSettings() {
  return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="8" r="5.5"/>
    <path d="M8 5v6M8 8h3M8 8H5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
  </svg>`;
}
