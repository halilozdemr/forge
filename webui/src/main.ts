import './styles/base.css';
import './styles/components.css';
import { router } from './router/router';
import { Layout } from './components/layout/shell';
import { OverviewPage } from './components/pages/overview';
import { AgentsPage } from './components/pages/agents';
import { IssuesPage } from './components/pages/issues';
import { SprintsPage } from './components/pages/sprints';
import { QueuePage } from './components/pages/queue';
import { BudgetPage } from './components/pages/budget';
import { startHealthPolling } from './api/health';
import { connectWebSocket } from './api/socket';
import { getAppContext } from './api/context';

// Load app context (company/project IDs) before rendering
getAppContext().then(() => {
  startHealthPolling();
  connectWebSocket();

  router.addRoute('#/',        () => Layout(OverviewPage()));
  router.addRoute('#/agents',  () => Layout(AgentsPage()));
  router.addRoute('#/issues',  () => Layout(IssuesPage()));
  router.addRoute('#/sprints', () => Layout(SprintsPage()));
  router.addRoute('#/queue',   () => Layout(QueuePage()));
  router.addRoute('#/budget',  () => Layout(BudgetPage()));

  router.render();
});
