# Changelog

## v0.1.15

- **`mneme init` now scaffolds full opencode integration** — running `mneme init` in any project now generates all files needed for the oh-my-opencode multi-agent system:
  - `opencode.json` — OpenCode config with plugin declaration and default model (claude-opus-4.6)
  - `.opencode/plugins/mneme.ts` — mneme plugin exposing 12 tools + compaction hook
  - `.opencode/oh-my-opencode.jsonc` — agent/model routing for GitHub Copilot plan
  - `.opencode/package.json` — plugin dependencies (@opencode-ai/plugin, oh-my-opencode)
  - `.opencode/.gitignore` — ignores node_modules and lock files
  - Automatically runs `npm install` (or `bun install`) in `.opencode/` to install plugin dependencies
  - Uses `--registry=https://registry.npmjs.org` for npm to avoid issues with local mirrors
- **Updated all templates** — `opencode-prompt.md` (en/cn) now uses tool-based instructions (`mneme_facts`, `mneme_ready`, etc.) instead of CLI commands
- **Updated documentation for new architecture**:
  - README.md — new project structure, agent orchestration section, updated CLI reference
  - ARCHITECTURE.md — added oh-my-opencode multi-agent details, mneme plugin, compaction hook, updated file layout and technical dependencies
  - `.ledger/facts/architecture.md` — added agent orchestration layer, updated directory structure
  - `examples/basic/` — added opencode.json, oh-my-opencode.jsonc, package.json, plugin placeholder; updated prompt.md and README.md

## v0.1.14

- **Architecture: oh-my-opencode + mneme plugin** — replaced the custom daemon+TUI agent orchestration with oh-my-opencode's built-in multi-agent system
  - Installed `oh-my-opencode` (v3.9.0) as opencode plugin for agent orchestration (Sisyphus, Hephaestus, Prometheus, Atlas, etc.)
  - Created **mneme plugin** (`.opencode/plugins/mneme.ts`) exposing 11 custom tools:
    - Beads: `mneme_ready`, `mneme_list`, `mneme_show`, `mneme_create`, `mneme_update`, `mneme_close`, `mneme_blocked`, `mneme_dep`
    - Ledger: `mneme_facts`, `mneme_propose_fact`
    - Status: `mneme_status`, `mneme_doctor`
  - Added **compaction hook** — injects mneme task state and facts overview into session compaction context
  - Created `opencode.json` with oh-my-opencode plugin reference
  - Created `.opencode/oh-my-opencode.jsonc` with model routing for GitHub Copilot plan (claude-opus-4.6, gpt-4.1, claude-sonnet-4.6, gemini-2.5-pro)
- **Simplified `mneme auto`** — reduced from ~2050 lines to ~155 lines
  - TUI mode: launches `opencode` directly (oh-my-opencode handles agent orchestration)
  - Headless mode (`--headless`): runs `opencode run <goal>`
  - Ensures Dolt is running before launch
  - Removed daemon process, SSE monitoring, planner/executor dual-agent loop, goal discussion flows (all replaced by oh-my-opencode's Ralph Loop, todo enforcer, etc.)
- **Updated `.opencode/prompt.md`** — rewrote to reference mneme tools instead of CLI commands, streamlined session startup instructions

## v0.1.13

- **Fix: process hangs after completion** — SSE event streams were not properly closed when the supervisor loop finished, preventing Node.js from exiting
  - Added `AbortController` support to SSE `subscribeEvents()` in opencode-client
  - Both `createEventDisplay` (headless) and `createDaemonEventMonitor` (daemon) now abort their SSE fetch on `stop()`
  - `AbortError` is silently ignored (not treated as a reconnect-worthy error)
  - Headless mode explicitly calls `process.exit(0)` after cleanup as a safety net

## v0.1.12

- **Goal discussion feature** — when `mneme auto` is run without a goal:
  - **Headless mode**: asks user to choose "pick from beads" or "discuss with Planner"; if no beads exist only the discuss option is shown
  - **Daemon+TUI mode**: always enters goal discussion — Planner presents current beads and suggestions, user discusses in TUI, types `/go` to start execution
  - `buildPlannerDiscoveryPrompt()`: gathers beads state and asks Planner to suggest goals
  - `buildPlannerFinalizeGoalPrompt()`: sent after `/go`, Planner summarizes the agreed goal and produces first executor instruction
  - `goalDiscussionHeadless()` / `goalDiscussionDaemon()`: full interactive discussion loops for both modes
- **Daemon+TUI architecture** (`mneme auto` default mode):
  - `mneme auto` now forks a background daemon (prompt driver) and opens the opencode TUI in foreground
  - Daemon connects via `--_daemon` internal flag, monitors SSE silently, logs to `.mneme-auto.log`
  - Daemon detects user messages in TUI and pauses auto loop while user interacts
  - Daemon exits when parent (TUI) exits (polls ppid + SIGHUP)
- **Fix: `onUserMessage` getter** in `createDaemonEventMonitor` — `goalDiscussionDaemon` can now correctly save/restore the previous handler
- Updated help text with `/go` command and goal discussion behavior

## v0.1.11

- **Fix: SSE event parsing** — opencode serve sends `{type, properties}` inside the `data:` JSON, not as separate SSE `event:` lines; parser now correctly extracts event type from JSON payload
- **Fix: streaming text display** — handle `message.part.delta` events for real-time text output (was only handling `message.part.updated` which fires once at the end)
- **Fix: turn completion detection** — listen for `session.status` events (busy→idle) instead of relying solely on `session.updated` which doesn't carry status
- Added `message.updated` finish detection as backup for turn completion

## v0.1.10

- **Fix: model validation uses real API probe** — `opencode models` lists theoretical models but the provider (e.g. GitHub Copilot) may reject them at runtime; now sends a real test prompt at startup and fails immediately if the model is unsupported
- **Fix: detect model errors during turns** — after `promptAsync`, polls session status after 2s to catch instant model rejections instead of waiting for the 120s silence timeout
- Default planner changed from `gpt-5.2` to `gpt-4.1` (gpt-5.x unavailable on current Copilot plan)
- `mneme auto` reliability improvements:
  - Heartbeat: prints elapsed time every 15s when no SSE output is flowing
  - No-output timeout: warns at 30s of silence, auto-aborts the turn at 120s (replaces the old 600s safety timeout)
  - SSE connection tracking: exposes `lastOutputTime`, `connected`, `hasReceivedAny` from event display for stall detection
  - SSE auto-reconnect on stream error with 2s backoff
  - Prints "Sending prompt to Planner/Executor..." before each turn
- `mneme restart [TARGET]` promoted to top-level alias (was `mneme server restart`)

## v0.1.8

- Dual-agent `mneme auto`: planner (gpt-5.2) breaks down tasks and reviews, executor (claude-opus-4.6) implements — both alternate in the same session via per-message model switching
  - `--planner MODEL` and `--executor MODEL` flags to override defaults
  - Planner signals `TASK_DONE` when a task is complete, then auto picks the next bead
- `mneme server` now manages both dolt AND opencode serve (was dolt-only)
  - `mneme server start/stop/status/restart [dolt|opencode|all]`
  - New `MNEME_OPENCODE_PORT` env var (default: 4097)
- Short aliases: `mneme up`, `mneme down`, `mneme ps` for server start/stop/status
- New shared `src/opencode-server.mjs` — opencode serve process management (find, start, stop, health check)
- Clean up auto.mjs: remove `_pushBack` hack, fix safety timeout dead code, proper `pushBack()` on input queue

## v0.1.7

- Fix user-facing references: `bd ready` → `mneme ready` in init output, `bd update` → `mneme update` in compact hint

## v0.1.6

- Add `mneme server` command with `start`, `stop`, `status`, `restart` subcommands for managing the dolt SQL server
- Extract shared dolt utilities into `src/dolt.mjs` (port check, process detection, start/stop) — eliminates duplication between `init` and `server`
- `mneme server status` shows port, PID, and data-dir with mismatch warnings

## v0.1.5

- Fix dolt server detection in `mneme init`: replace `bd list` probe with TCP port check (`/dev/tcp`), preventing false-negative when initializing a new project where `bd list` always fails
- Correctly identify running dolt processes by inspecting `ps aux` for data-dir match; kill and restart if data-dir mismatches, error with guidance if port is occupied by non-dolt process
- Use PID extraction from `ps aux` instead of `lsof` (which may not be installed) for portable process management

## v0.1.4

- Move English templates to `en/` subdirectory for consistent locale structure (`src/templates/en/`, `src/templates/cn/`)

## v0.1.3

- Rename Layer 1 from "OpenClaw" to "Ledger" (`.openclaw/` -> `.ledger/`) across all code, templates, and documentation
- Add Chinese locale support: `mneme init cn` scaffolds Chinese templates for AGENTS.md, prompt, and facts files
- Add tagline to README

## v0.1.2

- Fix multi-workspace Dolt isolation: use shared `$HOME/.dolt/databases` as data-dir with per-project database names (`beads_<project>`), preventing cross-project data leakage when multiple projects run on the same port
- Support `MNEME_DOLT_DATA_DIR` and `MNEME_DOLT_PORT` environment variable overrides
- `mneme doctor` now displays which database the current project uses

## v0.1.1

- Translate all template files (`mneme init` scaffolding) from Chinese to English
- Translate session startup prompt (`.opencode/prompt.md` template) to English
- Add `examples/basic/` with a realistic todo-api scenario
- Add `CHANGELOG.md`

## v0.1.0 — Initial Release

First public release of mneme, a three-layer memory architecture for AI coding agents.

### What's included

**Three-layer memory architecture**
- **Ledger** (long-term facts): `.ledger/facts/` stores verified architecture decisions, constraints, performance rules, and pitfalls. Facts persist across the entire project lifetime and require human approval to modify.
- **Beads** (task state): Dependency-aware task tracking backed by [Dolt](https://www.dolthub.com/) and [bd](https://github.com/steveyegge/beads). Tasks survive across agent sessions with full status, notes, and dependency graphs.
- **OpenCode** (execution): Wraps [OpenCode](https://opencode.ai) as the agent runtime. Context is ephemeral — disposable by design.

**Unified CLI**
- `mneme init` — one-command setup: installs dependencies (Dolt, bd), scaffolds project structure, starts the task database.
- `mneme` — launches the agent TUI with memory-aware startup prompt.
- `mneme auto [goal]` — autonomous supervisor loop that picks tasks and drives the agent continuously.
- `mneme doctor` — health check for all dependencies and project state.
- `mneme status` — three-layer memory dashboard.

**Fact management with human-in-the-loop**
- `mneme propose` — agents propose new facts with justification.
- `mneme review` — humans approve or reject proposals before they become permanent.
- `mneme facts` — view current facts with optional stats.

**Task management (promoted from bd)**
- `mneme ready`, `list`, `show`, `create`, `update`, `close`, `blocked`, `dep add` — all bd commands available as top-level mneme commands.

**Agent rules**
- `AGENTS.md` template with context priority chain, allowed/prohibited actions, session lifecycle, and information routing decision tree.
- `.opencode/prompt.md` template with mandatory startup sequence.

**Zero npm dependencies** — uses only Node.js built-ins.

### Install

```bash
npm install -g @xqli02/mneme
```

### Quick start

```bash
cd your-project
mneme init
mneme
```
