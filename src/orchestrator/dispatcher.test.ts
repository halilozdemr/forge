import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  enqueueAgentJobMock,
  emitMock,
  getHarnessArtifactTypeMock,
  extractStructuredArtifactMock,
  validateAndStoreArtifactMock,
  assembleHarnessStepContextMock,
  buildSprintStepsMock,
} = vi.hoisted(() => ({
  enqueueAgentJobMock: vi.fn(),
  emitMock: vi.fn(),
  getHarnessArtifactTypeMock: vi.fn(),
  extractStructuredArtifactMock: vi.fn(),
  validateAndStoreArtifactMock: vi.fn(),
  assembleHarnessStepContextMock: vi.fn(),
  buildSprintStepsMock: vi.fn(),
}));

vi.mock("../bridge/queue.js", () => ({
  enqueueAgentJob: enqueueAgentJobMock,
}));

vi.mock("../events/emitter.js", () => ({
  emit: emitMock,
}));

vi.mock("./harness-artifacts.js", () => ({
  getHarnessArtifactType: getHarnessArtifactTypeMock,
  extractStructuredArtifact: extractStructuredArtifactMock,
  validateAndStoreArtifact: validateAndStoreArtifactMock,
  assembleHarnessStepContext: assembleHarnessStepContextMock,
}));

vi.mock("./pipelines/harness.js", () => ({
  buildSprintSteps: buildSprintStepsMock,
}));

import { PipelineDispatcher, getTransitiveDependents, parseReviewerDecision } from "./dispatcher.js";

function createMockDb() {
  return {
    pipelineRun: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    pipelineStepRun: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      createMany: vi.fn(),
    },
    issue: {
      update: vi.fn(),
    },
    queueJob: {
      updateMany: vi.fn(),
    },
    agent: {
      findUnique: vi.fn(),
    },
    issueWorkProduct: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    sprintRun: {
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    approval: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  } as any;
}

function makeStepRun(overrides: Record<string, unknown>) {
  return {
    id: "step-id",
    pipelineRunId: "pipe-1",
    stepKey: "step",
    agentSlug: "architect",
    inputSnapshot: "default input",
    dependsOn: "[]",
    status: "pending",
    attempts: 0,
    queueJobId: null,
    resultSummary: null,
    completedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makePipelineRun(overrides: Record<string, unknown>) {
  return {
    id: "pipe-1",
    companyId: "company-1",
    issueId: null,
    requestType: "feature",
    status: "pending",
    planJson: "[]",
    issue: null,
    stepRuns: [],
    ...overrides,
  };
}

describe("PipelineDispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enqueueAgentJobMock.mockResolvedValue("job-1");
    getHarnessArtifactTypeMock.mockReturnValue(null);
    extractStructuredArtifactMock.mockReturnValue(null);
    validateAndStoreArtifactMock.mockResolvedValue("wp-1");
    assembleHarnessStepContextMock.mockResolvedValue("harness-context");
    buildSprintStepsMock.mockReturnValue([]);
  });

  it("queues linear pipeline steps in dependency order", async () => {
    const db = createMockDb();
    db.agent.findUnique.mockResolvedValue({ id: "agent-1" });
    db.pipelineStepRun.update.mockResolvedValue(undefined);
    db.pipelineRun.update.mockResolvedValue(undefined);

    const runA = makePipelineRun({
      stepRuns: [
        makeStepRun({ id: "step-a", stepKey: "A", inputSnapshot: "Input A", agentSlug: "architect" }),
        makeStepRun({ id: "step-b", stepKey: "B", inputSnapshot: "Input B", dependsOn: JSON.stringify(["A"]), agentSlug: "builder" }),
        makeStepRun({ id: "step-c", stepKey: "C", inputSnapshot: "Input C", dependsOn: JSON.stringify(["B"]), agentSlug: "quality-guard" }),
      ],
    });

    const runB = makePipelineRun({
      stepRuns: [
        makeStepRun({ id: "step-a", stepKey: "A", status: "completed", resultSummary: "A result" }),
        makeStepRun({ id: "step-b", stepKey: "B", inputSnapshot: "Input B", dependsOn: JSON.stringify(["A"]), agentSlug: "builder" }),
        makeStepRun({ id: "step-c", stepKey: "C", inputSnapshot: "Input C", dependsOn: JSON.stringify(["B"]), agentSlug: "quality-guard" }),
      ],
    });

    const runC = makePipelineRun({
      stepRuns: [
        makeStepRun({ id: "step-a", stepKey: "A", status: "completed", resultSummary: "A result" }),
        makeStepRun({ id: "step-b", stepKey: "B", status: "completed", resultSummary: "B result", dependsOn: JSON.stringify(["A"]) }),
        makeStepRun({ id: "step-c", stepKey: "C", inputSnapshot: "Input C", dependsOn: JSON.stringify(["B"]), agentSlug: "quality-guard" }),
      ],
    });

    db.pipelineRun.findUnique
      .mockResolvedValueOnce(runA)
      .mockResolvedValueOnce(runB)
      .mockResolvedValueOnce(runC);

    const dispatcher = new PipelineDispatcher(db);

    await expect(dispatcher.enqueueEligibleSteps("pipe-1")).resolves.toEqual(["A"]);
    await expect(dispatcher.enqueueEligibleSteps("pipe-1")).resolves.toEqual(["B"]);
    await expect(dispatcher.enqueueEligibleSteps("pipe-1")).resolves.toEqual(["C"]);

    expect(enqueueAgentJobMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ pipelineStepRunId: "step-a", input: "Input A" }),
    );
    expect(enqueueAgentJobMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ pipelineStepRunId: "step-b", input: expect.stringContaining("## Output from A\nA result") }),
    );
    expect(enqueueAgentJobMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        pipelineStepRunId: "step-c",
        input: expect.stringContaining("## Output from B\nB result"),
      }),
    );
    expect(enqueueAgentJobMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        pipelineStepRunId: "step-c",
        input: expect.stringContaining("## Output from A\nA result"),
      }),
    );
  });

  it("assembles transitive classic context with per-stage and total caps", async () => {
    const db = createMockDb();
    db.agent.findUnique.mockResolvedValue({ id: "agent-1" });
    db.pipelineStepRun.update.mockResolvedValue(undefined);
    db.pipelineRun.update.mockResolvedValue(undefined);

    const run = makePipelineRun({
      stepRuns: [
        makeStepRun({
          id: "step-a",
          stepKey: "A",
          status: "completed",
          resultSummary: "A".repeat(5000),
        }),
        makeStepRun({
          id: "step-b",
          stepKey: "B",
          status: "completed",
          dependsOn: JSON.stringify(["A"]),
          resultSummary: "B".repeat(5000),
        }),
        makeStepRun({
          id: "step-c",
          stepKey: "C",
          status: "completed",
          dependsOn: JSON.stringify(["B"]),
          resultSummary: "C".repeat(5000),
        }),
        makeStepRun({
          id: "step-d",
          stepKey: "D",
          status: "completed",
          dependsOn: JSON.stringify(["C"]),
          resultSummary: "D".repeat(5000),
        }),
        makeStepRun({
          id: "step-e",
          stepKey: "E",
          inputSnapshot: "Input E",
          agentSlug: "quality-guard",
          dependsOn: JSON.stringify(["D"]),
        }),
      ],
    });

    db.pipelineRun.findUnique.mockResolvedValue(run);

    const dispatcher = new PipelineDispatcher(db);
    await expect(dispatcher.enqueueEligibleSteps("pipe-1")).resolves.toEqual(["E"]);

    const queuedInput = enqueueAgentJobMock.mock.calls[0][0].input as string;
    expect(queuedInput).toContain("## Output from D\n");
    expect(queuedInput).toContain("## Output from C\n");
    expect(queuedInput).not.toContain("## Output from B\n");
    expect(queuedInput).not.toContain("## Output from A\n");
    expect(queuedInput).toContain("[truncated to 4000 chars]");
    expect(queuedInput.match(/\[truncated to 4000 chars\]/g)?.length).toBe(2);
    expect(queuedInput).toContain("D".repeat(4000));
    expect(queuedInput).not.toContain("D".repeat(4001));
  });

  it("enforces total cap using full injected section text (including headers/separators)", async () => {
    const db = createMockDb();
    db.agent.findUnique.mockResolvedValue({ id: "agent-1" });
    db.pipelineStepRun.update.mockResolvedValue(undefined);
    db.pipelineRun.update.mockResolvedValue(undefined);

    const run = makePipelineRun({
      stepRuns: [
        makeStepRun({
          id: "step-a",
          stepKey: "A",
          status: "completed",
          resultSummary: "A".repeat(10),
        }),
        makeStepRun({
          id: "step-b",
          stepKey: "B",
          status: "completed",
          dependsOn: JSON.stringify(["A"]),
          resultSummary: "B".repeat(4000),
        }),
        makeStepRun({
          id: "step-c",
          stepKey: "C",
          status: "completed",
          dependsOn: JSON.stringify(["B"]),
          resultSummary: "C".repeat(4000),
        }),
        makeStepRun({
          id: "step-d",
          stepKey: "D",
          status: "completed",
          dependsOn: JSON.stringify(["C"]),
          resultSummary: "D".repeat(4000),
        }),
        makeStepRun({
          id: "step-e",
          stepKey: "E",
          inputSnapshot: "Input E",
          agentSlug: "quality-guard",
          dependsOn: JSON.stringify(["D"]),
        }),
      ],
    });

    db.pipelineRun.findUnique.mockResolvedValue(run);

    const dispatcher = new PipelineDispatcher(db);
    await expect(dispatcher.enqueueEligibleSteps("pipe-1")).resolves.toEqual(["E"]);

    const queuedInput = enqueueAgentJobMock.mock.calls[0][0].input as string;
    expect(queuedInput).toContain("## Output from D\n");
    expect(queuedInput).toContain("## Output from C\n");
    expect(queuedInput).not.toContain("## Output from B\n");

    const delimiter = "\n\n---\n";
    const delimiterIndex = queuedInput.indexOf(delimiter);
    expect(delimiterIndex).toBeGreaterThanOrEqual(0);
    const appendedContext = queuedInput.slice(delimiterIndex);
    expect(appendedContext.length).toBeLessThanOrEqual(12000);
  });

  it("marks step, pipeline, and issue as failed on non-retryable error", async () => {
    const db = createMockDb();
    db.pipelineStepRun.findUnique.mockResolvedValue({
      id: "step-a",
      pipelineRunId: "pipe-1",
      pipelineRun: { issueId: "issue-1" },
    });
    db.pipelineStepRun.update.mockResolvedValue(undefined);
    db.pipelineRun.update.mockResolvedValue(undefined);
    db.issue.update.mockResolvedValue(undefined);

    const dispatcher = new PipelineDispatcher(db);
    await dispatcher.handleStepFailure("step-a", "hard failure", false);

    expect(db.pipelineStepRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "step-a" },
        data: expect.objectContaining({ status: "failed", resultSummary: "hard failure" }),
      }),
    );
    expect(db.pipelineRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pipe-1" },
        data: expect.objectContaining({ status: "failed", lastError: "hard failure" }),
      }),
    );
    expect(db.issue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "issue-1" },
        data: expect.objectContaining({ status: "failed", result: "hard failure" }),
      }),
    );
    expect(emitMock).toHaveBeenCalledWith({ type: "issue.updated", issueId: "issue-1", status: "failed" });
  });

  it("returns transitive dependents including the target node", () => {
    const result = getTransitiveDependents(
      [
        { stepKey: "A", dependsOn: "[]" },
        { stepKey: "B", dependsOn: JSON.stringify(["A"]) },
        { stepKey: "C", dependsOn: JSON.stringify(["B"]) },
        { stepKey: "D", dependsOn: JSON.stringify(["A"]) },
      ],
      "A",
    );

    expect(new Set(result)).toEqual(new Set(["A", "B", "C", "D"]));
  });

  it("resets target step and transitive dependents when reviewer rejects", async () => {
    const db = createMockDb();
    db.pipelineStepRun.update.mockResolvedValue(undefined);
    db.pipelineStepRun.findUnique.mockResolvedValue({
      id: "step-qg",
      pipelineRunId: "pipe-1",
      stepKey: "quality-guard",
      status: "running",
      agentSlug: "quality-guard",
      inputSnapshot: "Review build",
      pipelineRun: {
        id: "pipe-1",
        requestType: "feature",
        issueId: null,
        planJson: JSON.stringify([
          { key: "builder", input: "Build feature from architecture plan" },
          { key: "quality-guard", input: "Review output", loopsBackTo: "builder", maxRevisions: 3 },
          { key: "devops", input: "Deploy output" },
        ]),
        stepRuns: [
          makeStepRun({
            id: "step-builder",
            pipelineRunId: "pipe-1",
            stepKey: "builder",
            inputSnapshot: "Original builder task",
            dependsOn: JSON.stringify(["architect"]),
            status: "completed",
            attempts: 1,
          }),
          makeStepRun({
            id: "step-qg",
            pipelineRunId: "pipe-1",
            stepKey: "quality-guard",
            dependsOn: JSON.stringify(["builder"]),
            status: "running",
            attempts: 1,
          }),
          makeStepRun({
            id: "step-devops",
            pipelineRunId: "pipe-1",
            stepKey: "devops",
            dependsOn: JSON.stringify(["quality-guard"]),
            status: "pending",
            attempts: 0,
          }),
        ],
      },
    });

    const dispatcher = new PipelineDispatcher(db);
    const enqueueSpy = vi.spyOn(dispatcher, "enqueueEligibleSteps").mockResolvedValue(["builder"]);

    await dispatcher.handleStepSuccess(
      "step-qg",
      `Reviewer verdict:
{"decision":"REJECTED","issues":["Missing tests","Fix lint"]}`,
    );

    const updateCalls = db.pipelineStepRun.update.mock.calls.map((call: any[]) => call[0]);
    const builderReset = updateCalls.find(
      (call: any) => call.where?.pipelineRunId_stepKey?.stepKey === "builder",
    );
    const devopsReset = updateCalls.find(
      (call: any) => call.where?.pipelineRunId_stepKey?.stepKey === "devops",
    );

    expect(builderReset).toBeDefined();
    expect(builderReset.data.status).toBe("pending");
    expect(builderReset.data.inputSnapshot).toContain("REVISION 2");
    expect(builderReset.data.inputSnapshot).toContain("Missing tests");
    expect(devopsReset).toBeDefined();
    expect(devopsReset.data.status).toBe("pending");
    expect(enqueueSpy).toHaveBeenCalledWith("pipe-1");
  });

  it("hard-fails the pipeline when max revisions is reached", async () => {
    const db = createMockDb();
    db.pipelineStepRun.update.mockResolvedValue(undefined);
    db.pipelineStepRun.findUnique.mockResolvedValue({
      id: "step-qg",
      pipelineRunId: "pipe-1",
      stepKey: "quality-guard",
      status: "running",
      pipelineRun: {
        id: "pipe-1",
        requestType: "feature",
        issueId: null,
        planJson: JSON.stringify([
          { key: "builder", input: "Build feature" },
          { key: "quality-guard", input: "Review output", loopsBackTo: "builder", maxRevisions: 2 },
        ]),
        stepRuns: [
          makeStepRun({
            id: "step-builder",
            pipelineRunId: "pipe-1",
            stepKey: "builder",
            dependsOn: JSON.stringify(["architect"]),
            status: "completed",
            attempts: 2,
          }),
          makeStepRun({
            id: "step-qg",
            pipelineRunId: "pipe-1",
            stepKey: "quality-guard",
            dependsOn: JSON.stringify(["builder"]),
            status: "running",
            attempts: 1,
          }),
        ],
      },
    });

    const dispatcher = new PipelineDispatcher(db);
    const failSpy = vi.spyOn(dispatcher, "handleStepFailure").mockResolvedValue(undefined);

    await dispatcher.handleStepSuccess(
      "step-qg",
      `{"decision":"REJECTED","issues":["Still broken"]}`,
    );

    expect(failSpy).toHaveBeenCalledWith(
      "step-qg",
      expect.stringContaining("Max revisions (2) reached"),
      false,
    );
  });

  it("proceeds normally when reviewer approves", async () => {
    const db = createMockDb();
    db.pipelineStepRun.update.mockResolvedValue(undefined);
    db.pipelineStepRun.findUnique.mockResolvedValue({
      id: "step-qg",
      pipelineRunId: "pipe-1",
      stepKey: "quality-guard",
      status: "running",
      pipelineRun: {
        id: "pipe-1",
        requestType: "feature",
        issueId: null,
        planJson: JSON.stringify([
          { key: "builder", input: "Build feature" },
          { key: "quality-guard", input: "Review output", loopsBackTo: "builder", maxRevisions: 2 },
          { key: "devops", input: "Deploy output" },
        ]),
        stepRuns: [
          makeStepRun({
            id: "step-builder",
            pipelineRunId: "pipe-1",
            stepKey: "builder",
            dependsOn: JSON.stringify(["architect"]),
            status: "completed",
            attempts: 1,
          }),
          makeStepRun({
            id: "step-qg",
            pipelineRunId: "pipe-1",
            stepKey: "quality-guard",
            dependsOn: JSON.stringify(["builder"]),
            status: "running",
            attempts: 0,
          }),
          makeStepRun({
            id: "step-devops",
            pipelineRunId: "pipe-1",
            stepKey: "devops",
            dependsOn: JSON.stringify(["quality-guard"]),
            status: "pending",
            attempts: 0,
          }),
        ],
      },
    });

    const dispatcher = new PipelineDispatcher(db);
    const enqueueSpy = vi.spyOn(dispatcher, "enqueueEligibleSteps").mockResolvedValue(["devops"]);
    const failSpy = vi.spyOn(dispatcher, "handleStepFailure").mockResolvedValue(undefined);

    await dispatcher.handleStepSuccess(
      "step-qg",
      `{"decision":"APPROVED","issues":[]}`,
    );

    expect(enqueueSpy).toHaveBeenCalledWith("pipe-1");
    expect(failSpy).not.toHaveBeenCalled();
    const resetCalls = db.pipelineStepRun.update.mock.calls
      .map((call: any[]) => call[0])
      .filter((call: any) => call.where?.pipelineRunId_stepKey);
    expect(resetCalls).toHaveLength(0);
  });

  it("invokes harness sprint injection after planner artifact validation", async () => {
    const db = createMockDb();
    db.pipelineStepRun.findUnique.mockResolvedValue({
      id: "step-planner",
      pipelineRunId: "pipe-1",
      stepKey: "planner",
      status: "running",
      agentSlug: "planner",
      inputSnapshot: "Expand request",
      pipelineRun: {
        id: "pipe-1",
        issueId: "issue-1",
        requestType: "harness",
        planJson: JSON.stringify([{ key: "planner", input: "Expand request", dependsOn: [] }]),
        stepRuns: [
          makeStepRun({
            id: "step-planner",
            pipelineRunId: "pipe-1",
            stepKey: "planner",
            status: "running",
          }),
        ],
      },
    });
    db.pipelineStepRun.update.mockResolvedValue(undefined);

    const productSpec = {
      artifactType: "ProductSpec",
      title: "Spec title",
      summary: "Spec summary",
      features: [{ id: "f1", title: "Feature 1", description: "Do thing" }],
      constraints: [],
      sprints: [
        { number: 1, goal: "Sprint 1", featureIds: ["f1"] },
        { number: 2, goal: "Sprint 2", featureIds: ["f1"] },
        { number: 3, goal: "Sprint 3", featureIds: ["f1"] },
      ],
    };

    getHarnessArtifactTypeMock.mockReturnValue("ProductSpec");
    extractStructuredArtifactMock.mockReturnValue(productSpec);
    validateAndStoreArtifactMock.mockResolvedValue("wp-1");

    const dispatcher = new PipelineDispatcher(db);
    const appendSpy = vi.spyOn(dispatcher as any, "appendSprintSteps").mockResolvedValue(undefined);
    vi.spyOn(dispatcher, "enqueueEligibleSteps").mockResolvedValue(["sprint-1-contract"]);

    await dispatcher.handleStepSuccess("step-planner", "planner output");

    expect(validateAndStoreArtifactMock).toHaveBeenCalled();
    expect(appendSpy).toHaveBeenCalledWith("pipe-1", productSpec);
  });

  it("fails harness step when artifact validation throws", async () => {
    const db = createMockDb();
    db.pipelineStepRun.findUnique.mockResolvedValue({
      id: "step-planner",
      pipelineRunId: "pipe-1",
      stepKey: "planner",
      status: "running",
      agentSlug: "planner",
      inputSnapshot: "Expand request",
      pipelineRun: {
        id: "pipe-1",
        issueId: "issue-1",
        requestType: "harness",
        planJson: JSON.stringify([{ key: "planner", input: "Expand request", dependsOn: [] }]),
        stepRuns: [
          makeStepRun({
            id: "step-planner",
            pipelineRunId: "pipe-1",
            stepKey: "planner",
            status: "running",
          }),
        ],
      },
    });

    getHarnessArtifactTypeMock.mockReturnValue("ProductSpec");
    extractStructuredArtifactMock.mockReturnValue({ artifactType: "ProductSpec" });
    validateAndStoreArtifactMock.mockRejectedValue(new Error("invalid artifact payload"));

    const dispatcher = new PipelineDispatcher(db);
    const failSpy = vi.spyOn(dispatcher, "handleStepFailure").mockResolvedValue(undefined);

    await dispatcher.handleStepSuccess("step-planner", "bad output");

    expect(failSpy).toHaveBeenCalledWith("step-planner", "invalid artifact payload", false);
  });
});

describe("parseReviewerDecision", () => {
  it("parses a valid decision JSON block", () => {
    const parsed = parseReviewerDecision(`Notes\n{"decision":"APPROVED","issues":[]}`);
    expect(parsed).toEqual({ decision: "APPROVED", issues: [] });
  });

  it("returns null when no decision JSON exists", () => {
    expect(parseReviewerDecision("No JSON here")).toBeNull();
  });

  it("returns the last decision JSON block when multiple exist", () => {
    const parsed = parseReviewerDecision(
      `{"decision":"APPROVED","issues":[]}\nother text\n{"decision":"REJECTED","issues":["Fix tests"]}`,
    );
    expect(parsed).toEqual({ decision: "REJECTED", issues: ["Fix tests"] });
  });

  it("returns null when decision JSON is malformed", () => {
    expect(parseReviewerDecision(`{"decision":"REJECTED"`)).toBeNull();
  });
});
