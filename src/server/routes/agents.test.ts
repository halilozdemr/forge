import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, transitionAgentMock } = vi.hoisted(() => ({
  mockDb: {
    agent: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    activityLog: {
      create: vi.fn(),
    },
  },
  transitionAgentMock: vi.fn(),
}));

vi.mock("../../db/client.js", () => ({
  getDb: () => mockDb,
}));

vi.mock("../../agents/lifecycle.js", () => ({
  transitionAgent: transitionAgentMock,
}));

import { agentRoutes } from "./agents.js";

async function buildServer() {
  const app = Fastify();
  await app.register(agentRoutes, { prefix: "/v1" });
  return app;
}

describe("agentRoutes PUT /agents/:slug", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockDb.agent.update.mockResolvedValue(undefined);
    mockDb.agent.findUnique.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      slug: "architect",
      name: "Architect",
      role: "Architect",
      modelProvider: "claude-cli",
      model: "sonnet",
      promptFile: null,
      reportsTo: null,
      status: "idle",
      permissions: {},
      maxConcurrent: 1,
      heartbeatCron: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockDb.activityLog.create.mockResolvedValue(undefined);
    transitionAgentMock.mockResolvedValue({ success: true });
  });

  it("rejects unsupported model providers", async () => {
    const app = await buildServer();

    const res = await app.inject({
      method: "PUT",
      url: "/v1/agents/architect",
      payload: {
        companyId: "company-1",
        modelProvider: "unsupported-provider",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Unsupported modelProvider: unsupported-provider" });
    expect(mockDb.agent.update).not.toHaveBeenCalled();

    await app.close();
  });

  it("rejects invalid model format", async () => {
    const app = await buildServer();

    const res = await app.inject({
      method: "PUT",
      url: "/v1/agents/architect",
      payload: {
        companyId: "company-1",
        model: "bad model with spaces",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid model format: bad model with spaces" });
    expect(mockDb.agent.update).not.toHaveBeenCalled();

    await app.close();
  });

  it("updates only supported fields and ignores MCP-only extras", async () => {
    const app = await buildServer();

    const res = await app.inject({
      method: "PUT",
      url: "/v1/agents/architect",
      payload: {
        companyId: "company-1",
        name: "  Senior Architect ",
        role: "  Architecture Owner ",
        modelProvider: "claude-cli",
        model: "sonnet",
        promptFile: null,
        changeNote: "updated from bridge",
        clientConfig: { some: "value" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockDb.agent.update).toHaveBeenCalledWith({
      where: { companyId_slug: { companyId: "company-1", slug: "architect" } },
      data: {
        name: "Senior Architect",
        role: "Architecture Owner",
        modelProvider: "claude-cli",
        model: "sonnet",
        promptFile: null,
      },
    });
    expect(mockDb.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "agent.updated",
          metadata: expect.objectContaining({
            fields: ["name", "role", "modelProvider", "model", "promptFile"],
            changeNote: "updated from bridge",
          }),
        }),
      })
    );

    await app.close();
  });
});
