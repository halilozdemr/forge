import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

export function Layout(content: HTMLElement) {
  const shell = document.createElement('div');
  shell.className = 'app-shell';
  
  const contentArea = document.createElement('main');
  contentArea.className = 'content-area';
  contentArea.appendChild(content);

  shell.appendChild(Sidebar());
  shell.appendChild(Topbar());
  shell.appendChild(contentArea);

  return shell;
}
