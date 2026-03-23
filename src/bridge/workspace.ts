import { join } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync, rmSync } from "fs";
import { execSync } from "child_process";
import { getDb } from "../db/client.js";
import { createChildLogger } from "../utils/logger.js";
import { loadConfig } from "../utils/config.js";

const log = createChildLogger("workspace");

export interface ResolvedWorkspace {
  workspacePath: string;
  workspaceId: string;
}

/**
 * Resolves or creates an execution workspace for a given issue.
 */
export async function resolveWorkspace(
  issueId: string,
  companyId: string,
  agentSlug: string
): Promise<string> {
  const db = getDb();
  const config = loadConfig();
  
  // 1. Check if workspace already exists for this issue
  const existing = await db.executionWorkspace.findUnique({
    where: { issueId }
  });

  if (existing && existing.status === "active") {
    log.info({ issueId, path: existing.workspacePath }, "Using existing active workspace");
    return existing.workspacePath;
  }

  // 2. Determine policy
  // @ts-ignore - workspace field will be added to config
  const policy = config.workspace?.policy || "shared";
  const baseDir = join(homedir(), ".forge", "workspaces");
  const workspacePath = policy === "shared" ? process.cwd() : join(baseDir, issueId);

  log.info({ issueId, policy, workspacePath }, "Resolving workspace");

  if (policy === "shared") {
    await db.executionWorkspace.upsert({
      where: { issueId },
      create: {
        issueId,
        agentSlug,
        policy,
        workspacePath,
        status: "active",
      },
      update: {
        agentSlug,
        policy,
        workspacePath,
        status: "active",
        cleanedAt: null,
      }
    });
    return workspacePath;
  }

  // Ensure base workspaces directory exists
  if (!existsSync(baseDir)) {
    mkdirSync(baseDir, { recursive: true });
  }

  // Cleanup if directory exists but record says it shouldn't (defensive)
  if (existsSync(workspacePath)) {
    log.warn({ workspacePath }, "Workspace path already exists, cleaning up before recreation");
    rmSync(workspacePath, { recursive: true, force: true });
  }

  let branchName: string | null = null;

  if (policy === "per_task") {
    mkdirSync(workspacePath, { recursive: true });
    // Copy project files excluding .git and node_modules (basic sync)
    // Using rsync if available, otherwise fallback to cp
    try {
      execSync(`rsync -aq --exclude='.git' --exclude='node_modules' --exclude='.forge/workspaces' ./ "${workspacePath}/"`, {
        cwd: process.cwd(),
      });
    } catch (e) {
      log.warn({ err: (e as Error).message }, "rsync failed, falling back to cp");
      execSync(`cp -R . "${workspacePath}"`, { cwd: process.cwd() });
    }
  } else if (policy === "git_worktree") {
    branchName = `forge/issue-${issueId}`;
    try {
      // Check if branch exists
      const branchExists = execSync(`git branch --list ${branchName}`).toString().trim();
      if (branchExists) {
        log.info({ branchName }, "Branch already exists, using it for worktree");
        execSync(`git worktree add "${workspacePath}" ${branchName}`);
      } else {
        execSync(`git worktree add "${workspacePath}" -b ${branchName}`);
      }
    } catch (e) {
      log.error({ err: (e as Error).message }, "Failed to create git worktree");
      throw new Error(`Failed to create git worktree: ${(e as Error).message}`);
    }
  }

  await db.executionWorkspace.upsert({
    where: { issueId },
    create: {
      issueId,
      agentSlug,
      policy,
      workspacePath,
      branchName,
      status: "active",
    },
    update: {
      agentSlug,
      policy,
      workspacePath,
      branchName,
      status: "active",
      cleanedAt: null,
    }
  });

  return workspacePath;
}

/**
 * Cleans up an execution workspace based on its policy.
 */
export async function cleanWorkspace(issueId: string): Promise<void> {
  const db = getDb();
  const workspace = await db.executionWorkspace.findUnique({
    where: { issueId }
  });

  if (!workspace || workspace.status === "cleaned") {
    return;
  }

  log.info({ issueId, policy: workspace.policy, path: workspace.workspacePath }, "Cleaning up workspace");

  try {
    if (workspace.policy === "per_task") {
      if (existsSync(workspace.workspacePath)) {
        rmSync(workspace.workspacePath, { recursive: true, force: true });
      }
    } else if (workspace.policy === "git_worktree") {
      if (existsSync(workspace.workspacePath)) {
        try {
          execSync(`git worktree remove "${workspace.workspacePath}" --force`);
        } catch (e) {
          log.warn({ err: (e as Error).message }, "Failed to remove git worktree");
        }
      }
    }

    await db.executionWorkspace.update({
      where: { id: workspace.id },
      data: {
        status: "cleaned",
        cleanedAt: new Date(),
      }
    });
  } catch (e) {
    log.error({ err: (e as Error).message }, "Error during workspace cleanup");
  }
}
