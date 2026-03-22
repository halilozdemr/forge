export interface AgentRunnerConfig {
  projectPath: string;
  agentSlug: string;
  model: string;
  systemPrompt: string;
  input: string;
  permissions: Record<string, boolean>;
  adapterConfig?: Record<string, any>;
  sessionId?: string;
  timeoutMs?: number;
  onStream?: (chunk: string) => void;
}

export interface AgentResult {
  success: boolean;
  output?: string;
  error?: string;
  tokenUsage?: {
    input: number;
    output: number;
  };
  durationMs: number;
  provider: string;
}

export interface AgentRunner {
  run(config: AgentRunnerConfig): Promise<AgentResult>;
}
