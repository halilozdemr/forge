import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  state,
  createRunnerMock,
  runnerRunMock,
  budgetCheckMock,
  claimNextJobMock,
  renewJobLeaseMock,
  getQueueMock,
  queueAddMock,
  resolveWorkspaceMock,
  cleanWorkspaceMock,
  updateSessionUsageMock,
  shouldRotateMock,
  rotateSessionMock,
  decryptMock,
  redactSecretsMock,
  emitMock,
  markStepStartedMock,
  handleStepSuccessMock,
  handleStepFailureMock,
  getPipelineMock,
} = vi.hoisted(() => ({
  state: { db: null as any },
  createRunnerMock: vi.fn(),
  runnerRunMock: vi.fn(),
  budgetCheckMock: vi.fn(),
  claimNextJobMock: vi.fn(),
  renewJobLeaseMock: vi.fn(),
  getQueueMock: vi.fn(),
  queueAddMock: vi.fn(),
  resolveWorkspaceMock: vi.fn(),
  cleanWorkspaceMock: vi.fn(),
  updateSessionUsageMock: vi.fn(),
  shouldRotateMock: vi.fn(),
  rotateSessionMock: vi.fn(),
  decryptMock: vi.fn(),
  redactSecretsMock: vi.fn(),
  emitMock: vi.fn(),
  markStepStartedMock: vi.fn(),
  handleStepSuccessMock: vi.fn(),
  handleStepFailureMock: vi.fn(),
  getPipelineMock: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  getDb: () => state.db,
}));

vi.mock("./runners/factory.js", () => ({
  createRunner: createRunnerMock,
}));

vi.mock("./budget-gate.js", () => ({
  BudgetGate: vi.fn().mockImplementation(() => ({
    check: budgetCheckMock,
  })),
}));

vi.mock("./queue.js", () => ({
  claimNextJob: claimNextJobMock,
  renewJobLease: renewJobLeaseMock,
  getQueue: getQueueMock,
}));

vi.mock("./workspace.js", () => ({
  resolveWorkspace: resolveWorkspaceMock,
  cleanWorkspace: cleanWorkspaceMock,
}));

vi.mock("./session.js", () => ({
  updateSessionUsage: updateSessionUsageMock,
  shouldRotate: shouldRotateMock,
  rotateSession: rotateSessionMock,
}));

vi.mock("../utils/crypto.js", () => ({
  decrypt: decryptMock,
  redactSecrets: redactSecretsMock,
}));

vi.mock("../events/emitter.js", () => ({
  emit: emitMock,
}));

vi.mock("../orchestrator/dispatcher.js", () => ({
  PipelineDispatcher: vi.fn().mockImplementation(() => ({
    markStepStarted: markStepStartedMock,
    handleStepSuccess: handleStepSuccessMock,
    handleStepFailure: handleStepFailureMock,
    getPipeline: getPipelineMock,
  })),
}));

import { closeWorker, createAgentWorker, processJob } from "./worker.js";

function createMockDb() {
  return {
    companySecret: {
      findMany: vi.fn(),
    },
    agent: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    issue: {
      update: vi.fn(),
    },
    queueJob: {
      update: vi.fn(),
    },
    activityLog: {
      create: vi.fn(),
    },
    costEvent: {
      create: vi.fn(),
      aggregate: vi.fn(),
    },
    issueWorkProduct: {
      create: vi.fn(),
    },
    issueComment: {
      create: vi.fn(),
    },
    pipelineStepLog: {
      createMany: vi.fn(),
    },
    pipelineStepRun: {
      update: vi.fn(),
    },
    agentRuntimeState: {
      findUnique: vi.fn(),
    },
  } as any;
}

function makeJob(dataOverrides: Record<string, unknown> = {}, jobOverrides: Record<string, unknown> = {}) {
  const data = {
    companyId: "company-1",
    agentSlug: "builder",
    modelProvider: "openrouter",
    agentModel: "deepseek/deepseek-v3-0324:free",
    systemPrompt: "system prompt",
    input: "input body",
    permissions: { read: true, write: true },
    adapterConfig: {},
    projectPath: "/tmp/project",
    ...dataOverrides,
  };

  return {
    id: "job-1",
    payload: JSON.stringify(data),
    attempts: 0,
    maxAttempts: 2,
    scheduledAt: new Date("2026-01-01T00:00:00.000Z"),
    ...jobOverrides,
  };
}

describe("worker lifecycle", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await closeWorker();
    vi.useRealTimers();

    state.db = createMockDb();
    state.db.companySecret.findMany.mockResolvedValue([]);
    state.db.agent.updateMany.mockResolvedValue(undefined);
    state.db.agent.findUnique.mockResolvedValue({
      id: "agent-1",
      status: "idle",
      name: "Builder",
      role: "Builder",
    });
    state.db.issue.update.mockResolvedValue(undefined);
    state.db.queueJob.update.mockResolvedValue(undefined);
    state.db.activityLog.create.mockResolvedValue(undefined);
    state.db.costEvent.create.mockResolvedValue(undefined);
    state.db.costEvent.aggregate.mockResolvedValue({ _sum: { costUsd: 1.25 } });
    state.db.issueWorkProduct.create.mockResolvedValue(undefined);
    state.db.issueComment.create.mockResolvedValue(undefined);
    state.db.pipelineStepLog.createMany.mockResolvedValue(undefined);
    state.db.pipelineStepRun.update.mockResolvedValue(undefined);
    state.db.agentRuntimeState.findUnique.mockResolvedValue(null);

    createRunnerMock.mockReturnValue({ run: runnerRunMock });
    runnerRunMock.mockResolvedValue({
      success: true,
      output: "runner output",
      durationMs: 55,
    });

    budgetCheckMock.mockResolvedValue({
      allowed: true,
      percentUsed: 0,
      currentUsageUsd: 0,
      limitUsd: 0,
    });
    claimNextJobMock.mockResolvedValue(null);
    renewJobLeaseMock.mockResolvedValue(undefined);
    getQueueMock.mockReturnValue({ add: queueAddMock });
    queueAddMock.mockResolvedValue({ id: "next-job" });
    resolveWorkspaceMock.mockResolvedValue("/tmp/workspace");
    cleanWorkspaceMock.mockResolvedValue(undefined);
    updateSessionUsageMock.mockResolvedValue(undefined);
    shouldRotateMock.mockReturnValue(false);
    rotateSessionMock.mockResolvedValue({ handoffNote: "" });
    decryptMock.mockImplementation((value: string) => value);
    redactSecretsMock.mockImplementation((value: string) => value);
    emitMock.mockImplementation(() => undefined);
    markStepStartedMock.mockResolvedValue(undefined);
    handleStepSuccessMock.mockResolvedValue(undefined);
    handleStepFailureMock.mockResolvedValue(undefined);
    getPipelineMock.mockResolvedValue({ status: "running" });
  });

  afterEach(async () => {
    await closeWorker();
    vi.useRealTimers();
  });

  it("polls queue and processes claimed jobs", async () => {
    vi.useFakeTimers();

    const job = makeJob({
      pipelineRunId: "pipe-1",
      pipelineStepRunId: "step-1",
    });
    claimNextJobMock.mockResolvedValueOnce(job).mockResolvedValue(null);

    const worker = createAgentWorker(1);
    await vi.advanceTimersByTimeAsync(300);
    await Promise.resolve();

    expect(claimNextJobMock).toHaveBeenCalledWith(expect.stringMatching(/^worker-/), 30000);
    expect(state.db.queueJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1" },
        data: expect.objectContaining({ status: "completed" }),
      }),
    );

    await worker.close();
  });

  it("marks successful pipeline jobs completed and notifies dispatcher", async () => {
    const job = makeJob({
      pipelineRunId: "pipe-1",
      pipelineStepRunId: "step-1",
    });

    await processJob(job);

    expect(markStepStartedMock).toHaveBeenCalledWith("step-1");
    expect(handleStepSuccessMock).toHaveBeenCalledWith("step-1", "runner output");
    expect(state.db.queueJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1" },
        data: expect.objectContaining({ status: "completed" }),
      }),
    );
  });

  it("marks retryable runner failures back to pending and reports step failure", async () => {
    const job = makeJob(
      {
        pipelineRunId: "pipe-1",
        pipelineStepRunId: "step-1",
      },
      { attempts: 0, maxAttempts: 3 },
    );
    runnerRunMock.mockResolvedValue({
      success: false,
      error: "runner blew up",
      output: "",
      durationMs: 30,
    });

    await processJob(job);

    expect(handleStepFailureMock).toHaveBeenCalledWith("step-1", "runner blew up", true);
    expect(state.db.queueJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1" },
        data: expect.objectContaining({ status: "pending", error: "runner blew up" }),
      }),
    );
  });

  it("blocks execution on budget denial and pauses the agent", async () => {
    const job = makeJob(
      {
        pipelineRunId: "pipe-1",
        pipelineStepRunId: "step-1",
      },
      { attempts: 1, maxAttempts: 1 },
    );
    budgetCheckMock.mockResolvedValue({
      allowed: false,
      reason: "hard-limit",
      percentUsed: 120,
      currentUsageUsd: 12,
      limitUsd: 10,
    });

    await processJob(job);

    expect(state.db.agent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: "company-1", slug: "builder" },
        data: { status: "paused" },
      }),
    );
    expect(runnerRunMock).not.toHaveBeenCalled();
    expect(handleStepFailureMock).toHaveBeenCalledWith(
      "step-1",
      expect.stringContaining("Budget limit exceeded"),
      false,
    );
  });

  it("updates issue status for non-pipeline jobs and cleans workspace", async () => {
    const job = makeJob({
      issueId: "issue-42",
    });
    runnerRunMock.mockResolvedValue({
      success: true,
      output: "done output",
      durationMs: 20,
    });

    await processJob(job);

    expect(state.db.issue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "issue-42" },
        data: expect.objectContaining({ status: "done", result: "done output" }),
      }),
    );
    expect(cleanWorkspaceMock).toHaveBeenCalledWith("issue-42");
  });

  it("records token usage cost events", async () => {
    const job = makeJob();
    runnerRunMock.mockResolvedValue({
      success: true,
      output: "done output",
      durationMs: 90,
      tokenUsage: { input: 2000, output: 1000 },
    });

    await processJob(job);

    expect(state.db.costEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: "company-1",
          agentId: "agent-1",
          inputTokens: 2000,
          outputTokens: 1000,
        }),
      }),
    );
    expect(updateSessionUsageMock).toHaveBeenCalledWith("agent-1", undefined, { input: 2000, output: 1000 });
  });

  it("replaces secret placeholders in prompt and input before runner execution", async () => {
    const job = makeJob({
      systemPrompt: "System token {{secrets.API_KEY}}",
      input: "Input token {{secrets.API_KEY}}",
    });
    state.db.companySecret.findMany.mockResolvedValue([{ name: "API_KEY", value: "encrypted-value" }]);
    decryptMock.mockReturnValue("super-secret");

    await processJob(job);

    expect(runnerRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: "System token super-secret",
        input: "Input token super-secret",
        env: { API_KEY: "super-secret" },
      }),
    );
  });
});
