import * as p from "@clack/prompts";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger("prompts");

export function intro(title: string): void {
  p.intro(`\x1b[1m${title}\x1b[0m`);
}

export function outro(message: string): void {
  p.outro(message);
}

export async function text(opts: {
  message: string;
  placeholder?: string;
  defaultValue?: string;
  validate?: (value: string) => string | undefined;
}): Promise<string> {
  const result = await p.text(opts);
  if (p.isCancel(result)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  return result as string;
}

export async function confirm(opts: {
  message: string;
  initialValue?: boolean;
}): Promise<boolean> {
  const result = await p.confirm(opts);
  if (p.isCancel(result)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  return result as boolean;
}

export async function select<T extends string>(opts: {
  message: string;
  options: Array<{ value: T; label: string; hint?: string }>;
}): Promise<T> {
  const result = await p.select(opts);
  if (p.isCancel(result)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  return result as T;
}

export { p };
