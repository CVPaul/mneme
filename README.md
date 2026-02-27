# mneme

**Three-layer memory architecture for AI coding agents.**

mneme separates long-lived facts, persistent work state, and disposable execution context, allowing AI coding agents to survive context compaction without relying on vector memory or RAG.

mneme gives coding agents (like [OpenCode](https://opencode.ai)) persistent memory across sessions. It separates long-term facts, task state, and short-term execution into three distinct layers — so agents stop forgetting decisions, losing progress, and repeating work.

## The problem

AI coding agents work in sessions. Each session has a context window that fills up and gets compacted. When that happens:

- **Architectural decisions get forgotten.** The agent re-analyzes problems it already solved.
- **Task progress is lost.** The agent doesn't know what it finished yesterday.
- **Lessons disappear.** The agent hits the same pitfalls again.

Prompt engineering doesn't fix this. The issue is structural: agents have no separation between things that must survive forever, things that must survive across sessions, and things that only matter right now.

## The solution: three layers

```
┌─────────────────────────────────────────┐
│  Ledger   — Facts     (long-term)     │  survives forever
├─────────────────────────────────────────┤
│  Beads      — Tasks     (mid-term)      │  survives across sessions
├─────────────────────────────────────────┤
│  OpenCode   — Execution (short-term)    │  lives within one session
└─────────────────────────────────────────┘
```

| Layer | What it stores | Lifetime | Example |
|-------|---------------|----------|---------|
| **Ledger** | Verified engineering facts — architecture decisions, constraints, pitfalls | Project lifetime | "Database must use PostgreSQL" |
| **Beads** | Task state — what's done, what's blocked, what's next | Cross-session | "Auth module: JWT signing done, verification pending" |
| **OpenCode** | Current execution context — code analysis, file edits | Single session | "This function's third parameter is timeout" |

Each layer has clear ownership. Facts can't be modified without human approval. Tasks are managed through a dependency-aware tracker. Execution context is disposable.

## Quick start

Prerequisites: [Node.js](https://nodejs.org/) >= 18, [Git](https://git-scm.com/), [OpenCode](https://opencode.ai)

```bash
npm install -g @xqli02/mneme

cd your-project
mneme init
mneme
```

`mneme init` sets up everything in one command:
1. Installs [Dolt](https://www.dolthub.com/repositories) and [bd](https://github.com/steveyegge/beads) if missing
2. Initializes a git repo (if needed)
3. Creates the three-layer structure (`.ledger/`, `.beads/`, `AGENTS.md`)
4. Scaffolds OpenCode integration files (`opencode.json`, `.opencode/plugins/mneme.ts`, `.opencode/oh-my-opencode.jsonc`)
5. Installs plugin dependencies (oh-my-opencode, mneme plugin)
6. Starts the task database

That's it. Run `mneme` to launch the agent, or `mneme doctor` to verify your setup.

## How it works

### Agent orchestration

mneme uses [oh-my-opencode](https://github.com/nickarora/oh-my-opencode) as the agent orchestration layer inside OpenCode. This provides a multi-agent system with specialized agents:

- **Sisyphus** — primary coding agent (claude-opus-4.6)
- **Hephaestus** — deep analysis and architecture tasks
- **Prometheus** — fast planning and quick tasks (gpt-4.1)
- **Atlas** — large-scale refactoring

The mneme plugin (`.opencode/plugins/mneme.ts`) exposes 12 tools to these agents, giving them direct access to the Ledger and Beads layers.

### Every session starts the same way

The agent reads facts, checks tasks, picks one to focus on — all through mneme tools:

```
mneme_facts         → Read long-term facts (agent does this automatically)
mneme_ready         → See which tasks have no blockers
mneme_update        → Claim a task (set status to in_progress)
```

### During work

The agent records progress and creates sub-tasks as it goes:

```
mneme_update        → Record progress notes on the current task
mneme_create        → Create a new sub-task
mneme_dep           → Link dependencies between tasks
```

### When done

```
mneme_close         → Close a completed task with a summary
```

### New facts require approval

Agents can propose facts, but only humans can approve them:

```bash
# Agent proposes via mneme_propose_fact tool
# Human reviews on the command line:
mneme review                    # List pending proposals
mneme review <id> --approve     # Write to facts
```

### Autonomous mode

`mneme auto` launches OpenCode with the full multi-agent system and mneme tools:

```bash
mneme auto                      # Launch OpenCode TUI with mneme tools
mneme auto "Build auth module"  # Start with a specific goal (headless)
```

## CLI reference

```
mneme                           Launch OpenCode TUI
mneme init [cn]                 Initialize mneme (cn = Chinese templates)
mneme doctor                    Check dependencies and project health
mneme status                    Three-layer memory dashboard
mneme auto [goal]               Launch OpenCode with mneme tools

mneme facts [name] [--stats]    View long-term facts
mneme propose --file=... ...    Propose a new fact
mneme review [id] [--approve]   Review pending proposals

mneme ready                     Tasks with no blockers
mneme list [--status=STATUS]    List tasks
mneme show <id>                 Task details
mneme create --title="..."      Create a task
mneme update <id> [--notes=..]  Update a task
mneme close <id> [--reason=..]  Close a task
mneme blocked                   Show blocked tasks
mneme dep add <child> <parent>  Add dependency

mneme up/down/ps/restart        Manage servers (dolt + opencode)
mneme run [message]             Run agent non-interactively
mneme compact                   Pre-compaction persistence check
mneme version                   Print version
```

## Project structure

After `mneme init`, your project contains:

```
opencode.json                    OpenCode config (plugin + model)
AGENTS.md                        Agent behavior rules and routing logic
.ledger/
  facts/                         Long-term facts (architecture, constraints, pitfalls)
  proposals/                     Pending fact proposals awaiting human review
.beads/                          Task database (managed by bd, backed by Dolt)
.opencode/
  prompt.md                      Session startup prompt for the agent
  plugins/
    mneme.ts                     mneme plugin — exposes 12 tools to agents
  oh-my-opencode.jsonc           Agent/model routing configuration
  package.json                   Plugin dependencies
```

## What mneme is

- A CLI that unifies agent execution, task tracking, and fact management
- A structure that gives agents persistent memory without custom infrastructure
- A workflow where humans stay in control of long-term decisions

## What mneme is not

- Not a new AI model or agent — it wraps [OpenCode](https://opencode.ai) with [oh-my-opencode](https://github.com/nickarora/oh-my-opencode)
- Not a RAG system — facts are curated, not retrieved from embeddings
- Not a framework — it's a single CLI with zero npm dependencies
- Not opinionated about your code — it only manages agent memory

## Example

See [examples/basic/](examples/basic/) for a complete example of what a mneme-managed project looks like after initialization, with realistic facts filled in for a hypothetical todo-api project.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design document.

## License

MIT
