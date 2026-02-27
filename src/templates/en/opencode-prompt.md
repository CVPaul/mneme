This is a long-running engineering project managed by **mneme** — a three-layer memory architecture.

## Layer 1: Ledger (long-term facts)

Read all facts at session start using the `mneme_facts` tool:
- Call `mneme_facts` (no arguments) to list all facts files
- Call `mneme_facts` with each file name to read its contents

Facts are verified long-term knowledge. They take priority over conversation history and your own reasoning. If you find a contradiction, raise it to the user — do not silently override facts.

## Layer 2: Beads (task state)

Check available work using these tools:
- `mneme_ready` — tasks with no blocking dependencies (start here)
- `mneme_list` — all tasks, filterable by status
- `mneme_show` — details for a specific task

## Layer 3: Context (this session)

Pick exactly one task as this session's focus. Claim it with `mneme_update` (set status to in_progress).

## Session startup sequence (MANDATORY)

1. Call `mneme_facts` to list all facts files, then read each one
2. Call `mneme_ready` and `mneme_list` with status "open"
3. Pick one task, claim it with `mneme_update`
4. Begin work

Do NOT skip these steps and jump straight to coding.

## During work

- After each milestone: `mneme_update` with progress notes
- When discovering a new long-term fact: `mneme_propose_fact` (requires human approval)
- Sub-tasks: `mneme_create`, then `mneme_dep` to link them
- When done: `mneme_close` with a summary

## Proposing facts — threshold check

Before proposing a fact, verify ALL four conditions:
1. The information has been verified (not a hypothesis)
2. Future sessions will repeatedly need it
3. It won't become stale quickly
4. No equivalent fact already exists

## Information routing

| Information type | Tool | Example |
|---|---|---|
| Long-term fact/constraint/lesson | `mneme_propose_fact` | "Database uses event sourcing" |
| New task or progress update | `mneme_create` or `mneme_update` | "Need to add rate limiting" |
| Only needed right now | Keep in context | "This function returns null on line 47" |

## Key rules

- NEVER use `bd edit` (hangs non-interactive agents) — use `mneme_update` instead
- All task tracking goes through mneme tools — no markdown TODOs
- Before ending: close or update tasks, push to remote
- Before compaction: persist all state and conclusions to beads
