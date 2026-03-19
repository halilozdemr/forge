import type { Agent } from "@prisma/client";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("hierarchy");

export interface HierarchyNode {
  agent: Agent;
  children: HierarchyNode[];
}

/** Build agent hierarchy tree from flat list */
export function buildHierarchy(agents: Agent[]): HierarchyNode[] {
  const agentMap = new Map<string, Agent>();
  for (const agent of agents) {
    agentMap.set(agent.slug, agent);
  }

  const roots: HierarchyNode[] = [];
  const nodeMap = new Map<string, HierarchyNode>();

  // Create nodes
  for (const agent of agents) {
    nodeMap.set(agent.slug, { agent, children: [] });
  }

  // Build tree
  for (const agent of agents) {
    const node = nodeMap.get(agent.slug)!;
    if (agent.reportsTo && nodeMap.has(agent.reportsTo)) {
      nodeMap.get(agent.reportsTo)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/** Get the escalation chain for an agent (self → parent → grandparent → ...) */
export function getEscalationChain(agents: Agent[], slug: string): Agent[] {
  const agentMap = new Map<string, Agent>();
  for (const a of agents) agentMap.set(a.slug, a);

  const chain: Agent[] = [];
  let current = agentMap.get(slug);
  const visited = new Set<string>();

  while (current && !visited.has(current.slug)) {
    chain.push(current);
    visited.add(current.slug);
    current = current.reportsTo ? agentMap.get(current.reportsTo) : undefined;
  }

  return chain;
}

/** Get direct reports for an agent */
export function getDirectReports(agents: Agent[], slug: string): Agent[] {
  return agents.filter((a) => a.reportsTo === slug);
}

/** Print hierarchy as indented tree string */
export function formatHierarchy(roots: HierarchyNode[], indent = 0): string {
  const lines: string[] = [];
  for (const node of roots) {
    const prefix = indent === 0 ? "" : `${"  ".repeat(indent)}└── `;
    const status = node.agent.status === "idle" ? "" : ` (${node.agent.status})`;
    lines.push(`${prefix}${node.agent.slug} — ${node.agent.role}${status}`);
    lines.push(...formatHierarchy(node.children, indent + 1).split("\n").filter(Boolean));
  }
  return lines.join("\n");
}
