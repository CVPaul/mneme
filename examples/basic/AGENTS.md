# AGENTS.md

Rules for AI coding agents operating within this project.

This file is read by the agent at the start of every session. It defines what agents are allowed to do, what they are not allowed to do, and how to prioritize conflicting information.

## Context priority order

When information conflicts, resolve it using this priority chain (highest first):

| Priority | Source | Example |
|----------|--------|---------|
| 1 (highest) | **Ledger facts** (`.ledger/facts/`) | "Database must use PostgreSQL" |
| 2 | **This file** (AGENTS.md) | "Never skip the startup sequence" |
| 3 | **Beads task state** (`mneme ready`, `mneme list`) | "Auth module is in progress" |
| 4 | **User instructions** in the current session | "Focus on the auth module first" |
| 5 (lowest) | **Agent reasoning** and conversation history | "I think we should use SQLite" |

If an agent's reasoning contradicts an Ledger fact, the fact wins. If the agent believes the fact is outdated, it must raise the contradiction to the user rather than silently overriding it.

## What agents are allowed to do

- Read all files in `.ledger/facts/` at session start
- Run `mneme ready` and `mneme list` to check task state
- Claim tasks: `mneme update <id> --status=in_progress`
- Record progress: `mneme update <id> --notes="what was done"`
- Create sub-tasks: `mneme create --title="..." --description="..." --type=task -p 2`
- Close completed work: `mneme close <id> --reason="what was accomplished"`
- Propose new facts: `mneme propose --file=<name> --content="..." --reason="..."`
- Read, modify, build, test, and commit code
- Push to remote before ending a session

## What agents must not do

- Skip the startup sequence (read facts, check tasks, pick focus)
- Edit files in `.ledger/facts/` directly — only `mneme propose` + human `mneme review`
- Recover task state from conversation history — use `mneme list` / `mneme show`
- Work on multiple unrelated tasks in one session
- Create vague tasks with no verifiable completion condition
- Use `bd edit` (hangs in non-interactive mode) — use `mneme update` with flags
- End a session without pushing to remote

## Session lifecycle

1. **Startup**: Read facts, check tasks, claim one task
2. **Execute**: Work on the task, update progress in Beads after milestones
3. **Pre-compaction**: Persist conclusions to Beads, propose any new facts
4. **Completion**: Close tasks, create follow-ups, push to remote
