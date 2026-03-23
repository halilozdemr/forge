import { Signal } from '../../store/store';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
}

export const toastsStore = new Signal<Toast[]>([]);

export function addToast(message: string, type: Toast['type'] = 'info') {
  const id = Math.random().toString(36).slice(2, 9);
  toastsStore.set([...toastsStore.value, { id, message, type }]);
  setTimeout(() => removeToast(id), 4000);
}

export function removeToast(id: string) {
  toastsStore.set(toastsStore.value.filter(t => t.id !== id));
}

const ICONS: Record<Toast['type'], string> = {
  success: '✓',
  error:   '✕',
  warning: '⚠',
  info:    'ℹ',
};

export function ToastContainer() {
  const container = document.createElement('div');
  container.className = 'toast-container';

  toastsStore.subscribe(toasts => {
    container.innerHTML = '';
    toasts.forEach(toast => {
      const el = document.createElement('div');
      el.className = `toast toast-${toast.type}`;
      el.innerHTML = `
        <span class="toast-icon">${ICONS[toast.type]}</span>
        <span class="toast-message">${toast.message}</span>
        <button class="toast-close" data-id="${toast.id}">×</button>
      `;
      el.querySelector('.toast-close')!.addEventListener('click', () => removeToast(toast.id));
      container.appendChild(el);
    });
  });

  return container;
}
