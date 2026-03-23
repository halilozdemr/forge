import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = "http://localhost:3131/v1";
let defaultCompanyId: string | null = null;

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
    {},
    async () => {
      const cid = await getCompanyId();
      return fetchApi(`/agents?companyId=${cid}`);
    }
  );

  server.tool(
    "forge_get_agent",
    "Get detailed status and configuration of a specific agent by slug",
    {
      slug: z.string().describe("The slug identifier of the agent (e.g., 'receptionist')"),
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
      systemPrompt: z.string().optional(),
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
    "Create a new issue (ticket) in the project",
    {
      title: z.string().describe("Short title of the issue"),
      description: z.string().optional().describe("Detailed description of the task"),
      type: z.enum(["feature", "bug", "refactor", "release"]).default("feature"),
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
    "Dispatch an agent to execute an issue. Returns a jobId that you must check status of asynchronously.",
    {
      id: z.string().describe("The issue ID to run"),
      agentSlug: z.string().describe("The agent to assign (e.g., 'builder', 'pm', 'architect')"),
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
