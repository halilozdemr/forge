import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = "http://localhost:3131/v1";
let defaultCompanyId: string | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!res.ok) {
    throw new Error(`API Error (${res.status}): ${JSON.stringify(data)}`);
  }

  return data as T;
}

function formatToolResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function summarizePipeline(pipeline: any) {
  const stepRuns = Array.isArray(pipeline?.stepRuns) ? pipeline.stepRuns : [];
  const activeStep =
    stepRuns.find((step: any) => step.status === "running")
    ?? stepRuns.find((step: any) => step.status === "queued")
    ?? stepRuns.find((step: any) => step.stepKey === pipeline?.currentStepKey)
    ?? stepRuns.find((step: any) => step.status === "pending")
    ?? null;

  const completedSteps = stepRuns.filter((step: any) => step.status === "completed").length;

  return {
    pipelineRunId: pipeline?.id ?? null,
    issueId: pipeline?.issueId ?? null,
    status: pipeline?.status ?? "unknown",
    entryAgentSlug: pipeline?.entryAgentSlug ?? null,
    currentStepKey: pipeline?.currentStepKey ?? null,
    activeStepKey: activeStep?.stepKey ?? null,
    activeAgentSlug: activeStep?.agentSlug ?? null,
    activeStatus: activeStep?.status ?? null,
    activeExcerpt: activeStep?.resultSummary ?? null,
    completedSteps,
    totalSteps: stepRuns.length,
    steps: stepRuns.map((step: any) => ({
      stepKey: step.stepKey,
      agentSlug: step.agentSlug,
      status: step.status,
    })),
  };
}

function buildPipelineFingerprint(summary: ReturnType<typeof summarizePipeline>) {
  return [
    summary.status,
    summary.activeStepKey ?? "",
    summary.activeAgentSlug ?? "",
    `${summary.completedSteps}/${summary.totalSteps}`,
  ].join(":");
}

async function fetchPipelineSummary(pipelineRunId: string) {
  const data = await fetchJson<{ pipeline: any }>(`/pipelines/${pipelineRunId}`);
  const summary = summarizePipeline(data.pipeline);
  return {
    ...summary,
    fingerprint: buildPipelineFingerprint(summary),
  };
}

// Helper to ensure companyId
async function getCompanyId(): Promise<string> {
  if (defaultCompanyId) return defaultCompanyId;

  try {
    const res = await fetch(`${API_BASE}/context`);
    if (res.ok) {
      const data = await res.json() as any;
      if (data.companyId) {
        defaultCompanyId = data.companyId;
        return data.companyId;
      }
    }
  } catch (err) {
    console.error("Error resolving companyId:", err);
  }
  
  throw new Error("Could not resolve companyId. Run 'forge init' first.");
}

async function fetchApi(path: string, options: RequestInit = {}) {
  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    
    // Some routes return 204 or empty text
    const text = await res.text();
    let data;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch(e) {
            data = { message: text };
        }
    } else {
        data = { success: res.ok };
    }

    if (!res.ok) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `API Error (${res.status}): ${JSON.stringify(data)}` }],
      };
    }
    
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    };
  } catch (err: any) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: `Network Error: ${err.message}` }],
    };
  }
}

export async function startMcpServer() {
  const server = new McpServer({
    name: "forge",
    version: "1.0.0",
  });

  // ========== AGENTS ==========

  server.tool(
    "forge_list_agents",
    "List all agents in the company",
    {
      namespace: z.enum(["official", "user"]).optional().describe("Optional namespace filter"),
    },
    async ({ namespace }) => {
      const cid = await getCompanyId();
      const suffix = namespace ? `&namespace=${namespace}` : "";
      return fetchApi(`/agents?companyId=${cid}${suffix}`);
    }
  );

  server.tool(
    "forge_get_agent",
    "Get detailed status and configuration of a specific agent by slug",
    {
      slug: z.string().describe("The slug identifier of the agent (e.g., 'intake-gate')"),
    },
    async ({ slug }) => {
      const cid = await getCompanyId();
      return fetchApi(`/agents/${slug}?companyId=${cid}`);
    }
  );

  server.tool(
    "forge_hire_agent",
    "Create a new agent in the company",
    {
      slug: z.string().describe("Unique lowercase slug identifier for the agent"),
      name: z.string().describe("Display name for the agent"),
      role: z.string().describe("Role description"),
      modelProvider: z.string().describe("Provider (e.g., 'openrouter', 'claude-cli')"),
      model: z.string().describe("Model ID (e.g., 'deepseek/deepseek-v3.2')"),
      namespace: z.enum(["official", "user"]).default("user").describe("Agent namespace; official names are reserved"),
      status: z.enum(["active", "idle", "paused"]).default("idle"),
      systemPrompt: z.string().describe("Agent's behavior instructions"),
      permissions: z.record(z.string(), z.boolean()).optional().describe("E.g., { 'task': true }"),
    },
    async (params) => {
      const cid = await getCompanyId();
      return fetchApi(`/agents`, {
        method: "POST",
        body: JSON.stringify({ ...params, companyId: cid }),
      });
    }
  );

  server.tool(
    "forge_update_agent",
    "Update an existing agent's configuration",
    {
      slug: z.string().describe("The slug of the agent to update"),
      status: z.enum(["active", "idle", "paused"]).optional(),
      name: z.string().optional(),
      role: z.string().optional(),
      modelProvider: z.string().optional(),
      model: z.string().optional(),
      promptFile: z.string().nullable().optional(),
      permissions: z.record(z.string(), z.boolean()).optional(),
      clientConfig: z.record(z.string(), z.any()).optional(),
      changeNote: z.string().optional(),
    },
    async (args) => {
      const { slug, ...updates } = args;
      const cid = await getCompanyId();
      return fetchApi(`/agents/${slug}`, {
        method: "PUT",
        body: JSON.stringify({ ...updates, companyId: cid }),
      });
    }
  );

  server.tool(
    "forge_fire_agent",
    "Delete an agent from the company",
    {
      slug: z.string().describe("The slug of the agent to delete"),
    },
    async ({ slug }) => {
      const cid = await getCompanyId();
      return fetchApi(`/agents/${slug}?companyId=${cid}`, {
        method: "DELETE",
      });
    }
  );

  // ========== ISSUES ==========

  server.tool(
    "forge_list_issues",
    "List all issues for the project/company",
    {
      projectId: z.string().optional().describe("Optional project ID to filter by"),
    },
    async ({ projectId }) => {
      const params = projectId ? `?projectId=${projectId}` : "";
      return fetchApi(`/issues${params}`);
    }
  );

  server.tool(
    "forge_get_issue",
    "Get detailed information about a specific issue",
    {
      id: z.string().describe("The issue ID"),
    },
    async ({ id }) => {
      return fetchApi(`/issues/${id}`);
    }
  );

  server.tool(
    "forge_create_issue",
    "Create a new issue (ticket) in the project without auto-dispatching execution",
    {
      title: z.string().describe("Short title of the issue"),
      description: z.string().optional().describe("Detailed description of the task"),
      type: z.enum(["feature", "bug", "refactor", "release", "harness"]).default("feature"),
    },
    async (params) => {
      // We need a projectId to create an issue. Try to resolve it from /context
      const ctxRes = await fetch(`${API_BASE}/context`);
      let projectId = null;
      if (ctxRes.ok) {
        const ctxData = await ctxRes.json() as any;
        projectId = ctxData.projectId;
      }
      
      if (!projectId) {
         return { isError: true, content: [{ type: "text" as const, text: "Could not resolve default projectId. Create a project first." }] };
      }

      return fetchApi(`/issues`, {
        method: "POST",
        body: JSON.stringify({ ...params, projectId }),
      });
    }
  );

  server.tool(
    "forge_update_issue",
    "Update an existing issue",
    {
      id: z.string().describe("The issue ID to update"),
      status: z.enum(["backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled"]).optional(),
      title: z.string().optional(),
      description: z.string().optional(),
    },
    async (args) => {
      const { id, ...updates } = args;
      return fetchApi(`/issues/${id}`, {
        method: "PUT",
        body: JSON.stringify(updates),
      });
    }
  );

  server.tool(
    "forge_run_issue",
    "Legacy admin tool: dispatch an agent to execute an issue manually. Returns a jobId that you must check asynchronously.",
    {
      id: z.string().describe("The issue ID to run"),
      agentSlug: z.string().describe("The agent to assign (e.g., 'builder', 'architect', 'quality-guard')"),
      instructions: z.string().describe("Instructions for the agent to execute this issue"),
    },
    async ({ id, agentSlug, instructions }) => {
      const cid = await getCompanyId();
      const res = await fetchApi(`/issues/${id}/run`, {
        method: "POST",
        body: JSON.stringify({ companyId: cid, agentSlug, input: instructions }),
      });
      return res; // typically { jobId: "..." }
    }
  );

  server.tool(
    "forge_submit_request",
    "Submit an approved client request to Forge backend orchestration. Preferred entrypoint for conversational flows.",
    {
      source: z.enum(["claude-code", "opencode", "api"]).default("api"),
      type: z.enum(["feature", "bug", "refactor", "release", "harness"]),
      title: z.string().describe("Short title for the request"),
      description: z.string().optional().describe("Concise execution request"),
      briefMarkdown: z.string().optional().describe("Approved brief markdown"),
      requestedBy: z.string().default("user"),
      clientContext: z.string().optional().describe("Additional client or session context"),
      clientRequestKey: z.string().optional().describe("Optional idempotency key from the client"),
    },
    async (params) => {
      const ctxRes = await fetch(`${API_BASE}/context`);
      let projectId = null;
      if (ctxRes.ok) {
        const ctxData = await ctxRes.json() as any;
        projectId = ctxData.projectId;
      }

      try {
        const intake = await fetchJson<any>(`/intake/requests`, {
          method: "POST",
          body: JSON.stringify({ ...params, projectId }),
        });

        const pipeline = intake.pipelineRunId
          ? await fetchPipelineSummary(intake.pipelineRunId)
          : null;

        return formatToolResult({
          ...intake,
          pipeline,
        });
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: err.message }],
        };
      }
    }
  );

  server.tool(
    "forge_run_agent_direct",
    "Legacy non-authoritative helper for direct extension runs. Official flow remains intake-first.",
    {
      source: z.enum(["claude-code", "opencode", "api"]).default("api"),
      requestedAgentSlug: z.string().describe("Specialist slug to run directly"),
      title: z.string().describe("Short title for the direct request"),
      description: z.string().optional().describe("Detailed request for the specialist"),
      requestedBy: z.string().default("user"),
      clientContext: z.string().optional().describe("Additional client or session context"),
      clientRequestKey: z.string().optional().describe("Optional idempotency key from the client"),
    },
    async (params) => {
      const ctxRes = await fetch(`${API_BASE}/context`);
      let projectId = null;
      if (ctxRes.ok) {
        const ctxData = await ctxRes.json() as any;
        projectId = ctxData.projectId;
      }

      try {
        const intake = await fetchJson<any>(`/intake/requests`, {
          method: "POST",
          body: JSON.stringify({
            ...params,
            type: "direct",
            projectId,
          }),
        });

        const pipeline = intake.pipelineRunId
          ? await fetchPipelineSummary(intake.pipelineRunId)
          : null;

        return formatToolResult({
          ...intake,
          pipeline,
        });
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: err.message }],
        };
      }
    }
  );

  server.tool(
    "forge_get_pipeline",
    "Get the current status and active-step summary of a pipeline run",
    {
      pipelineRunId: z.string().describe("Pipeline run ID"),
    },
    async ({ pipelineRunId }) => {
      try {
        return formatToolResult(await fetchPipelineSummary(pipelineRunId));
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: err.message }],
        };
      }
    }
  );

  server.tool(
    "forge_wait_pipeline",
    "Wait for a pipeline run to change state or active step. Useful for live progress follow-up in conversational clients.",
    {
      pipelineRunId: z.string().describe("Pipeline run ID"),
      lastSeenFingerprint: z.string().optional().describe("Previous fingerprint returned by forge_get_pipeline or forge_wait_pipeline"),
      timeoutMs: z.number().int().min(1000).max(120000).default(30000),
      pollIntervalMs: z.number().int().min(1000).max(10000).default(3000),
    },
    async ({ pipelineRunId, lastSeenFingerprint, timeoutMs, pollIntervalMs }) => {
      try {
        const startedAt = Date.now();

        while (true) {
          const pipeline = await fetchPipelineSummary(pipelineRunId);
          const terminal = ["completed", "failed", "cancelled"].includes(pipeline.status);
          const changed = !lastSeenFingerprint || pipeline.fingerprint !== lastSeenFingerprint;

          if (terminal || changed) {
            return formatToolResult({
              changed,
              terminal,
              timedOut: false,
              pipeline,
            });
          }

          if (Date.now() - startedAt >= timeoutMs) {
            return formatToolResult({
              changed: false,
              terminal: false,
              timedOut: true,
              pipeline,
            });
          }

          await sleep(pollIntervalMs);
        }
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: err.message }],
        };
      }
    }
  );

  server.tool(
    "forge_list_pipeline_steps",
    "List the persisted steps of a pipeline run",
    {
      pipelineRunId: z.string().describe("Pipeline run ID"),
    },
    async ({ pipelineRunId }) => {
      return fetchApi(`/pipelines/${pipelineRunId}/steps`);
    }
  );

  server.tool(
    "forge_retry_pipeline_step",
    "Retry a failed pipeline step and enqueue it again if dependencies are satisfied",
    {
      pipelineRunId: z.string().describe("Pipeline run ID"),
      stepKey: z.string().describe("The step key to retry"),
    },
    async ({ pipelineRunId, stepKey }) => {
      return fetchApi(`/pipelines/${pipelineRunId}/steps/${encodeURIComponent(stepKey)}/retry`, {
        method: "POST",
      });
    }
  );

  server.tool(
    "forge_cancel_pipeline",
    "Cancel an in-flight pipeline run",
    {
      pipelineRunId: z.string().describe("Pipeline run ID"),
    },
    async ({ pipelineRunId }) => {
      return fetchApi(`/pipelines/${pipelineRunId}/cancel`, {
        method: "POST",
      });
    }
  );

  // ========== SPRINTS ==========

  server.tool(
    "forge_list_sprints",
    "List sprints",
    {},
    async () => {
      return fetchApi(`/sprints`);
    }
  );

  server.tool(
    "forge_create_sprint",
    "Create a new sprint",
    {
      number: z.number().describe("Sprint number (e.g., 1, 2)"),
      goal: z.string().describe("Goal of the sprint"),
    },
    async (params) => {
      const ctxRes = await fetch(`${API_BASE}/context`);
      let projectId = null;
      if (ctxRes.ok) {
        const ctxData = await ctxRes.json() as any;
        projectId = ctxData.projectId;
      }
      
      if (!projectId) {
         return { isError: true, content: [{ type: "text" as const, text: "Could not resolve default projectId." }] };
      }

      return fetchApi(`/sprints`, {
        method: "POST",
        body: JSON.stringify({ ...params, projectId }),
      });
    }
  );

  // ========== METRICS & STATE ==========

  server.tool(
    "forge_get_status",
    "Get system status (agent counts, queue counts, heartbeat tracking)",
    {},
    async () => {
      const cid = await getCompanyId();
      return fetchApi(`/status?companyId=${cid}`);
    }
  );

  server.tool(
    "forge_get_budget",
    "Get budget consumption usage and limits",
    {},
    async () => {
      const cid = await getCompanyId();
      return fetchApi(`/budget/usage?companyId=${cid}`);
    }
  );

  server.tool(
    "forge_list_queue",
    "List recent jobs in the async queue",
    {},
    async () => {
      const cid = await getCompanyId();
      return fetchApi(`/queue/jobs?companyId=${cid}`);
    }
  );

  server.tool(
    "forge_get_job",
    "Check the status of an async job (use for polling after run_issue)",
    {
      jobId: z.string().describe("The jobId returned from forge_run_issue"),
    },
    async ({ jobId }) => {
      // /v1/queue/jobs?companyId=... won't easily filter by jobId without querying sqlite.
      // But we know /queue/jobs returns the last 50. Let's just find it there or error.
      const dbRes = await fetch(`${API_BASE}/queue/jobs`);
      if (dbRes.ok) {
          const dbData = await dbRes.json() as any;
          const job = dbData.jobs?.find((j: any) => j.id === jobId);
          if (job) {
               return { content: [{ type: "text" as const, text: JSON.stringify(job, null, 2) }] };
          }
      }
      return { isError: true, content: [{ type: "text" as const, text: `Job ${jobId} not found in recent queue jobs.` }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("forge-mcp running on stdio");
}
