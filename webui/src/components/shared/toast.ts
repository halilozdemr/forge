import { Signal } from '../../store/store';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export const toastsStore = new Signal<Toast[]>([]);

export function addToast(message: string, type: Toast['type'] = 'info') {
  const id = Math.random().toString(36).slice(2, 9);
  const current = toastsStore.value;
  toastsStore.set([...current, { id, message, type }]);

  setTimeout(() => {
    removeToast(id);
  }, 3000);
}

export function removeToast(id: string) {
  const current = toastsStore.value;
  toastsStore.set(current.filter(t => t.id !== id));
}

export function ToastContainer() {
  const container = document.createElement('div');
  container.className = 'toast-container';

  toastsStore.subscribe(toasts => {
    container.innerHTML = '';
    toasts.forEach(toast => {
      const el = document.createElement('div');
      el.className = `toast toast-${toast.type}`;
      el.innerText = toast.message;
      container.appendChild(el);
    });
  });

  return container;
}
