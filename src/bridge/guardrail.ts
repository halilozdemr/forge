import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("guardrail");

export type GuardrailSeverity = "deny" | "warn" | "off";

export interface GuardrailRule {
  id: string;
  description: string;
  severity: GuardrailSeverity;
  pattern: RegExp;
  providers?: string[];
}

export interface GuardrailViolation {
  ruleId: string;
  description: string;
  severity: Exclude<GuardrailSeverity, "off">;
  match: string;
}

export interface GuardrailResult {
  blocked: boolean;
  violations: GuardrailViolation[];
}

type GuardrailConfig = {
  rules: Record<string, { severity: GuardrailSeverity }>;
};

// undefined = not yet loaded; null = loaded but no file found
let _configCache: GuardrailConfig | null | undefined = undefined;

// Loaded once per process lifetime. Config changes require a server restart,
// which is consistent with how all other .forge/*.json configs behave.
function loadConfig(): GuardrailConfig | null {
  if (_configCache !== undefined) return _configCache;
  try {
    const configPath = join(process.cwd(), ".forge", "guardrail.json");
    if (!existsSync(configPath)) {
      _configCache = null;
      return null;
    }
    _configCache = JSON.parse(readFileSync(configPath, "utf-8")) as GuardrailConfig;
    return _configCache;
  } catch {
    _configCache = null;
    return null;
  }
}

/** Exported for tests — resets the module-level cache. */
export function _resetConfigCache(): void {
  _configCache = undefined;
}

function applySeverityOverrides(rules: GuardrailRule[], config: GuardrailConfig | null): GuardrailRule[] {
  if (!config?.rules) return rules;
  return rules.map((rule) => {
    const override = config.rules[rule.id];
    if (!override) return rule;
    return { ...rule, severity: override.severity };
  });
}

// Pre-run rules: checked against agent input before execution
const PRE_RUN_RULES_BASE: GuardrailRule[] = [
  {
    id: "R01",
    description: "Force push without lease",
    severity: "deny",
    pattern: /git\s+push\s+[^|&;\n]*--force(?!-with-lease)/i,
  },
  {
    id: "R02",
    description: "Skip pre-commit hooks (--no-verify)",
    severity: "deny",
    pattern: /--no-verify/i,
  },
  {
    id: "R03",
    description: "Hard reset to remote branch",
    severity: "deny",
    pattern: /git\s+reset\s+--hard\s+origin/i,
  },
  {
    id: "R04",
    description: "Direct push to protected branch (main/master)",
    severity: "deny",
    pattern: /git\s+push\s+[^|&;\n]*\s+(?:HEAD:)?(?:main|master)\b/i,
  },
  {
    id: "R05",
    description: "Potential hardcoded API key or secret",
    severity: "warn",
    pattern: /(?:api[_-]?key|secret[_-]?key|api[_-]?secret|access[_-]?token)\s*[:=]\s*['"]?[a-zA-Z0-9_\-]{16,}/i,
  },
  {
    id: "R06",
    description: "Credential file read via cat",
    severity: "deny",
    pattern: /\bcat\s+[^\n]*(?:\.env|credentials|\.pem|id_rsa|\.key)\b/i,
  },
  {
    id: "R07",
    description: "Delete git branch",
    severity: "warn",
    pattern: /git\s+branch\s+-[Dd]\s+/i,
  },
  {
    id: "R08",
    description: "Sudo usage",
    severity: "deny",
    pattern: /\bsudo\s+/i,
  },
  {
    id: "R09",
    description: "Destructive rm -rf",
    severity: "deny",
    pattern: /\brm\s+-[rf]{1,2}\s+(?!\.|node_modules|dist|build|tmp|temp|coverage)/i,
  },
  {
    id: "R10",
    description: "Force push with lease (informational)",
    severity: "warn",
    pattern: /git\s+push\s+[^|&;\n]*--force-with-lease/i,
  },
];

// Post-run rules: checked against agent output after execution
const POST_RUN_RULES_BASE: GuardrailRule[] = [
  {
    id: "R11",
    description: "Output may contain hardcoded secret",
    severity: "warn",
    pattern: /(?:api[_-]?key|secret[_-]?key|api[_-]?secret|access[_-]?token)\s*[:=]\s*['"]?[a-zA-Z0-9_\-]{20,}/i,
  },
  {
    id: "R12",
    description: "Private key material in output",
    severity: "deny",
    pattern: /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE KEY-----/i,
  },
  {
    id: "R13",
    description: "Credential assignment added in diff",
    severity: "warn",
    pattern: /^\+[^\n]*(?:password|api_key|secret)\s*=\s*['"]?[^\s'"]{8,}/im,
  },
];

function runRules(text: string, rules: GuardrailRule[], provider: string): GuardrailResult {
  const config = loadConfig();
  const effectiveRules = applySeverityOverrides(rules, config);
  const violations: GuardrailViolation[] = [];

  for (const rule of effectiveRules) {
    if (rule.severity === "off") continue;
    if (rule.providers && !rule.providers.includes(provider)) continue;
    const match = rule.pattern.exec(text);
    if (match) {
      violations.push({
        ruleId: rule.id,
        description: rule.description,
        severity: rule.severity as Exclude<GuardrailSeverity, "off">,
        match: match[0].slice(0, 100),
      });
    }
  }
  return { blocked: violations.some((v) => v.severity === "deny"), violations };
}

export function runPreGuardrail(input: string, provider: string): GuardrailResult {
  const result = runRules(input, PRE_RUN_RULES_BASE, provider);
  if (result.violations.length > 0) {
    log.warn({ provider, rules: result.violations.map((v) => v.ruleId) }, "Pre-run guardrail violations detected");
  }
  return result;
}

export function runPostGuardrail(output: string, provider: string): GuardrailResult {
  const result = runRules(output, POST_RUN_RULES_BASE, provider);
  if (result.violations.length > 0) {
    log.warn({ provider, rules: result.violations.map((v) => v.ruleId) }, "Post-run guardrail violations detected");
  }
  return result;
}

export function formatGuardrailError(phase: "pre" | "post", violations: GuardrailViolation[]): string {
  const denied = violations.filter((v) => v.severity === "deny");
  return `Guardrail blocked ${phase}-run: ${denied.map((v) => `[${v.ruleId}] ${v.description}`).join("; ")}`;
}
