# mneme

**Three-layer memory architecture for AI coding agents.**

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
│  OpenClaw   — Facts     (long-term)     │  survives forever
├─────────────────────────────────────────┤
│  Beads      — Tasks     (mid-term)      │  survives across sessions
├─────────────────────────────────────────┤
│  OpenCode   — Execution (short-term)    │  lives within one session
└─────────────────────────────────────────┘
```

| Layer | What it stores | Lifetime | Example |
|-------|---------------|----------|---------|
| **OpenClaw** | Verified engineering facts — architecture decisions, constraints, pitfalls | Project lifetime | "Database must use PostgreSQL" |
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
3. Creates the three-layer structure (`.openclaw/`, `.beads/`, `.opencode/`, `AGENTS.md`)
4. Starts the task database

That's it. Run `mneme` to launch the agent, or `mneme doctor` to verify your setup.

## How it works

### Every session starts the same way

The agent reads facts, checks tasks, picks one to focus on:

```bash
mneme facts              # Read long-term facts (agent does this automatically)
mneme ready              # See which tasks have no blockers
mneme update <id> --status=in_progress   # Claim a task
```

### During work

The agent records progress and creates sub-tasks as it goes:

```bash
mneme update <id> --notes="Implemented JWT signing, discovered need for refresh tokens"
mneme create --title="Add refresh token support" --type=task -p 2
```

### When done

```bash
mneme close <id> --reason="JWT auth complete with signing and verification"
```

### New facts require approval

Agents can propose facts, but only humans can approve them:

```bash
mneme propose --file=architecture --content="Auth uses JWT with RS256" --reason="Decided after evaluating HMAC vs RSA"
mneme review                    # Human reviews pending proposals
mneme review <id> --approve     # Write to facts
```

### Autonomous mode

`mneme auto` runs a supervisor loop that picks tasks and drives the agent continuously:

```bash
mneme auto                      # Auto-pick from ready tasks
mneme auto "Build auth module"  # Start with a specific goal
```

Type feedback anytime while it runs. `/status` to check progress, `/quit` to stop.

## CLI reference

```
mneme                           Launch agent (OpenCode TUI)
mneme init                      Initialize mneme in current directory
mneme doctor                    Check dependencies and project health
mneme status                    Three-layer memory dashboard
mneme auto [goal]               Autonomous agent supervisor

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

mneme run [message]             Run agent non-interactively
mneme serve                     Start headless server
mneme compact                   Pre-compaction persistence check
mneme version                   Print version
```

## Project structure

After `mneme init`, your project contains:

```
.openclaw/
  facts/                 Long-term facts (architecture, constraints, pitfalls)
  proposals/             Pending fact proposals awaiting human review
.beads/                  Task database (managed by bd, backed by Dolt)
.opencode/
  prompt.md              Session startup prompt for the agent
AGENTS.md                Agent behavior rules and routing logic
```

## What mneme is

- A CLI that unifies agent execution, task tracking, and fact management
- A structure that gives agents persistent memory without custom infrastructure
- A workflow where humans stay in control of long-term decisions

## What mneme is not

- Not a new AI model or agent — it wraps [OpenCode](https://opencode.ai)
- Not a RAG system — facts are curated, not retrieved from embeddings
- Not a framework — it's a single CLI with zero npm dependencies
- Not opinionated about your code — it only manages agent memory

## Example

See [examples/basic/](examples/basic/) for a complete example of what a mneme-managed project looks like after initialization, with realistic facts filled in for a hypothetical todo-api project.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design document.

## License

MIT
