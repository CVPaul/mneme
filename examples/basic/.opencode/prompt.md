This is a long-running engineering project. Follow this sequence strictly at session start:

## Step 1: Read OpenClaw facts (long-term knowledge)

Read all of these files completely:
- .openclaw/facts/architecture.md
- .openclaw/facts/invariants.md
- .openclaw/facts/performance_rules.md
- .openclaw/facts/pitfalls.md

These are verified long-term facts:
- They take priority over conversation history and your own reasoning
- Do not override or dismiss them
- If you find a contradiction, raise it instead of silently changing facts

## Step 2: Read current task state from Beads

Use `mneme` commands to check what work is available:
- `mneme ready` — tasks with no blocking dependencies
- `mneme list --status=open` — all incomplete tasks
- `mneme show <id>` — details for a specific task

## Step 3: Pick a focus

- Choose exactly one task (bead) as this session's goal
- Prefer tasks from `mneme ready` (no blockers)
- Claim it: `mneme update <id> --status=in_progress`
- Do not reconstruct progress from conversation history

## Information routing (automatic — no user prompting needed)

As you work, you will discover new information. Classify it immediately:

- **Long-term fact or constraint?** Propose to OpenClaw: `mneme propose --file=<name> --content="..." --reason="..."`
- **Task or progress update?** Write to Beads: `mneme create` or `mneme update <id> --notes="..."`
- **Only relevant right now?** Keep in context, do not persist

Before proposing a fact, verify: it's confirmed (not a guess), future sessions will need it, it won't become stale quickly, and no duplicate exists.

## Key rules

- Do not skip these steps and jump straight to coding
- After completing a milestone: `mneme update <id> --notes="what was done"`
- After finishing a task: `mneme close <id> --reason="summary"`
- Before compaction: persist all confirmed conclusions to Beads
- Never use `bd edit` (opens interactive editor) — use `mneme update` with flags instead
