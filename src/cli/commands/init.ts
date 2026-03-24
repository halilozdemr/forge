import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import { mkdir, writeFile, copyFile } from "fs/promises";
import { join, resolve, dirname } from "path";
import { execSync } from "child_process";
import os, { homedir } from "os";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { intro, outro, text, confirm, select, p } from "../prompts.js";
import { loadConfig } from "../../utils/config.js";
import { createChildLogger } from "../../utils/logger.js";
import { PROVIDER_PRESETS, ProviderStrategy, CustomAgentDef } from "../../db/seed.js";
import { syncProjectOpenCodeConfig } from "../../opencode/project-config.js";

const log = createChildLogger("init");

const TEMPLATES_DIR = join(import.meta.dirname, "..", "..", "scaffold", "templates");

export function initCommand(): Command {
  return new Command("init")
    .description("Initialize Forge in the current project")
    .option("-y, --yes", "Quickstart: accept all defaults, skip interactive prompts")
    .action(runInit);
}

export type Provider =
  | "claude-cli"
  | "gemini-cli"
  | "gemini-api"
  | "codex-cli"
  | "opencode-cli"
  | "openrouter"
  | "anthropic-api"
  | "openai"
  | "ollama";

// ─── Detection helpers ─────────────────────────────────────────────────────────

function detectBinary(
  name: string,
  candidates: string[],
  versionFlag = "--version"
): { path: string; version: string } | null {
  for (const candidate of candidates.filter(Boolean)) {
    try {
      const out = execSync(`"${candidate}" ${versionFlag} 2>&1`, { timeout: 5000 })
        .toString().trim();
      return { path: candidate, version: out.split("\n")[0] ?? out };
    } catch { continue; }
  }
  try {
    const out = execSync(`${name} ${versionFlag} 2>&1`, { timeout: 5000 }).toString().trim();
    return { path: name, version: out.split("\n")[0] ?? out };
  } catch { return null; }
}

function detectClaudeCli() {
  return detectBinary("claude", [
    process.env.CLAUDE_CLI_PATH ?? "",
    `${process.env.HOME}/.local/bin/claude`,
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ]);
}

function detectGeminiCli() {
  return detectBinary("gemini", [
    process.env.GEMINI_CLI_PATH ?? "",
    `${process.env.HOME}/.local/bin/gemini`,
    "/usr/local/bin/gemini",
    "/opt/homebrew/bin/gemini",
  ]);
}

function detectCodexCli() {
  return detectBinary("codex", [
    process.env.CODEX_CLI_PATH ?? "",
    `${process.env.HOME}/.local/bin/codex`,
    "/usr/local/bin/codex",
  ]);
}

function detectOpenCodeCli() {
  return detectBinary("opencode", [
    process.env.OPENCODE_CLI_PATH ?? "",
    `${process.env.HOME}/.local/bin/opencode`,
    "/usr/local/bin/opencode",
    "/opt/homebrew/bin/opencode",
  ]);
}

function detectClaudeConfiguredModel(): string | null {
  // Claude CLI has no `models` subcommand. Read configured model from settings if possible.
  const candidates = [
    join(homedir(), ".claude", "settings.json"),
    join(homedir(), ".config", "claude", "settings.json"),
  ];
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue;
      const data = JSON.parse(readFileSync(p, "utf-8")) as { model?: string };
      if (data.model) return data.model;
    } catch { /* ignore */ }
  }
  return null;
}

function detectCodexModels(): string[] | null {
  // Read from ~/.codex/models_cache.json (Codex CLI caches available models here)
  const cachePath = join(homedir(), ".codex", "models_cache.json");
  try {
    if (!existsSync(cachePath)) return null;
    const data = JSON.parse(readFileSync(cachePath, "utf-8")) as {
      models?: Array<{ slug: string; visibility?: string }>;
    };
    const models = (data.models ?? [])
      .filter((m) => m.visibility !== "hidden")
      .map((m) => m.slug)
      .filter(Boolean);
    return models.length > 0 ? models : null;
  } catch {
    return null;
  }
}

async function probeOllama(baseUrl: string): Promise<{ running: boolean; models: string[] }> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { running: false, models: [] };
    const data = await res.json() as { models?: Array<{ name: string }> };
    const models = (data.models ?? []).map((m) => m.name);
    return { running: true, models };
  } catch {
    return { running: false, models: [] };
  }
}

// ─── Dynamic model fetch functions ─────────────────────────────────────────────
// Philosophy: always fetch live — new models (e.g. Claude 4.7) appear automatically.
// Hardcoded fallbacks only if network unreachable.

async function fetchOpenRouterModels(key: string): Promise<string[] | null> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { data?: Array<{ id: string; context_length?: number }> };
    if (!data.data?.length) return null;

    const PRIORITY = [
      "anthropic/claude-sonnet-4-6",
      "anthropic/claude-opus-4-6",
      "openai/gpt-4o",
      "google/gemini-2.5-pro",
      "deepseek/deepseek-r1",
      "deepseek/deepseek-v3",
      "moonshotai/kimi-k2.5",
      "google/gemini-2.0-flash",
      "openai/gpt-4o-mini",
      "meta-llama/llama-3.3-70b-instruct",
    ];

    const ids = data.data.map((m) => m.id);
    const prioritized = PRIORITY.filter((p) => ids.some((id) => id.startsWith(p.split(":")[0])));
    const remaining = ids.filter((id) => !prioritized.some((p) => id.startsWith(p.split(":")[0])));
    return [...prioritized.map((p) => ids.find((id) => id.startsWith(p.split(":")[0])) ?? p), ...remaining];
  } catch {
    return null;
  }
}

async function fetchAnthropicModels(key: string): Promise<string[] | null> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { data?: Array<{ id: string }> };
    return data.data?.map((m) => m.id) ?? null;
  } catch {
    return null;
  }
}

async function fetchOpenAIModels(key: string): Promise<string[] | null> {
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { data?: Array<{ id: string }> };
    if (!data.data?.length) return null;

    const PRIORITY = ["o3", "o4-mini", "gpt-4o", "gpt-4o-mini"];
    const filtered = data.data
      .map((m) => m.id)
      .filter((id) => id.startsWith("gpt-") || /^o\d/.test(id))
      .sort((a, b) => {
        const ai = PRIORITY.findIndex((p) => a.startsWith(p));
        const bi = PRIORITY.findIndex((p) => b.startsWith(p));
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return b.localeCompare(a);
      });
    return filtered.length ? filtered : null;
  } catch {
    return null;
  }
}

async function fetchGeminiApiModels(key: string): Promise<string[] | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json() as {
      models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
    };
    if (!data.models?.length) return null;

    return data.models
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""))
      .sort((a, b) => {
        const priority = ["gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"];
        const ai = priority.findIndex((p) => a.startsWith(p));
        const bi = priority.findIndex((p) => b.startsWith(p));
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return a.localeCompare(b);
      });
  } catch {
    return null;
  }
}

// Hardcoded fallback lists (last resort — labeled "fallback" in UI)
const FALLBACK_MODELS: Partial<Record<Provider, string[]>> = {
  openrouter: [
    "anthropic/claude-sonnet-4-6",
    "openai/gpt-4o",
    "google/gemini-2.5-pro",
    "deepseek/deepseek-r1:free",
    "deepseek/deepseek-v3-0324:free",
    "moonshotai/kimi-k2.5",
    "google/gemini-2.0-flash-001",
    "openai/gpt-4o-mini",
  ],
  "anthropic-api": ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"],
  openai: ["gpt-4o", "o3", "gpt-4o-mini"],
  "gemini-api": ["gemini-2.5-pro", "gemini-2.0-flash"],
};

// ─── Main ──────────────────────────────────────────────────────────────────────

async function runInit(opts: { yes?: boolean }): Promise<void> {
  intro("Forge v3 — AI Agent Orchestration");

  const quickstart = opts.yes ?? false;

  // ── Detect local CLIs synchronously ─────────────────────────────────────────
  const detectedClaude    = detectClaudeCli();
  const detectedGemini    = detectGeminiCli();
  const detectedCodex     = detectCodexCli();
  const detectedOpenCode  = detectOpenCodeCli();

  if (detectedClaude)    p.log.success(`Claude Code CLI  detected: ${detectedClaude.version}`);
  else                   p.log.warn("Claude Code CLI not found — install from https://claude.ai/code");
  if (detectedGemini)    p.log.success(`Gemini CLI       detected: ${detectedGemini.version}`);
  if (detectedCodex)     p.log.success(`Codex CLI        detected: ${detectedCodex.version}`);
  if (detectedOpenCode)  p.log.success(`OpenCode CLI     detected: ${detectedOpenCode.version}`);

  const hasClaude    = !!detectedClaude;
  const hasGemini    = !!detectedGemini;
  const hasCodex     = !!detectedCodex;
  const hasOpenCode  = !!detectedOpenCode;

  // ── Fire Ollama probe + env-key model fetches in parallel early ──────────────
  // These run while the user reads/interacts, so results are ready when needed.
  const defaultOllamaBaseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const ollamaProbePromise = quickstart ? Promise.resolve({ running: false, models: [] as string[] }) : probeOllama(defaultOllamaBaseUrl);

  // Detect configured models from CLI config files (sync reads)
  const claudeConfiguredModel = hasClaude ? detectClaudeConfiguredModel() : null;
  const codexDetectedModels   = hasCodex  ? detectCodexModels()           : null;

  // Pre-fetch models for keys already in env (quickstart gets dynamic models too)
  const envOpenRouterKey  = process.env.OPENROUTER_API_KEY ?? "";
  const envAnthropicKey   = process.env.ANTHROPIC_API_KEY  ?? "";
  const envOpenAIKey      = process.env.OPENAI_API_KEY     ?? "";
  const envGeminiApiKey   = process.env.GOOGLE_AI_API_KEY  ?? "";

  const prefetchPromises = {
    openrouter:    envOpenRouterKey ? fetchOpenRouterModels(envOpenRouterKey) : Promise.resolve(null),
    "anthropic-api": envAnthropicKey  ? fetchAnthropicModels(envAnthropicKey)   : Promise.resolve(null),
    openai:        envOpenAIKey      ? fetchOpenAIModels(envOpenAIKey)          : Promise.resolve(null),
    "gemini-api":  envGeminiApiKey   ? fetchGeminiApiModels(envGeminiApiKey)    : Promise.resolve(null),
  };

  // ── Setup path ───────────────────────────────────────────────────────────────
  let advanced = false;
  if (!quickstart) {
    const setupPath = await select({
      message: "Setup path:",
      options: [
        { value: "quickstart", label: "Quickstart", hint: "Sensible defaults, ready to run in 30 seconds" },
        { value: "advanced",   label: "Advanced",   hint: "Customize providers, models, agents, and more" },
      ],
    });
    advanced = setupPath === "advanced";
  }

  // ── Project info ─────────────────────────────────────────────────────────────
  const defaultProjectName = resolve(process.cwd()).split("/").pop() ?? "my-project";
  const defaultCompanyName = "My Forge";

  let projectName  = defaultProjectName;
  let projectPath  = process.cwd();
  let stack        = "other";
  let description  = "";
  let companyName  = defaultCompanyName;

  if (advanced) {
    projectName = await text({ message: "Project name:", defaultValue: defaultProjectName });
    projectPath = await text({ message: "Project path:", defaultValue: process.cwd(), placeholder: process.cwd() });
    stack = await select({
      message: "Technology stack:",
      options: [
        { value: "nodejs",  label: "Node.js / TypeScript" },
        { value: "kmp",     label: "Kotlin Multiplatform (KMP)" },
        { value: "python",  label: "Python" },
        { value: "go",      label: "Go" },
        { value: "rust",    label: "Rust" },
        { value: "java",    label: "Java / Spring" },
        { value: "other",   label: "Other" },
      ],
    });
    description = await text({ message: "Project description:", placeholder: "A short description of what this project does" });
    companyName = await text({ message: "Company / team name:", defaultValue: defaultCompanyName });
  }

  // ── Claude CLI path (advanced only) ─────────────────────────────────────────
  let claudePath = detectedClaude?.path ?? "claude";
  if (advanced && !hasClaude) {
    claudePath = await text({ message: "Claude CLI path:", defaultValue: detectedClaude!.path });
  }

  // ── AI Providers ─────────────────────────────────────────────────────────────
  const availableProviders: Provider[] = [
    ...(hasClaude   ? ["claude-cli"    as Provider] : []),
    ...(hasGemini   ? ["gemini-cli"    as Provider] : []),
    ...(hasCodex    ? ["codex-cli"     as Provider] : []),
    ...(hasOpenCode ? ["opencode-cli"  as Provider] : []),
  ];

  let openrouterKey = envOpenRouterKey;
  let anthropicKey  = envAnthropicKey;
  let openaiKey     = envOpenAIKey;
  let geminiApiKey  = envGeminiApiKey;
  let ollamaBaseUrl = "";

  // Dynamic model registry — populated as keys are validated
  const fetchedModels = new Map<Provider, string[]>();

  // Seed CLI detected models so buildModelOptions shows them
  if (claudeConfiguredModel) fetchedModels.set("claude-cli", [claudeConfiguredModel]);
  if (codexDetectedModels)   fetchedModels.set("codex-cli",  codexDetectedModels);

  // Apply any prefetched models from env keys
  const applyPrefetch = async (provider: Provider, promise: Promise<string[] | null>) => {
    const models = await promise;
    if (models && models.length > 0) fetchedModels.set(provider, models);
  };

  if (!quickstart) {
    const s = p.spinner();

    // ── OpenCode CLI (if not detected) ───────────────────────────────────────
    if (!hasOpenCode) {
      const wantsOpenCode = await confirm({ message: "Do you have OpenCode CLI installed? (opencode)", initialValue: false });
      if (wantsOpenCode) availableProviders.push("opencode-cli");
    }

    // ── Gemini CLI (if not detected) ─────────────────────────────────────────
    if (!hasGemini) {
      const wantsGemini = await confirm({ message: "Do you have Google Gemini CLI installed? (gemini)", initialValue: false });
      if (wantsGemini) availableProviders.push("gemini-cli");
    }

    // ── Codex CLI (if not detected) ──────────────────────────────────────────
    if (!hasCodex) {
      const wantsCodex = await confirm({ message: "Do you have OpenAI Codex CLI installed? (codex)", initialValue: false });
      if (wantsCodex) availableProviders.push("codex-cli");
    }

    // ── OpenRouter ───────────────────────────────────────────────────────────
    const wantsOpenRouter = await confirm({
      message: openrouterKey
        ? "OpenRouter — key detected in env. Include it?"
        : "Do you have an OpenRouter account? (openrouter.ai — 200+ models, free tier available)",
      initialValue: !!openrouterKey,
    });
    if (wantsOpenRouter) {
      availableProviders.push("openrouter");
      if (!openrouterKey) {
        openrouterKey = await text({
          message: "OpenRouter API key:",
          placeholder: "sk-or-v1-...",
          validate: (v) => (v.trim().length < 10 ? "Key looks too short" : undefined),
        });
      }
      s.start("Validating OpenRouter key and fetching models...");
      const models = await fetchOpenRouterModels(openrouterKey);
      if (models && models.length > 0) {
        fetchedModels.set("openrouter", models);
        s.stop(`OpenRouter key valid ✓ — ${models.length} models loaded`);
      } else {
        s.stop("Could not fetch models — using built-in fallback list");
      }
    }

    // ── Anthropic API ────────────────────────────────────────────────────────
    const wantsAnthropic = await confirm({
      message: anthropicKey
        ? "Anthropic API — key detected in env. Include it?"
        : "Do you have an Anthropic API key? (console.anthropic.com)",
      initialValue: !!anthropicKey,
    });
    if (wantsAnthropic) {
      availableProviders.push("anthropic-api");
      if (!anthropicKey) {
        anthropicKey = await text({
          message: "Anthropic API key:",
          placeholder: "sk-ant-...",
          validate: (v) => (v.trim().length < 10 ? "Key looks too short" : undefined),
        });
      }
      s.start("Validating Anthropic key and fetching models...");
      const models = await fetchAnthropicModels(anthropicKey);
      if (models && models.length > 0) {
        fetchedModels.set("anthropic-api", models);
        s.stop(`Anthropic API key valid ✓ — ${models.length} models loaded`);
      } else {
        s.stop("Could not fetch models — using built-in fallback list");
      }
    }

    // ── OpenAI API ───────────────────────────────────────────────────────────
    const wantsOpenAI = await confirm({
      message: openaiKey
        ? "OpenAI API — key detected in env. Include it?"
        : "Do you have an OpenAI API key? (platform.openai.com)",
      initialValue: !!openaiKey,
    });
    if (wantsOpenAI) {
      availableProviders.push("openai");
      if (!openaiKey) {
        openaiKey = await text({
          message: "OpenAI API key:",
          placeholder: "sk-...",
          validate: (v) => (v.trim().length < 10 ? "Key looks too short" : undefined),
        });
      }
      s.start("Validating OpenAI key and fetching models...");
      const models = await fetchOpenAIModels(openaiKey);
      if (models && models.length > 0) {
        fetchedModels.set("openai", models);
        s.stop(`OpenAI API key valid ✓ — ${models.length} models loaded`);
      } else {
        s.stop("Could not fetch models — using built-in fallback list");
      }
    }

    // ── Gemini API ───────────────────────────────────────────────────────────
    const wantsGeminiApi = await confirm({
      message: geminiApiKey
        ? "Google Gemini API — key detected in env. Include it?"
        : "Do you have a Google AI Studio API key? (aistudio.google.com — free tier available)",
      initialValue: !!geminiApiKey,
    });
    if (wantsGeminiApi) {
      availableProviders.push("gemini-api");
      if (!geminiApiKey) {
        geminiApiKey = await text({
          message: "Google AI Studio API key:",
          placeholder: "AIza...",
          validate: (v) => (v.trim().length < 10 ? "Key looks too short" : undefined),
        });
      }
      s.start("Validating Gemini API key and fetching models...");
      const models = await fetchGeminiApiModels(geminiApiKey);
      if (models && models.length > 0) {
        fetchedModels.set("gemini-api", models);
        s.stop(`Gemini API key valid ✓ — ${models.length} models loaded`);
      } else {
        s.stop("Could not fetch models — using built-in fallback list");
      }
    }

    // ── Ollama ───────────────────────────────────────────────────────────────
    const wantsOllama = await confirm({
      message: "Do you want to use Ollama? (run models locally, no API key needed)",
      initialValue: false,
    });
    if (wantsOllama) {
      const enteredUrl = await text({
        message: "Ollama base URL:",
        defaultValue: defaultOllamaBaseUrl,
        placeholder: "http://localhost:11434",
      });

      // Use the earlier probe if URL matches default, otherwise re-probe
      let probeResult: { running: boolean; models: string[] };
      if (enteredUrl === defaultOllamaBaseUrl) {
        probeResult = await ollamaProbePromise;
      } else {
        s.start(`Probing Ollama at ${enteredUrl}...`);
        probeResult = await probeOllama(enteredUrl);
        s.stop(probeResult.running
          ? `Ollama reachable — ${probeResult.models.length} model(s) found ✓`
          : `Ollama not reachable at ${enteredUrl}`);
      }

      if (probeResult.running) {
        if (enteredUrl === defaultOllamaBaseUrl) {
          p.log.success(`Ollama reachable — ${probeResult.models.length} model(s) found ✓`);
        }
        availableProviders.push("ollama");
        ollamaBaseUrl = enteredUrl;
        fetchedModels.set("ollama", probeResult.models);
      } else {
        const addAnyway = await confirm({
          message: "Ollama not reachable. Add anyway? (you can start Ollama later)",
          initialValue: false,
        });
        if (addAnyway) {
          availableProviders.push("ollama");
          ollamaBaseUrl = enteredUrl;
          // No models in fetchedModels — user will type model name manually
        }
      }
    }

    if (availableProviders.length === 0) {
      p.log.warn("No providers configured. Agents won't be able to run until you add at least one.");
    }
  } else {
    // Quickstart: silently pick up env keys and apply prefetched models
    await Promise.all([
      wrapPrefetch(prefetchPromises.openrouter,       "openrouter",     openrouterKey, availableProviders, fetchedModels),
      wrapPrefetch(prefetchPromises["anthropic-api"], "anthropic-api",  anthropicKey,  availableProviders, fetchedModels),
      wrapPrefetch(prefetchPromises.openai,           "openai",         openaiKey,     availableProviders, fetchedModels),
      wrapPrefetch(prefetchPromises["gemini-api"],    "gemini-api",     geminiApiKey,  availableProviders, fetchedModels),
    ]);
    if (availableProviders.length === 0) {
      p.log.warn("No providers detected. Run `forge init` (without --yes) to configure.");
    }
  }

  // ── Model strategy ───────────────────────────────────────────────────────────
  let providerStrategy = buildAutoStrategy(availableProviders, fetchedModels);

  if (advanced && availableProviders.length > 1) {
    p.log.step("Agent model assignment (auto-selected):");
    p.log.message(`  Smart agents  (Architect, Reviewer, Debugger): ${providerStrategy.heavy.provider} / ${providerStrategy.heavy.model}`);
    p.log.message(`  Routine agents (PM, Builder, DevOps, Designer): ${providerStrategy.light.provider} / ${providerStrategy.light.model}`);

    const customize = await confirm({ message: "Customize model assignment?", initialValue: false });
    if (customize) {
      const heavyOpts = buildModelOptions(availableProviders, "heavy", fetchedModels);
      const lightOpts = buildModelOptions(availableProviders, "light", fetchedModels);
      const heavyChoice = await select({ message: "Smart agents (Architect, Reviewer, Debugger):", options: heavyOpts });
      const lightChoice = await select({ message: "Routine agents (PM, Builder, DevOps, Designer):", options: lightOpts });
      const [hProv, hModel] = heavyChoice.split("|");
      const [lProv, lModel] = lightChoice.split("|");
      providerStrategy = { heavy: { provider: hProv, model: hModel }, light: { provider: lProv, model: lModel } };
    }
  }

  // ── Budget (advanced only) ────────────────────────────────────────────────────
  let enableBudget  = false;
  let monthlyBudget = "0";

  if (advanced) {
    enableBudget = await confirm({ message: "Enable monthly budget limit?", initialValue: false });
    if (enableBudget) {
      monthlyBudget = await text({
        message: "Monthly budget limit (USD):",
        defaultValue: "50.00",
        validate: (v) => (isNaN(parseFloat(v)) ? "Must be a number" : undefined),
      });
    }
  }

  // ── Telegram notifications ────────────────────────────────────────────────────
  let telegramBotToken = "";
  let telegramChatId   = "";

  const enableTelegram = await confirm({ message: "Enable Telegram notifications?", initialValue: false });
  if (enableTelegram) {
    telegramBotToken = await text({
      message: "Telegram Bot Token (from @BotFather):",
      placeholder: "123456789:AAF...",
      validate: (v) => (!v.trim() ? "Bot token is required" : undefined),
    });
    telegramChatId = await text({
      message: "Telegram Chat ID (your user or group chat ID):",
      placeholder: "-100123456789",
      validate: (v) => (!v.trim() ? "Chat ID is required" : undefined),
    });
  }

  // ── Agent setup (advanced only) ───────────────────────────────────────────────
  let useDefaultAgents = true;
  let customAgents: CustomAgentDef[] | undefined;

  if (advanced) {
    useDefaultAgents = await confirm({
      message: "Use default agents? (9 pre-configured agents: Architect, Builder, Reviewer, Debugger, PM, DevOps, Designer, Scrum Master, Receptionist)",
      initialValue: true,
    });

    if (!useDefaultAgents) {
      customAgents = [];
      const defaultPerms = { task: true, read: true, edit: true, write: true, bash: false };

      // eslint-disable-next-line no-constant-condition
      while (true) {
        p.log.step(`Agents created so far: ${customAgents.length}`);
        const addAgent = await confirm({ message: "Add an agent?", initialValue: true });

        if (!addAgent) {
          if (customAgents.length === 0) {
            p.log.warn("No agents created — system won't be able to process tasks.");
            const continueAnyway = await confirm({ message: "Continue with zero agents?", initialValue: false });
            if (!continueAnyway) continue;
          }
          break;
        }

        const agentName = await text({ message: "Agent name:", placeholder: "e.g. Frontend Builder" });
        const agentRole = await text({ message: "Agent role/description:", placeholder: "e.g. Implements React components" });

        // Derive slug with collision check
        let slug = agentName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "");
        if (customAgents.some((a) => a.slug === slug)) {
          slug = `${slug}_${customAgents.length}`;
        }

        // Provider + model selection — show all available options
        const modelOpts = buildModelOptions(availableProviders, "heavy", fetchedModels);
        let agentProvider = "";
        let agentModel = "";

        if (modelOpts.length > 0) {
          const modelChoice = await select({
            message: `Provider and model for ${agentName}:`,
            options: modelOpts,
          });
          [agentProvider, agentModel] = modelChoice.split("|");
        } else {
          // No providers yet — let user type
          agentProvider = await text({ message: "Provider (e.g. claude-cli, ollama, openrouter):", placeholder: "claude-cli" });
          agentModel    = await text({ message: "Model name:", placeholder: "sonnet" });
        }

        // Handle Ollama with no known models — let user type model name
        if (agentProvider === "ollama" && agentModel === "__type__") {
          agentModel = await text({ message: "Ollama model name:", placeholder: "llama3.2" });
        }

        // reportsTo selection
        const reportsToOpts = [
          { value: "__none__", label: "Nobody (top-level agent)" },
          ...customAgents.map((a) => ({ value: a.slug, label: a.name })),
        ];
        const reportsToRaw = await select({ message: "Reports to:", options: reportsToOpts });
        const reportsTo = reportsToRaw === "__none__" ? null : reportsToRaw;

        customAgents.push({
          slug,
          name: agentName,
          role: agentRole,
          modelProvider: agentProvider,
          model: agentModel,
          reportsTo,
          permissions: defaultPerms,
          heartbeatCron: null,
        });

        p.log.success(`Agent "${agentName}" added (${agentProvider}/${agentModel})`);
      }
    }
  }

  // ── Summary + confirm ─────────────────────────────────────────────────────────
  if (!quickstart) {
    p.log.step("Configuration summary:");
    p.log.message(`  Company:        ${companyName}`);
    p.log.message(`  Project:        ${projectName} (${stack})`);
    p.log.message(`  Providers:      ${availableProviders.join(", ") || "none"}`);
    if (useDefaultAgents) {
      p.log.message(`  Smart agents:   ${providerStrategy.heavy.provider} / ${providerStrategy.heavy.model}`);
      p.log.message(`  Routine agents: ${providerStrategy.light.provider} / ${providerStrategy.light.model}`);
    } else {
      p.log.message(`  Agents:         ${customAgents?.length ?? 0} custom agent(s)`);
      for (const a of customAgents ?? []) {
        p.log.message(`    - ${a.name} (${a.modelProvider}/${a.model})`);
      }
    }
    if (enableBudget) p.log.message(`  Budget:         $${monthlyBudget}/month`);
    if (enableTelegram) p.log.message(`  Telegram:       chat ${telegramChatId}`);

    const ok = await confirm({ message: "Write this configuration?", initialValue: true });
    if (!ok) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
  }

  // ── Write files ───────────────────────────────────────────────────────────────
  const s = p.spinner();
  s.start("Setting up Forge...");

  const absProjectPath = resolve(projectPath);
  const forgeDir = join(absProjectPath, ".forge");

  try {
    // 1. Directory structure
    for (const dir of [
      join(forgeDir, "context"),
      join(forgeDir, "memory", "retrospectives"),
      join(forgeDir, "sprints"),
      join(forgeDir, "skills"),
      join(forgeDir, "agents"),
    ]) {
      await mkdir(dir, { recursive: true });
    }

    // 2. Static templates
    const staticCopies: [string, string][] = [
      ["context/conventions.md", "context/conventions.md"],
      ["context/standards.md",   "context/standards.md"],
      ["memory/decisions.md",    "memory/decisions.md"],
      ["memory/patterns.md",     "memory/patterns.md"],
      ["memory/problems.md",     "memory/problems.md"],
      ["sprints/active_sprint.json", "sprints/active_sprint.json"],
      ["sprints/backlog.json",   "sprints/backlog.json"],
    ];
    for (const [src, dst] of staticCopies) {
      const srcPath = join(TEMPLATES_DIR, src);
      if (existsSync(srcPath)) await copyFile(srcPath, join(forgeDir, dst));
    }

    // 3. project.md
    const date = new Date().toISOString().split("T")[0];
    await writeFile(join(forgeDir, "context", "project.md"), renderProjectMd({ projectName, description, stack, date }));

    // 4. config.json
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const forgeConfig: Record<string, unknown> = {
      version: "3.0.0",
      company: { name: companyName, slug },
      project: { name: projectName, path: absProjectPath, stack },
      claude: { path: claudePath },
      providers: {
        available: availableProviders,
        openrouter:   openrouterKey  ? { apiKey: openrouterKey  } : undefined,
        anthropicApi: anthropicKey   ? { apiKey: anthropicKey   } : undefined,
        openai:       openaiKey      ? { apiKey: openaiKey       } : undefined,
        geminiApi:    geminiApiKey   ? { apiKey: geminiApiKey    } : undefined,
        ollama:       ollamaBaseUrl  ? { baseUrl: ollamaBaseUrl  } : undefined,
      },
      agentStrategy: useDefaultAgents ? providerStrategy : undefined,
      agents:        useDefaultAgents ? undefined : customAgents,
      budget: { enabled: enableBudget, monthlyLimitUsd: parseFloat(monthlyBudget) },
      telegram: enableTelegram ? { botToken: telegramBotToken, chatId: telegramChatId } : undefined,
    };
    await writeFile(join(forgeDir, "config.json"), JSON.stringify(forgeConfig, null, 2));

    // 5. Project-local OpenCode overrides
    await syncProjectOpenCodeConfig(forgeConfig);

    // 6. .env entries
    const envPath = join(absProjectPath, ".env");
    const envLines: string[] = [];
    if (openrouterKey && !process.env.OPENROUTER_API_KEY) envLines.push(`OPENROUTER_API_KEY=${openrouterKey}`);
    if (anthropicKey  && !process.env.ANTHROPIC_API_KEY)  envLines.push(`ANTHROPIC_API_KEY=${anthropicKey}`);
    if (openaiKey     && !process.env.OPENAI_API_KEY)     envLines.push(`OPENAI_API_KEY=${openaiKey}`);
    if (geminiApiKey  && !process.env.GOOGLE_AI_API_KEY)  envLines.push(`GOOGLE_AI_API_KEY=${geminiApiKey}`);
    if (envLines.length > 0) {
      const { appendFileSync } = await import("fs");
      appendFileSync(envPath, "\n# Forge AI Provider Keys\n" + envLines.join("\n") + "\n");
    }

    // 7. CLAUDE.md — Receptionist logic for Claude Code
    const claudeMdSrc = join(__dirname, "..", "..", "..", "..", "..", "CLAUDE.md");
    const claudeMdDest = join(absProjectPath, "CLAUDE.md");
    if (existsSync(claudeMdSrc)) {
      await copyFile(claudeMdSrc, claudeMdDest);
    }

    // 8. README.md
    const readmePath = join(absProjectPath, "README.md");
    if (!existsSync(readmePath)) {
      await writeFile(readmePath, renderReadme({ projectName, description, stack, date }));
    }

    // 9. .gitignore
    const gitignorePath = join(absProjectPath, ".gitignore");
    const gitignoreEntry = "\n# Forge secrets\n.forge/config.json\n";
    if (existsSync(gitignorePath)) {
      const { appendFileSync } = await import("fs");
      appendFileSync(gitignorePath, gitignoreEntry);
    } else {
      await writeFile(gitignorePath, gitignoreEntry.trim() + "\n");
    }

    // 10. Notify running server
    try {
      const config = loadConfig();
      const res = await fetch(`http://localhost:${config.port}/v1/init`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ forceUpdate: true }),
      });
      if (res.ok) p.log.success("Server synchronized.");
    } catch { /* server not running, that's fine */ }

    // 11. Register forge-mcp in ~/.claude.json (if Claude Code detected)
    if (hasClaude) {
      try {
        const { readFileSync, writeFileSync, existsSync } = await import("fs");
        const claudeJsonPath = join(os.homedir(), ".claude.json");
        const forgeMcpEntry = {
          command: "node",
          args: [join(__dirname, "..", "..", "..", "bin", "forge-mcp.js")],
        };
        let claudeJson: Record<string, any> = {};
        if (existsSync(claudeJsonPath)) {
          try { claudeJson = JSON.parse(readFileSync(claudeJsonPath, "utf-8")); } catch { /* malformed, start fresh */ }
        }
        claudeJson.mcpServers = { ...(claudeJson.mcpServers ?? {}), forge: forgeMcpEntry };
        writeFileSync(claudeJsonPath, JSON.stringify(claudeJson, null, 2));
        p.log.success("forge-mcp registered in ~/.claude.json");
      } catch (e) {
        p.log.warn(`Could not update ~/.claude.json: ${e instanceof Error ? e.message : e}`);
      }
    }

    s.stop("Forge initialized.");

    p.log.success(`Company "${companyName}" configured`);
    p.log.success(`Project scaffolded at .forge/`);
    if (useDefaultAgents) {
      p.log.success(`9 agents ready — ${providerStrategy.heavy.provider}/${providerStrategy.heavy.model} + ${providerStrategy.light.provider}/${providerStrategy.light.model}`);
    } else {
      p.log.success(`${customAgents?.length ?? 0} custom agent(s) configured`);
    }
    if (enableBudget) p.log.success(`Budget: $${monthlyBudget}/month`);
    if (enableTelegram) p.log.success(`Telegram notifications enabled (chat ${telegramChatId})`);

    outro(`Run \x1b[1mforge start\x1b[0m to launch  ·  \x1b[1mforge doctor\x1b[0m to verify setup`);
  } catch (err) {
    s.stop("Setup failed.");
    log.error({ err }, "Init failed");
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Helper used by quickstart path to apply env key + prefetched models */
async function wrapPrefetch(
  promise: Promise<string[] | null>,
  provider: Provider,
  key: string,
  available: Provider[],
  fetched: Map<Provider, string[]>
): Promise<void> {
  if (!key) return;
  available.push(provider);
  const models = await promise;
  if (models && models.length > 0) fetched.set(provider, models);
}

function bestModel(
  provider: Provider,
  tier: "heavy" | "light",
  fetched: Map<Provider, string[]>
): string {
  const models = fetched.get(provider);
  if (models && models.length > 0) {
    // For light tier on API providers, prefer smaller/cheaper models (last in sorted list works for OpenAI,
    // but for Anthropic/OpenRouter we want haiku/cheap. Heuristic: if >1 model, use last for light, first for heavy.
    if (tier === "light" && models.length > 1) return models[models.length - 1];
    return models[0];
  }
  // Fallback to PROVIDER_PRESETS constant
  const presetKey = `${provider}-only` as string;
  const preset = PROVIDER_PRESETS[presetKey];
  if (preset) return preset[tier].model;
  return "default";
}

function buildAutoStrategy(
  available: Provider[],
  fetchedModels: Map<Provider, string[]>
): ProviderStrategy {
  const has = (p: Provider) => available.includes(p);
  const bm = (p: Provider, t: "heavy" | "light") => bestModel(p, t, fetchedModels);

  if (has("claude-cli") && has("openrouter"))
    return { heavy: { provider: "claude-cli", model: bm("claude-cli", "heavy") }, light: { provider: "openrouter", model: bm("openrouter", "light") } };
  if (has("claude-cli") && has("gemini-cli"))
    return { heavy: { provider: "claude-cli", model: bm("claude-cli", "heavy") }, light: { provider: "gemini-cli", model: bm("gemini-cli", "light") } };
  if (has("claude-cli") && has("ollama"))
    return { heavy: { provider: "claude-cli", model: bm("claude-cli", "heavy") }, light: { provider: "ollama", model: bm("ollama", "light") } };
  if (has("claude-cli"))
    return { heavy: { provider: "claude-cli", model: bm("claude-cli", "heavy") }, light: { provider: "claude-cli", model: bm("claude-cli", "light") } };
  if (has("anthropic-api") && has("openrouter"))
    return { heavy: { provider: "anthropic-api", model: bm("anthropic-api", "heavy") }, light: { provider: "openrouter", model: bm("openrouter", "light") } };
  if (has("anthropic-api"))
    return { heavy: { provider: "anthropic-api", model: bm("anthropic-api", "heavy") }, light: { provider: "anthropic-api", model: bm("anthropic-api", "light") } };
  if (has("openai") && has("openrouter"))
    return { heavy: { provider: "openai", model: bm("openai", "heavy") }, light: { provider: "openrouter", model: bm("openrouter", "light") } };
  if (has("openai"))
    return { heavy: { provider: "openai", model: bm("openai", "heavy") }, light: { provider: "openai", model: bm("openai", "light") } };
  if (has("gemini-api") && has("openrouter"))
    return { heavy: { provider: "gemini-api", model: bm("gemini-api", "heavy") }, light: { provider: "openrouter", model: bm("openrouter", "light") } };
  if (has("gemini-api"))
    return { heavy: { provider: "gemini-api", model: bm("gemini-api", "heavy") }, light: { provider: "gemini-api", model: bm("gemini-api", "light") } };
  if (has("gemini-cli"))
    return { heavy: { provider: "gemini-cli", model: bm("gemini-cli", "heavy") }, light: { provider: "gemini-cli", model: bm("gemini-cli", "light") } };
  if (has("codex-cli"))
    return { heavy: { provider: "codex-cli", model: bm("codex-cli", "heavy") }, light: { provider: "codex-cli", model: bm("codex-cli", "light") } };
  if (has("ollama"))
    return { heavy: { provider: "ollama", model: bm("ollama", "heavy") }, light: { provider: "ollama", model: bm("ollama", "light") } };
  if (has("openrouter"))
    return { heavy: { provider: "openrouter", model: bm("openrouter", "heavy") }, light: { provider: "openrouter", model: bm("openrouter", "light") } };
  // Ultimate fallback
  return { ...PROVIDER_PRESETS["claude-cli-only"] };
}

const PROVIDER_LABELS: Record<Provider, string> = {
  "claude-cli":    "Claude Code CLI",
  "gemini-cli":    "Gemini CLI",
  "gemini-api":    "Gemini API",
  "codex-cli":     "Codex CLI",
  "opencode-cli":  "OpenCode CLI",
  "openrouter":    "OpenRouter",
  "anthropic-api": "Anthropic API",
  "openai":        "OpenAI",
  "ollama":        "Ollama (local)",
};

function buildModelOptions(
  available: Provider[],
  tier: "heavy" | "light",
  fetchedModels: Map<Provider, string[]>
): Array<{ value: string; label: string }> {
  const opts: Array<{ value: string; label: string }> = [];

  // CLI providers — dynamic if detected, fallback to curated list
  if (available.includes("claude-cli")) {
    // Use Anthropic API model list if available, else config-detected model, else hardcoded aliases
    const anthropicModels = fetchedModels.get("anthropic-api");
    const configModel     = fetchedModels.get("claude-cli")?.[0];
    if (anthropicModels && anthropicModels.length > 0) {
      for (const m of anthropicModels) {
        opts.push({ value: `claude-cli|${m}`, label: `Claude Code CLI — ${m}` });
      }
    } else if (configModel) {
      opts.push({ value: `claude-cli|${configModel}`, label: `Claude Code CLI — ${configModel} (from config)` });
      opts.push({ value: "claude-cli|sonnet", label: "Claude Code CLI — sonnet" });
      opts.push({ value: "claude-cli|opus",   label: "Claude Code CLI — opus" });
      opts.push({ value: "claude-cli|haiku",  label: "Claude Code CLI — haiku" });
    } else {
      opts.push({ value: "claude-cli|sonnet", label: "Claude Code CLI — sonnet" });
      opts.push({ value: "claude-cli|opus",   label: "Claude Code CLI — opus" });
      opts.push({ value: "claude-cli|haiku",  label: "Claude Code CLI — haiku" });
    }
  }
  if (available.includes("gemini-cli")) {
    opts.push({ value: "gemini-cli|gemini-2.5-pro",  label: "Gemini CLI — 2.5 Pro" });
    opts.push({ value: "gemini-cli|gemini-2.0-flash", label: "Gemini CLI — 2.0 Flash" });
  }
  if (available.includes("codex-cli")) {
    // models_cache.json → full list; else fallback
    const dynamic = fetchedModels.get("codex-cli");
    if (dynamic && dynamic.length > 0) {
      for (const m of dynamic) {
        opts.push({ value: `codex-cli|${m}`, label: `Codex CLI — ${m}` });
      }
    } else {
      opts.push({ value: "codex-cli|o4-mini",           label: "Codex CLI — o4-mini (fallback)" });
      opts.push({ value: "codex-cli|o3",                label: "Codex CLI — o3 (fallback)" });
      opts.push({ value: "codex-cli|codex-mini-latest", label: "Codex CLI — codex-mini-latest (fallback)" });
    }
  }
  if (available.includes("opencode-cli")) {
    opts.push({ value: "opencode-cli|default", label: "OpenCode CLI — default model" });
  }

  // API providers — dynamic first, labeled fallback if not available
  for (const provider of ["openrouter", "anthropic-api", "openai", "gemini-api"] as Provider[]) {
    if (!available.includes(provider)) continue;
    const label = PROVIDER_LABELS[provider];
    const dynamic = fetchedModels.get(provider);
    if (dynamic && dynamic.length > 0) {
      for (const modelId of dynamic) {
        opts.push({ value: `${provider}|${modelId}`, label: `${label} — ${modelId}` });
      }
    } else {
      const fallback = FALLBACK_MODELS[provider] ?? [];
      for (const modelId of fallback) {
        opts.push({ value: `${provider}|${modelId}`, label: `${label} — ${modelId} (fallback)` });
      }
    }
  }

  // Ollama — dynamic if models known, otherwise special "__type__" token
  if (available.includes("ollama")) {
    const ollamaModels = fetchedModels.get("ollama") ?? [];
    if (ollamaModels.length > 0) {
      for (const m of ollamaModels) {
        opts.push({ value: `ollama|${m}`, label: `Ollama (local) — ${m}` });
      }
    } else {
      opts.push({ value: "ollama|__type__", label: "Ollama (local) — enter model name manually" });
    }
  }

  return opts;
}

function renderProjectMd(d: { projectName: string; description: string; stack: string; date: string }): string {
  return `# Project Context

## Project
${d.projectName}

## Description
${d.description || "[Add a description]"}

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

function renderReadme(d: { projectName: string; description: string; stack: string; date: string }): string {
  return `# ${d.projectName}

${d.description || ""}

## Stack
${d.stack}

---

## Managed by Forge

This project is managed by **Forge** — an AI agent orchestration platform.

\`\`\`bash
forge start          # Launch the agent team
forge issue create   # Create a new task
forge status         # Check system status
forge doctor         # Verify setup
\`\`\`

---
_Scaffolded by Forge v3 — ${d.date}_
`;
}
