import { Command } from "commander";
import { existsSync } from "fs";
import { mkdir, writeFile, copyFile, readdir } from "fs/promises";
import { join, resolve } from "path";
import { homedir } from "os";
import { intro, outro, text, confirm, select, p } from "../prompts.js";
import { loadConfig } from "../../utils/config.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger("init");

const TEMPLATES_DIR = join(import.meta.dirname, "..", "..", "scaffold", "templates");

export function initCommand(): Command {
  return new Command("init")
    .description("Initialize Forge in the current project")
    .action(runInit);
}

async function runInit(): Promise<void> {
  intro("Forge v3 — AI Agent Orchestration");

  const s = p.spinner();

  // --- Project ---
  const projectName = await text({
    message: "Project name:",
    defaultValue: resolve(process.cwd()).split("/").pop() ?? "my-project",
  });

  const projectPath = await text({
    message: "Project path:",
    defaultValue: process.cwd(),
    placeholder: process.cwd(),
  });

  const stack = await select({
    message: "Technology stack:",
    options: [
      { value: "nodejs", label: "Node.js / TypeScript" },
      { value: "kmp", label: "Kotlin Multiplatform (KMP)" },
      { value: "python", label: "Python" },
      { value: "go", label: "Go" },
      { value: "rust", label: "Rust" },
      { value: "java", label: "Java / Spring" },
      { value: "other", label: "Other" },
    ],
  });

  const description = await text({
    message: "Project description:",
    placeholder: "A short description of what this project does",
  });

  // --- Company ---
  const companyName = await text({
    message: "Company name:",
    defaultValue: "My Forge",
  });

  // --- Claude CLI ---
  const config = loadConfig();
  const claudePath = await text({
    message: "Claude CLI path:",
    defaultValue: config.claudePath,
  });

  // --- Budget ---
  const enableBudget = await confirm({
    message: "Enable budget tracking?",
    initialValue: true,
  });

  let monthlyBudget = "0";
  if (enableBudget) {
    monthlyBudget = await text({
      message: "Monthly budget limit (USD):",
      defaultValue: "50.00",
      validate: (v) => (isNaN(parseFloat(v)) ? "Must be a number" : undefined),
    });
  }

  // --- Setup ---
  s.start("Setting up Forge...");

  const absProjectPath = resolve(projectPath);
  const forgeDir = join(absProjectPath, ".forge");

  try {
    // 1. Create .forge directory structure
    for (const dir of [
      join(forgeDir, "context"),
      join(forgeDir, "memory", "retrospectives"),
      join(forgeDir, "sprints"),
      join(forgeDir, "skills"),
      join(forgeDir, "agents"),
    ]) {
      await mkdir(dir, { recursive: true });
    }

    // 2. Copy static templates
    const staticCopies: [string, string][] = [
      ["context/conventions.md", "context/conventions.md"],
      ["context/standards.md", "context/standards.md"],
      ["memory/decisions.md", "memory/decisions.md"],
      ["memory/patterns.md", "memory/patterns.md"],
      ["memory/problems.md", "memory/problems.md"],
      ["sprints/active_sprint.json", "sprints/active_sprint.json"],
      ["sprints/backlog.json", "sprints/backlog.json"],
    ];

    for (const [src, dst] of staticCopies) {
      const srcPath = join(TEMPLATES_DIR, src);
      if (existsSync(srcPath)) {
        await copyFile(srcPath, join(forgeDir, dst));
      }
    }

    // 3. Render project.md from template
    const date = new Date().toISOString().split("T")[0];
    const projectMd = renderProjectMd({ projectName, description, stack, date });
    await writeFile(join(forgeDir, "context", "project.md"), projectMd);

    // 4. Write config.json
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const forgeConfig = {
      version: "3.0.0",
      company: { name: companyName, slug },
      project: { name: projectName, path: absProjectPath, stack },
      claude: { path: claudePath },
      budget: {
        enabled: enableBudget,
        monthlyLimitUsd: parseFloat(monthlyBudget),
      },
    };
    await writeFile(join(forgeDir, "config.json"), JSON.stringify(forgeConfig, null, 2));

    // 5. Render README.md
    const readme = renderReadme({ projectName, description, stack, date });
    const readmePath = join(absProjectPath, "README.md");
    if (!existsSync(readmePath)) {
      await writeFile(readmePath, readme);
    }

    // 6. Write .gitignore entry
    const gitignorePath = join(absProjectPath, ".gitignore");
    const gitignoreEntry = "\n# Forge secrets\n.forge/config.json\n";
    if (existsSync(gitignorePath)) {
      const { appendFileSync } = await import("fs");
      appendFileSync(gitignorePath, gitignoreEntry);
    } else {
      await writeFile(gitignorePath, gitignoreEntry.trim() + "\n");
    }

    // 7. Sync with server if running
    try {
      const res = await fetch(`http://localhost:${forgeConfig.version ? config.port : 3131}/v1/init`, {
        method: "POST",
      });
      if (res.ok) {
        p.log.success(`Database seeded and server synchronized.`);
      } else {
        p.log.warn(`Server init failed. Run forge start to apply changes.`);
      }
    } catch {
      p.log.warn(`Forge server not running. Run \x1b[1mnpx forge start\x1b[0m to apply changes to database.`);
    }

    s.stop("Forge initialized.");

    p.log.success(`Company "${companyName}" configured`);
    p.log.success(`Project scaffolded at .forge/`);
    p.log.success(`9 default agents ready`);
    if (enableBudget) {
      p.log.success(`Budget tracking: $${monthlyBudget}/month`);
    }

    outro(`Ready. Run \x1b[1mnpx forge start\x1b[0m to launch.`);
  } catch (err) {
    s.stop("Setup failed.");
    log.error({ err }, "Init failed");
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

function renderProjectMd(d: {
  projectName: string;
  description: string;
  stack: string;
  date: string;
}): string {
  return `# Project Context

## Project
${d.projectName}

## Description
${d.description}

## Stack
${d.stack}

## Architecture
[Describe the architectural pattern — e.g. Clean Architecture, MVC, Layered]

## Current Status
New project — setup phase.

## Goals
[Describe the goals of this project]

---
_Generated by Forge v3 — ${d.date}_
`;
}

function renderReadme(d: {
  projectName: string;
  description: string;
  stack: string;
  date: string;
}): string {
  return `# ${d.projectName}

${d.description}

## Stack
${d.stack}

---

## Managed by Forge

This project is managed by **Forge** — an AI agent orchestration platform.

\`\`\`bash
npx forge start          # Launch the agent team
npx forge issue create   # Create a new task
npx forge status         # Check system status
\`\`\`

---
_Scaffolded by Forge v3 — ${d.date}_
`;
}
