import React from "react";
import { render } from "ink";
import type { ForgeConsoleShellOptions } from "../types.js";
import { App } from "./App.js";

/**
 * Boot the Ink-based Forge console.
 *
 * Returns a cleanup function with the same contract as the legacy ANSI shell so
 * the runtime bootstrap can swap renderers without other changes. The console
 * runs in the terminal's alternate screen buffer so quitting restores the
 * user's prior scrollback.
 */
export async function startForgeInkConsole(opts: ForgeConsoleShellOptions): Promise<() => void> {
  // Enter alternate screen + hide cursor before Ink takes over the viewport.
  process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[H\x1b[2J");

  const instance = render(<App opts={opts} />, {
    // ctrl+c is handled inside the app so it can trigger a graceful runtime
    // shutdown instead of an abrupt unmount.
    exitOnCtrlC: false,
  });

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    instance.unmount();
    // Restore cursor and leave the alternate screen buffer.
    process.stdout.write("\x1b[?25h\x1b[?1049l");
  };
}
