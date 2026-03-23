import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { ToastContainer } from '../shared/toast';
import { CommandPalette } from '../shared/command-palette';
import { LiveLogs } from '../shared/live-logs';

let toastMounted = false;
let paletteMounted = false;
let logsMounted = false;

export function Layout(content: HTMLElement) {
  const shell = document.createElement('div');
  shell.className = 'app-shell';

  const contentArea = document.createElement('main');
  contentArea.className = 'content-area scrollbar';
  contentArea.appendChild(content);

  shell.appendChild(Sidebar());
  shell.appendChild(Topbar());
  shell.appendChild(contentArea);

  // Mount toast & palette once globally
  if (!toastMounted) {
    document.body.appendChild(ToastContainer());
    toastMounted = true;
  }

  if (!paletteMounted) {
    document.body.appendChild(CommandPalette());
    paletteMounted = true;
  }

  if (!logsMounted) {
    document.body.appendChild(LiveLogs());
    logsMounted = true;
  }

  // Global ⌘K keyboard shortcut
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('forge:open-palette'));
    }
  });

  return shell;
}
