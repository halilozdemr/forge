/**
 * Pure aggregation and formatting helpers for `forge budget report`.
 *
 * Cost events are grouped by an arbitrary dimension (provider, agent, model),
 * summing USD and token usage. Kept free of I/O so the grouping/sorting/
 * formatting logic can be unit-tested in isolation — see the route-table and
 * pricing modules for the same pattern.
 */

/** Minimal shape of a cost event consumed by the report (matches CostEvent). */
export interface CostEventLike {
  provider?: string | null;
  agentId?: string | null;
  model?: string | null;
  costUsd: number | string;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

/** One aggregated bucket: a dimension value with its summed cost and tokens. */
export interface CostGroup {
  /** The dimension value (e.g. provider name), or the fallback for blanks. */
  key: string;
  usd: number;
  tokens: number;
  count: number;
}

function toNumber(value: number | string | null | undefined): number {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Group cost events by a key extracted from each event, summing USD and tokens.
 * Blank/missing keys collapse into `fallbackKey`. Results are sorted by spend
 * descending, with a stable alphabetical tie-break on the key.
 */
export function groupCostEvents<T extends CostEventLike>(
  events: readonly T[],
  keyOf: (event: T) => string | null | undefined,
  fallbackKey = "unknown",
): CostGroup[] {
  const groups = new Map<string, CostGroup>();

  for (const event of events) {
    const raw = keyOf(event);
    const key = raw && String(raw).trim() ? String(raw).trim() : fallbackKey;
    let group = groups.get(key);
    if (!group) {
      group = { key, usd: 0, tokens: 0, count: 0 };
      groups.set(key, group);
    }
    group.usd += toNumber(event.costUsd);
    group.tokens += toNumber(event.inputTokens) + toNumber(event.outputTokens);
    group.count += 1;
  }

  return [...groups.values()].sort((a, b) => b.usd - a.usd || a.key.localeCompare(b.key));
}

/** Group events by their backend provider. */
export function groupByProvider<T extends CostEventLike>(events: readonly T[]): CostGroup[] {
  return groupCostEvents(events, (e) => e.provider, "unknown");
}

/** Group events by the agent that incurred the cost. */
export function groupByAgent<T extends CostEventLike>(events: readonly T[]): CostGroup[] {
  return groupCostEvents(events, (e) => e.agentId, "unknown");
}

/**
 * Render grouped buckets as aligned report lines (no leading section header).
 * Each line: `  <key>  $<usd>  <tokens> tokens`, key column padded to the
 * widest key so columns line up regardless of content.
 */
export function formatCostGroups(
  groups: readonly CostGroup[],
  options: { indent?: string; minKeyWidth?: number } = {},
): string[] {
  const indent = options.indent ?? "  ";
  const keyWidth = Math.max(options.minKeyWidth ?? 0, ...groups.map((g) => g.key.length), 0);
  return groups.map(
    (g) => `${indent}${g.key.padEnd(keyWidth)}  $${g.usd.toFixed(4)}  ${g.tokens} tokens`,
  );
}
