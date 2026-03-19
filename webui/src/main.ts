import './styles/base.css';
import './styles/components.css';
import { router } from './router/router';
import { Layout } from './components/layout/shell';
import { 
  OverviewPage 
} from './components/pages/overview';
import { AgentsPage } from './components/pages/agents';
import { IssuesPage } from './components/pages/issues';
import { SprintsPage } from './components/pages/sprints';
import { QueuePage } from './components/pages/queue';
import { BudgetPage } from './components/pages/budget';
import { startHealthPolling } from './api/health';

// Start polling
startHealthPolling();

// Register routes
router.addRoute('#/', () => Layout(OverviewPage()));
router.addRoute('#/agents', () => Layout(AgentsPage()));
router.addRoute('#/issues', () => Layout(IssuesPage()));
router.addRoute('#/sprints', () => Layout(SprintsPage()));
router.addRoute('#/queue', () => Layout(QueuePage()));
router.addRoute('#/budget', () => Layout(BudgetPage()));

// Initial render
router.render();

// Handle active link styling
window.addEventListener('hashchange', () => {
  const hash = window.location.hash || '#/';
  document.querySelectorAll('.sidebar-links a').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === hash);
  });
});

// Set initial active link
const initialHash = window.location.hash || '#/';
document.querySelectorAll('.sidebar-links a').forEach(a => {
  a.classList.toggle('active', a.getAttribute('href') === initialHash);
});
