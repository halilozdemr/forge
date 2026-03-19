export type PageCreator = () => HTMLElement;

class Router {
  private routes: Record<string, PageCreator> = {};
  private currentPath: string = '';

  constructor() {
    window.addEventListener('hashchange', () => this.handleHashChange());
  }

  addRoute(hash: string, creator: PageCreator) {
    this.routes[hash] = creator;
  }

  private handleHashChange() {
    const hash = window.location.hash || '#/';
    if (this.currentPath === hash) return;
    this.currentPath = hash;
    this.render();
  }

  render() {
    const hash = window.location.hash || '#/';
    const creator = this.routes[hash] || this.routes['#/']; // Default to home or error page
    
    const app = document.getElementById('app');
    if (!app) return;

    // Cleanup before clearing DOM
    const prev = app.querySelector('[data-cleanup]') as any;
    if (prev?.cleanup) prev.cleanup();

    app.innerHTML = '';
    if (creator) {
      app.appendChild(creator());
    }
  }

  navigate(hash: string) {
    window.location.hash = hash;
  }
}

export const router = new Router();
