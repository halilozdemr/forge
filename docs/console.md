# Forge Console — TUI reference

The Forge Console is the interactive terminal UI that opens by default when you run `forge start`. It gives you a live view of everything happening in the runtime.

---

## Starting

```bash
forge start           # boots runtime + opens console
forge start --headless  # boots runtime without console (raw logs to stderr)
```

Headless mode activates automatically if stdin/stdout is not a TTY (CI, scripts, pipes).

---

## Layout

```
 FORGE CONSOLE  OVERVIEW                          localhost:3131  14:03:22
────────────────────────────────────────────────────────────────────────────

  [content area — changes based on active view]

────────────────────────────────────────────────────────────────────────────
 [o] overview  [w] workflows  [a] approvals  [l] logs  [n] new  [r] refresh  [q] quit
```

The header shows the current view name, server port, and time.
The footer shows context-sensitive keybindings.

---

## Views

### Overview (`o`)

System health at a glance:
- Queue: running / pending / failed job counts
- Agents: total / running / idle / paused
- Heartbeat: scheduled count and next run
- WebSocket connection status (live / connecting)

### Workflows (`w`)

List of all workflow runs. Columns: type, status, current step, progress, last updated.

- `↑↓` navigate
- `Enter` open workflow detail
- `g` jump to the most recently active workflow

**Workflow detail:**
- Full step timeline with durations, agent, status, and result summaries
- `↑↓` scroll
- `r` refresh
- `Esc` back to list

### Approvals (`a`)

List of pending and recent approval requests.

- `↑↓` navigate
- `Enter` open approval detail

**Approval detail:**
- Context lines: workflow, issue, step, agent, reason
- Available actions depend on approval type
- `a` approve
- `r` reject
- `Esc` back to list

### Logs (`l`)

Live streaming output from all agents, buffered in memory (last 300 lines).

Each line has: timestamp, category (`QUEUE`, `AGENT`, `ISSUE`, `HEARTBT`, `BUDGET`), level (info / warn / error), and message text.

- `h` toggle heartbeat noise filter (hides idle/polling lines)
- `e` toggle warn/error only mode
- `p` pause / resume the live stream
- `c` clear the log buffer

### New task (`n`)

Form to create a feature or bug task without leaving the console.

Fields: work type (feature / bug), title, execution mode (fast / structured).

- `← →` or `Space` to select type / mode
- `Tab` to move between fields
- `Enter` to advance or submit
- `Ctrl+Enter` to submit from the title field
- `Esc` to cancel

---

## Global keys

| Key | Action |
|---|---|
| `o` | Go to Overview |
| `w` | Go to Workflows |
| `a` | Go to Approvals |
| `l` | Go to Logs |
| `n` | Open new task form |
| `r` | Refresh current view |
| `q` | Quit console (runtime keeps running) |
| `Ctrl+C` | Shut down runtime and exit |

---

## Where this lives in the codebase

- Main event loop: `src/cli/console/shell.ts`
- Layout engine (ANSI-aware): `src/cli/console/layout.ts`
- Keybinding definitions: `src/cli/console/keymap.ts`
- Views: `src/cli/console/views/` — one file per screen
- Types: `src/cli/console/types.ts`
