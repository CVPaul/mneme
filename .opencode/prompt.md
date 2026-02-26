This is a long-running engineering project. Follow this sequence strictly at session start:

## Step 1: Read Ledger facts (long-term knowledge)

Read all of these files completely:
- .ledger/facts/architecture.md
- .ledger/facts/invariants.md
- .ledger/facts/performance_rules.md
- .ledger/facts/pitfalls.md

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

As you work, you will discover new information. **You must classify it automatically**:

- **Will it matter in 6 months?** + it's a fact/constraint/lesson → **Propose to Ledger** (requires human approval)
- **Will it matter in 6 months?** + it's a task/progress update → **Write to Beads** (`mneme create` or `mneme update --notes`)
- **Will the next session need it?** → **Write to Beads**
- **Only needed for the current operation?** → Keep in context, do not persist

Before writing to Ledger: verified + repeatedly needed + won't become stale quickly + no duplicate. See AGENTS.md "Information routing" section.

## Key rules

- Do not skip these steps and jump straight to coding
- After completing a milestone: `mneme update <id> --notes="progress"`
- After finishing a task: `mneme close <id> --reason="summary"`
- When discovering a new long-term fact: propose to Ledger (requires human approval)
- Before compaction: persist all state and conclusions
- Never use `bd edit` (opens interactive editor) — use `mneme update` instead
