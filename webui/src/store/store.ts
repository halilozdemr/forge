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
  slug: string;
  name: string;
  role?: string;
  model: string;
  modelProvider?: string;
  systemPrompt?: string;
  status: 'idle' | 'active' | 'paused' | 'error';
  cost?: number;
}

export interface Issue {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'review' | 'done';
  type: 'feature' | 'bug' | 'refactor' | 'release' | 'chore';
  assignedTo?: string;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'down';
  components: {
    db: boolean;
    redis: boolean;
    worker: boolean;
  };
}

// Global Store
export const agentsStore = new Signal<Agent[]>([]);
export const issuesStore = new Signal<Issue[]>([]);
export const healthStore = new Signal<HealthStatus | null>(null);
export const activeJobsCount = new Signal<number>(0);
