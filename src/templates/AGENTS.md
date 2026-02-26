# AGENTS.md

Rules for AI coding agents operating within a mneme-managed project.

This file is read by the agent at the start of every session. It defines what agents are allowed to do, what they are not allowed to do, and how to prioritize conflicting information.

## Context priority order

When information conflicts, resolve it using this priority chain (highest first):

| Priority | Source | Example |
|----------|--------|---------|
| 1 (highest) | **OpenClaw facts** (`.openclaw/facts/`) | "Database must use PostgreSQL" |
| 2 | **This file** (AGENTS.md) | "Never skip the startup sequence" |
| 3 | **Beads task state** (`mneme ready`, `mneme list`) | "Auth module is in progress" |
| 4 | **User instructions** in the current session | "Focus on the auth module first" |
| 5 (lowest) | **Agent reasoning** and conversation history | "I think we should use SQLite" |

If an agent's reasoning contradicts an OpenClaw fact, the fact wins. If the agent believes the fact is outdated, it must raise the contradiction to the user rather than silently overriding it.

## What agents are allowed to do

### Read from all three layers

- Read all files in `.openclaw/facts/` at session start
- Run `mneme ready` and `mneme list` to check task state
- Read any project file needed for the current task

### Manage tasks through mneme

- Claim a task: `mneme update <id> --status=in_progress`
- Record progress: `mneme update <id> --notes="what was done"`
- Create sub-tasks: `mneme create --title="..." --description="..." --type=task -p 2`
- Add dependencies: `mneme dep add <child> <parent>`
- Close completed work: `mneme close <id> --reason="what was accomplished"`

### Propose facts (with human approval)

- Propose new long-term facts: `mneme propose --file=<name> --content="..." --reason="..."`
- A proposal must specify: which facts file, the exact content, and why it qualifies as a long-term fact
- The proposal is not written to facts until a human approves it via `mneme review`

### Execute code operations

- Read, analyze, and modify code files
- Run commands (build, test, lint, etc.)
- Create commits and push to remote
- All code operations must serve the current focused task

### Persist state before compaction

When context is getting long or a milestone is reached:
- Flush confirmed conclusions to Beads: `mneme update <id> --notes="..."`
- Propose any discovered facts to OpenClaw
- Close completed tasks or update notes with current progress and blockers
- Then allow compaction to proceed

### Complete sessions cleanly

Before ending a session:
1. Create tasks for any remaining work: `mneme create`
2. Run quality gates if code changed (tests, linters, builds)
3. Close finished tasks, update in-progress tasks with notes
4. Push to remote — this is mandatory:
   ```bash
   git pull --rebase
   git push
   git status  # Must show "up to date with origin"
   ```
5. If push fails, resolve and retry until it succeeds

## What agents are not allowed to do

### Never skip the startup sequence

Every session must begin with:
1. Read `.openclaw/facts/` (all files)
2. Run `mneme ready` and `mneme list --status=open`
3. Pick one task as the session focus
4. Begin work

Skipping any step is prohibited. Do not start coding before reading facts and tasks.

### Never modify OpenClaw facts directly

- Do not edit, delete, or overwrite files in `.openclaw/facts/`
- Do not write unverified hypotheses, temporary conclusions, or speculative analysis to facts
- The only path to changing facts is `mneme propose` followed by human `mneme review --approve`

### Never recover state from conversation history

- Do not reconstruct task progress from earlier messages in the conversation
- All task state must come from Beads (`mneme list`, `mneme show`)
- If a bead's notes are empty, ask the user rather than guessing from context

### Never work on multiple unrelated tasks

- Each session focuses on one task (one bead)
- Do not switch between unrelated tasks within a single session
- If a new urgent task is discovered, create it as a bead and let the next session pick it up

### Never create vague tasks

- Every bead must have a clear, verifiable completion condition
- Bad: "Improve performance" — no way to know when it's done
- Good: "Reduce API response time below 200ms for /users endpoint"

### Never use bd edit

- `bd edit` opens an interactive editor (`$EDITOR`), which hangs non-interactive agents
- Always use `mneme update <id>` with flags (`--notes`, `--status`, `--title`, `--description`)

### Never use markdown TODOs for task tracking

- All task tracking goes through mneme/beads
- Do not create TODO lists in markdown files, code comments, or any other format
- Do not use external issue trackers

### Never stop before pushing

- Work is not complete until `git push` succeeds
- Do not say "ready to push when you are" — push immediately
- If push fails, resolve the conflict and retry

## Session lifecycle

### 1. Startup

```bash
# Read long-term facts
cat .openclaw/facts/*.md

# Check available work
mneme ready
mneme list --status=open
mneme list --status=in_progress

# Claim a task
mneme update <id> --status=in_progress
```

### 2. Execution

Work on the focused task. After each milestone:

```bash
mneme update <id> --notes="Completed X. Next step: Y."
```

If you discover a sub-task:

```bash
mneme create --title="Sub-task title" --description="Context" --type=task -p 2
mneme dep add <new-id> <parent-id>
```

### 3. Pre-compaction

When context is growing long or you've finished a milestone:

1. Write confirmed conclusions to Beads notes
2. Propose any new facts via `mneme propose`
3. Close completed tasks or update notes with blockers

Principle: **you can lose the reasoning, but you must not lose the state or the facts.**

### 4. Completion

```bash
# Close finished work
mneme close <id> --reason="Summary of what was done"

# Create tasks for remaining work
mneme create --title="Follow-up" --description="..." --type=task -p 2

# Push everything
git pull --rebase && git push
```

## Information routing

When you encounter new information, classify it immediately:

```
New information
  │
  ├─ Will this matter in 6 months?
  │    ├─ Yes + it's a fact/constraint/lesson  → Propose to OpenClaw
  │    ├─ Yes + it's a task or progress update → Write to Beads
  │    └─ No  → Will the next session need it?
  │              ├─ Yes → Write to Beads (notes or new task)
  │              └─ No  → Keep in context, don't persist
```

| Information | Layer | Action |
|---|---|---|
| "This project uses event sourcing" | OpenClaw | `mneme propose --file=architecture` |
| "Never call the payments API without idempotency keys" | OpenClaw | `mneme propose --file=invariants` |
| "Batch size over 1000 causes OOM" | OpenClaw | `mneme propose --file=performance_rules` |
| "The config parser silently drops unknown keys" | OpenClaw | `mneme propose --file=pitfalls` |
| "Need to add rate limiting to the API" | Beads | `mneme create --title="Add API rate limiting"` |
| "Rate limiting: token bucket implemented, need tests" | Beads | `mneme update <id> --notes="..."` |
| "This function returns null on line 47" | Context | Don't persist |

### Proposing facts: threshold check

Before proposing a fact, verify all four conditions:

- [ ] The information has been verified (not a hypothesis or guess)
- [ ] Future sessions will repeatedly need it (not one-time)
- [ ] It won't become outdated quickly (not a temporary state)
- [ ] No equivalent fact already exists in `.openclaw/facts/`

All four must pass. Then propose and wait for human approval.

## Task management reference

### Issue types

| Type | Use for |
|---|---|
| `bug` | Something broken |
| `feature` | New functionality |
| `task` | Work items: tests, docs, refactoring |
| `epic` | Large feature with sub-tasks |
| `chore` | Maintenance: dependencies, tooling |

### Priorities

| Priority | Level | Use for |
|---|---|---|
| `0` / P0 | Critical | Security, data loss, broken builds |
| `1` / P1 | High | Major features, important bugs |
| `2` / P2 | Medium | Default priority |
| `3` / P3 | Low | Polish, optimization |
| `4` / P4 | Backlog | Future ideas |

### Commands

```bash
# Find work
mneme ready                           # Unblocked tasks
mneme list --status=open              # All open tasks
mneme list --status=in_progress       # Active work
mneme show <id>                       # Task details with dependencies
mneme blocked                         # Tasks waiting on blockers

# Create and link
mneme create --title="..." --description="..." --type=task -p 2
mneme dep add <child> <parent>

# Update
mneme update <id> --status=in_progress
mneme update <id> --notes="Progress notes"

# Complete
mneme close <id> --reason="Done"
```
