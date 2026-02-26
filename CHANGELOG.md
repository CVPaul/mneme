# Changelog

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
