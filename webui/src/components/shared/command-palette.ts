import { router } from '../../router/router';

interface PaletteItem {
  icon: string;
  label: string;
  group: string;
  action: () => void;
}

const ITEMS: PaletteItem[] = [
  { icon: '⊞', label: 'Overview',        group: 'Pages', action: () => router.navigate('#/') },
  { icon: '◉', label: 'Agents',          group: 'Pages', action: () => router.navigate('#/agents') },
  { icon: '⊡', label: 'Issues',          group: 'Pages', action: () => router.navigate('#/issues') },
  { icon: '◷', label: 'Sprints',         group: 'Pages', action: () => router.navigate('#/sprints') },
  { icon: '↗', label: 'Queue',           group: 'Pages', action: () => router.navigate('#/queue') },
  { icon: '$', label: 'Budget',          group: 'Pages', action: () => router.navigate('#/budget') },
];

export function CommandPalette(): HTMLElement {
  const backdrop = document.createElement('div');
  backdrop.className = 'command-palette-backdrop';
  backdrop.style.display = 'none';

  let selectedIdx = 0;
  let filtered = [...ITEMS];

  backdrop.innerHTML = `
    <div class="command-palette">
      <div class="command-palette-input-wrap">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="6.5" cy="6.5" r="4"/><path d="M10 10l3.5 3.5" stroke-linecap="round"/>
        </svg>
        <input class="command-palette-input" id="cp-input" placeholder="Search pages, actions..." autocomplete="off" spellcheck="false"/>
      </div>
      <div class="command-palette-list scrollbar" id="cp-list"></div>
      <div class="command-palette-footer">
        <span><kbd>↑↓</kbd> Navigate</span>
        <span><kbd>↵</kbd> Select</span>
        <span><kbd>Esc</kbd> Close</span>
      </div>
    </div>
  `;

  const input = backdrop.querySelector('#cp-input') as HTMLInputElement;
  const list = backdrop.querySelector('#cp-list') as HTMLElement;

  const render = () => {
    list.innerHTML = '';
    const groups = [...new Set(filtered.map(i => i.group))];
    groups.forEach(group => {
      const groupItems = filtered.filter(i => i.group === group);
      const label = document.createElement('div');
      label.className = 'command-palette-group-label';
      label.textContent = group;
      list.appendChild(label);

      groupItems.forEach(item => {
        const globalIdx = filtered.indexOf(item);
        const el = document.createElement('div');
        el.className = `command-palette-item${globalIdx === selectedIdx ? ' selected' : ''}`;
        el.innerHTML = `
          <div class="command-palette-item-icon">${item.icon}</div>
          <span>${item.label}</span>
        `;
        el.addEventListener('click', () => { item.action(); close(); });
        list.appendChild(el);
      });
    });
  };

  const open = () => {
    backdrop.style.display = 'flex';
    input.value = '';
    filtered = [...ITEMS];
    selectedIdx = 0;
    render();
    requestAnimationFrame(() => input.focus());
  };

  const close = () => {
    backdrop.style.display = 'none';
    input.value = '';
  };

  input.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    filtered = q ? ITEMS.filter(i => i.label.toLowerCase().includes(q)) : [...ITEMS];
    selectedIdx = 0;
    render();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, filtered.length - 1); render(); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); render(); }
    if (e.key === 'Enter' && filtered[selectedIdx]) { filtered[selectedIdx].action(); close(); }
    if (e.key === 'Escape') close();
  });

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  window.addEventListener('forge:open-palette', open);

  return backdrop;
}
