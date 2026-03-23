type Listener<T> = (value: T) => void;

export class Signal<T> {
  private listeners: Set<Listener<T>> = new Set();
  constructor(private _value: T) {}

  get value() { return this._value; }

  set(next: T) {
    if (this._value === next) return;
    this._value = next;
    this.listeners.forEach(fn => fn(next));
  }

  subscribe(fn: Listener<T>) {
    this.listeners.add(fn);
    fn(this._value); // Initial emission
    return () => this.listeners.delete(fn);
  }
}

// Global Types (Placeholder)
export interface Agent {
  id: string;
  slug: string;
  name: string;
  role?: string;
  model: string;
  modelProvider?: string;
  promptFile?: string | null;
  reportsTo?: string | null;
  permissions?: string | Record<string, boolean>;
  maxConcurrent?: number;
  heartbeatCron?: string | null;
  clientConfig?: string | Record<string, unknown>;
  systemPrompt?: string;
  status: 'idle' | 'active' | 'paused' | 'terminated' | 'error';
  cost?: number;
}

export interface Issue {
  id: string;
  title: string;
  status: 'open' | 'todo' | 'in_progress' | 'review' | 'in_review' | 'done' | 'failed' | 'cancelled' | 'blocked';
  type: 'feature' | 'bug' | 'refactor' | 'release' | 'chore' | string;
  assignedAgentId?: string;
  assignedAgent?: { slug: string; name: string } | null;
  executionAgentSlug?: string | null;
  pipeline?: {
    id: string;
    status: string;
    entryAgentSlug: string;
    currentStepKey: string | null;
    activeStepKey: string | null;
    activeAgentSlug: string | null;
    activeStatus: string | null;
    activeExcerpt?: string | null;
    completedSteps: number;
    totalSteps: number;
    startedAt: string;
    completedAt: string | null;
    updatedAt: string;
  } | null;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'down';
  components: {
    db: boolean;
    redis: boolean;
    worker: boolean;
  };
}

export interface LogEntry {
  ts: number;
  agentSlug: string;
  line: string;
}

const LOG_BUFFER_SIZE = 300;

export function appendLog(store: Signal<LogEntry[]>, entry: LogEntry) {
  const prev = store.value;
  const next = prev.length >= LOG_BUFFER_SIZE
    ? [...prev.slice(prev.length - LOG_BUFFER_SIZE + 1), entry]
    : [...prev, entry];
  store.set(next);
}

// Global Store
export const agentsStore = new Signal<Agent[]>([]);
export const issuesStore = new Signal<Issue[]>([]);
export const healthStore = new Signal<HealthStatus | null>(null);
export const activeJobsCount = new Signal<number>(0);
export const logsStore = new Signal<LogEntry[]>([]);
