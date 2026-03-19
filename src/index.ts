/**
 * Forge v3 — Programmatic API
 *
 * For use when embedding Forge in another Node.js application
 * rather than running it via the CLI.
 */

export { createServer } from "./server/index.js";
export { getQueue, closeQueue, enqueueAgentJob } from "./bridge/queue.js";
export { createAgentWorker, closeWorker } from "./bridge/worker.js";
export { startHeartbeatScheduler, stopHeartbeatScheduler, syncHeartbeatJobs } from "./heartbeat/scheduler.js";
export { FirmOrchestrator } from "./orchestrator/index.js";
export { SkillEngine } from "./orchestrator/skill-engine.js";
export { AgentRegistry } from "./agents/registry.js";
export { transitionAgent } from "./agents/lifecycle.js";
export { buildHierarchy, getEscalationChain } from "./agents/hierarchy.js";
export { BudgetGate } from "./bridge/budget-gate.js";
export { getDb, disconnectDb } from "./db/client.js";
export { runMigrations } from "./db/migrate.js";
export { seedDatabase } from "./db/seed.js";
export { loadConfig } from "./utils/config.js";
export type { AgentJobData } from "./bridge/queue.js";
export type { PipelineStep, DispatchResult } from "./orchestrator/index.js";
