export type PageCreator = () => HTMLElement;
export type DynamicPageCreator = (param: string) => HTMLElement;

class Router {
  private routes: Record<string, PageCreator> = {};
  private dynamicRoutes: Array<{ prefix: string; creator: DynamicPageCreator }> = [];
  private currentPath: string = '';

  constructor() {
    window.addEventListener('hashchange', () => this.handleHashChange());
  }

  addRoute(hash: string, creator: PageCreator) {
    this.routes[hash] = creator;
  }

  addDynamicRoute(prefix: string, creator: DynamicPageCreator) {
    this.dynamicRoutes.push({ prefix, creator });
  }

  private handleHashChange() {
    const hash = window.location.hash || '#/';
    if (this.currentPath === hash) return;
    this.currentPath = hash;
    this.render();
  }

  render() {
    const hash = window.location.hash || '#/';

    let creator: PageCreator | undefined = this.routes[hash];

    if (!creator) {
      for (const dr of this.dynamicRoutes) {
        if (hash.startsWith(dr.prefix)) {
          const param = hash.slice(dr.prefix.length);
          creator = () => dr.creator(param);
          break;
        }
      }
    }

    creator = creator ?? this.routes['#/'];

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
