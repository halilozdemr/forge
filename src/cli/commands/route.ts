import { Command } from "commander";
import { existsSync } from "fs";
import { join, delimiter } from "path";
import { loadConfig } from "../../utils/config.js";
import { resolveCompany } from "../../utils/company.js";
import { listRoutableProviders, defaultModelFor } from "../../bridge/runners/providers.js";
import { PROVIDER_PRESETS, HEAVY_AGENTS } from "../../db/seed.js";
import { intro, select, text } from "../prompts.js";
import {
  type ProviderProbe,
  type RouteRow,
  buildProviderChoices,
  formatRouteTable,
  presetIsApplicable,
  providerAvailability,
  resolvePresetAssignments,
  resolveRouteAssignment,
  sortRouteRows,
} from "../route-table.js";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function baseUrl(): string {
  return `http://localhost:${loadConfig().port}`;
}

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Live env/PATH probe backing the routing table's availability column. */
const liveProbe: ProviderProbe = {
  getEnv: (name) => {
    const value = process.env[name];
    return value && value.trim().length > 0 ? value : undefined;
  },
  hasBinary: (name) => {
    const paths = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
    return paths.some((dir) => existsSync(join(dir, name)));
  },
};

interface AgentRecord {
  slug: string;
  name: string;
  modelProvider: string;
  model: string;
}

async function fetchRouteRows(companyId: string): Promise<RouteRow[]> {
  const { agents } = await api<{ agents: AgentRecord[] }>(`/v1/agents?companyId=${companyId}`);
  return agents.map((a) => ({
    slug: a.slug,
    name: a.name,
    provider: a.modelProvider,
    model: a.model,
  }));
}

function printProviderLegend(): void {
  console.log(`\n${DIM}Routable backends:${RESET}`);
  for (const p of listRoutableProviders()) {
    const avail = providerAvailability(p.id, liveProbe);
    console.log(`  ${p.id.padEnd(14)} ${avail.status.padEnd(9)} ${DIM}${avail.detail}${RESET}`);
  }
}

export function routeCommand(): Command {
  const cmd = new Command("route").description("Inspect and edit per-stage provider routing");

  // Default action: show the routing table.
  cmd
    .command("list", { isDefault: true })
    .description("Show the stage → provider/model routing table")
    .option("--company <id>", "Company ID")
    .action(async (opts) => {
      const companyId = await resolveCompany(opts.company);
      const rows = sortRouteRows(await fetchRouteRows(companyId));
      console.log(`\n${BOLD}Pipeline routing${RESET}`);
      for (const line of formatRouteTable(rows, liveProbe)) {
        console.log(`  ${line}`);
      }
      printProviderLegend();
      console.log(`\n${DIM}Set a stage:  forge route set <stage> --provider <id> [--model <m>]${RESET}`);
      console.log(`${DIM}Apply preset: forge route preset <name>${RESET}\n`);
    });

  // Set the provider/model for a single stage.
  cmd
    .command("set <stage>")
    .description("Route a stage to a specific provider/model")
    .option("--provider <id>", "Provider id (see `forge route providers`)")
    .option("--model <model>", "Model (defaults to the provider's default)")
    .option("--company <id>", "Company ID")
    .action(async (stage, opts) => {
      const companyId = await resolveCompany(opts.company);

      let provider: string = opts.provider;
      let model: string | undefined = opts.model;

      // No provider flag → interactive picker driven by the registry.
      if (!provider) {
        intro(`Route stage "${stage}"`);
        provider = await select({
          message: "Provider:",
          options: buildProviderChoices(liveProbe),
        });
        model = await text({
          message: `Model for ${provider}:`,
          defaultValue: defaultModelFor(provider) ?? "default",
        });
      }

      const assignment = resolveRouteAssignment(provider, model);

      await api(`/v1/agents/${stage}`, "PUT", {
        companyId,
        modelProvider: assignment.provider,
        model: assignment.model,
      });
      console.log(
        `Stage "${BOLD}${stage}${RESET}" routed to ${assignment.provider}/${assignment.model}.`,
      );
    });

  // List or apply heavy/light presets.
  cmd
    .command("preset [name]")
    .description("List heavy/light presets, or apply one across all stages")
    .option("--company <id>", "Company ID")
    .option("--dry-run", "Preview assignments without writing them")
    .action(async (name, opts) => {
      if (!name) {
        console.log(`\n${BOLD}Available presets${RESET}`);
        for (const [key, strat] of Object.entries(PROVIDER_PRESETS)) {
          const note = presetIsApplicable(strat) ? "" : `  ${DIM}(unavailable: no runner)${RESET}`;
          console.log(
            `  ${key.padEnd(26)} ${DIM}heavy=${strat.heavy.provider}/${strat.heavy.model}  light=${strat.light.provider}/${strat.light.model}${RESET}${note}`,
          );
        }
        console.log(`\n${DIM}Apply: forge route preset <name>${RESET}\n`);
        return;
      }

      const strategy = PROVIDER_PRESETS[name];
      if (!strategy) {
        throw new Error(`Unknown preset "${name}". Run \`forge route preset\` to list presets.`);
      }

      const companyId = await resolveCompany(opts.company);
      const rows = sortRouteRows(await fetchRouteRows(companyId));
      const assignments = resolvePresetAssignments(strategy, rows, HEAVY_AGENTS);

      console.log(`\n${BOLD}Preset "${name}"${RESET}${opts.dryRun ? " (dry run)" : ""}`);
      for (const a of assignments) {
        console.log(`  ${a.slug.padEnd(22)} → ${a.provider}/${a.model} ${DIM}(${a.tier})${RESET}`);
      }

      if (opts.dryRun) {
        console.log(`\n${DIM}No changes written.${RESET}\n`);
        return;
      }

      for (const a of assignments) {
        await api(`/v1/agents/${a.slug}`, "PUT", {
          companyId,
          modelProvider: a.provider,
          model: a.model,
        });
      }
      console.log(`\nApplied preset "${name}" to ${assignments.length} stages.\n`);
    });

  // Show routable providers and their backend availability.
  cmd
    .command("providers")
    .description("List routable providers and backend availability")
    .action(async () => {
      console.log(`\n${BOLD}Routable providers${RESET}`);
      for (const p of listRoutableProviders()) {
        const avail = providerAvailability(p.id, liveProbe);
        console.log(
          `  ${p.id.padEnd(14)} ${p.kind.padEnd(6)} ${avail.status.padEnd(9)} ${DIM}default=${p.defaultModel}  ${avail.detail}${RESET}`,
        );
      }
      console.log();
    });

  return cmd;
}
