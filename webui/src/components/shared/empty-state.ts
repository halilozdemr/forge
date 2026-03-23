export interface EmptyStateOptions {
  icon?: string;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState(opts: EmptyStateOptions): HTMLElement {
  const el = document.createElement('div');
  el.className = 'empty-state';

  el.innerHTML = `
    ${opts.icon ? `<div class="empty-state-icon">${opts.icon}</div>` : ''}
    <div class="empty-state-title">${opts.title}</div>
    ${opts.description ? `<div class="empty-state-desc">${opts.description}</div>` : ''}
    ${opts.action ? `<button class="btn btn-secondary btn-sm" id="es-action">${opts.action.label}</button>` : ''}
  `;

  if (opts.action) {
    el.querySelector('#es-action')!.addEventListener('click', opts.action.onClick);
  }

  return el;
}
