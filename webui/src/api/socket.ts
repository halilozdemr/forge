import { agentsStore, issuesStore, activeJobsCount, logsStore, appendLog } from '../store/store';
import { fetchIssues } from './issues';

let socket: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

export function connectWebSocket() {
  if (socket) return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // In development, VITE_API_URL might be different, but for now we assume same host
  const host = import.meta.env.VITE_API_URL 
    ? import.meta.env.VITE_API_URL.replace(/^http/, 'ws') 
    : `${protocol}//${window.location.host}`;
  
  const url = `${host}/ws`;

  console.log(`Connecting to WebSocket: ${url}`);
  socket = new WebSocket(url);

  socket.onopen = () => {
    console.log('WebSocket connected');
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    }
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerEvent(data);
    } catch (err) {
      console.error('Failed to parse WebSocket message', err);
    }
  };

  socket.onclose = () => {
    console.log('WebSocket disconnected, reconnecting...');
    socket = null;
    if (!reconnectTimer) {
      reconnectTimer = setInterval(connectWebSocket, 3000);
    }
  };

  socket.onerror = (err) => {
    console.error('WebSocket error', err);
    socket?.close();
  };
}

function handleServerEvent(event: any) {
  switch (event.type) {
    case 'agent.status.changed':
      updateAgentStatus(event.agentSlug, event.status);
      break;
    case 'issue.updated':
      updateIssueStatus(event.issueId, event.status);
      void fetchIssues();
      break;
    case 'queue.job.started':
      activeJobsCount.set(activeJobsCount.value + 1);
      break;
    case 'queue.job.completed':
      activeJobsCount.set(Math.max(0, activeJobsCount.value - 1));
      break;
    case 'budget.threshold':
      console.warn(`Budget threshold reached: ${event.percent}% for ${event.scope}`);
      break;
    case 'heartbeat.log':
      appendLog(logsStore, { ts: Date.now(), agentSlug: event.agentSlug, line: event.line });
      break;
  }
}

function updateAgentStatus(slug: string, status: any) {
  const agents = [...agentsStore.value];
  const index = agents.findIndex(a => a.slug === slug);
  if (index !== -1) {
    agents[index] = { ...agents[index], status };
    agentsStore.set(agents);
  }
}

function updateIssueStatus(id: string, status: any) {
  const issues = [...issuesStore.value];
  const index = issues.findIndex(i => i.id === id);
  if (index !== -1) {
    issues[index] = { ...issues[index], status };
    issuesStore.set(issues);
  }
}
