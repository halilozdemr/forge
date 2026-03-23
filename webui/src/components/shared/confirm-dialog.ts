export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export function ConfirmDialog(opts: ConfirmOptions, onConfirm: () => void, onCancel?: () => void): HTMLElement {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'modal confirm-dialog';

  modal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${opts.title}</span>
    </div>
    <div class="modal-body">
      <p style="color: var(--text2); font-size: 13.5px; line-height: 1.6;">${opts.message}</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" id="cd-cancel">${opts.cancelLabel ?? 'Cancel'}</button>
      <button class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}" id="cd-confirm">${opts.confirmLabel ?? 'Confirm'}</button>
    </div>
  `;

  backdrop.appendChild(modal);

  const doClose = () => document.body.contains(backdrop) && document.body.removeChild(backdrop);

  modal.querySelector('#cd-cancel')!.addEventListener('click', () => { doClose(); onCancel?.(); });
  modal.querySelector('#cd-confirm')!.addEventListener('click', () => { doClose(); onConfirm(); });
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { doClose(); onCancel?.(); } });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { doClose(); onCancel?.(); window.removeEventListener('keydown', onKey); }
    if (e.key === 'Enter')  { doClose(); onConfirm(); window.removeEventListener('keydown', onKey); }
  };
  window.addEventListener('keydown', onKey);

  return backdrop;
}

export function showConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    const el = ConfirmDialog(opts, () => resolve(true), () => resolve(false));
    document.body.appendChild(el);
  });
}
