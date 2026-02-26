# Architecture

## Design goals

mneme exists to solve a specific problem: AI coding agents lose context over time. They work in sessions with limited context windows. When the window fills up, the runtime compacts it — and information disappears. Over the course of a long project, this means agents forget architectural decisions, lose track of task progress, and repeat analysis they already did.

The architecture is built around four goals:

1. **Survive compaction.** The important things — verified facts and task state — must persist outside the context window, in storage the agent reads at session start.

2. **Separate by stability.** Not all information changes at the same rate. Architecture decisions last months. Task progress changes daily. Code analysis is disposable. Mixing them means the wrong things get lost.

3. **Keep humans in the loop.** Agents should not unilaterally rewrite long-term project knowledge. Facts require human approval. Tasks are transparent and inspectable.

4. **Stay simple.** No databases to configure, no services to run, no SDKs to integrate. One CLI, zero npm dependencies, plain files where possible.

## Three layers

mneme separates agent memory into three layers, each with a different stability and lifetime:

```
┌─────────────────────────────────────────────────┐
│  Layer 1: Ledger    Facts       (long-term)   │
├─────────────────────────────────────────────────┤
│  Layer 2: Beads       Task state  (mid-term)    │
├─────────────────────────────────────────────────┤
│  Layer 3: OpenCode    Execution   (short-term)  │
└─────────────────────────────────────────────────┘
```

Information flows downward at session start (agent reads facts, then tasks) and upward during work (agent proposes facts, updates tasks). Each layer has strict ownership rules that prevent information from leaking into the wrong place.

### Layer 1: Ledger (Facts)

**Purpose:** Store verified engineering facts that outlive any single task or session.

**Storage:** `.ledger/facts/*.md` — plain Markdown files in version control.

**Contents:**
- Architecture decisions ("We use PostgreSQL, not SQLite")
- Constraints and invariants ("Never modify production data directly")
- Performance rules ("Batch size must not exceed 1000")
- Known pitfalls ("The bd edit command opens an interactive editor — don't use it from agents")

**Write rules:**
- Agents cannot write directly. They propose changes via `mneme propose`.
- A human reviews and approves via `mneme review`.
- Only verified, long-term facts belong here. No hypotheses, no temporary conclusions.

**Read rules:**
- Every session starts by reading all facts files.
- Facts have higher priority than conversation history or agent reasoning.
- If an agent finds a fact that seems wrong, it must raise the contradiction rather than ignore or override the fact.

**Why Markdown files?** They're diffable, reviewable in pull requests, and readable without tooling. There's no query language to learn. The total budget is kept under 800 lines across all files — small enough to load into any context window.

### Layer 2: Beads (Task state)

**Purpose:** Track what work exists, what's done, what's blocked, and what's next — across sessions.

**Storage:** `.beads/` directory, managed by [bd](https://github.com/steveyegge/beads), backed by [Dolt](https://www.dolthub.com/) (a version-controlled SQL database).

**Contents:**
- Task definitions with title, description, type, and priority (P0–P4)
- Status: open, in_progress, closed, blocked, deferred
- Dependencies between tasks (task A blocks task B)
- Notes recording progress at each stage

**Write rules:**
- Agents claim tasks (`mneme update <id> --status=in_progress`) before starting work.
- Progress is recorded in notes (`mneme update <id> --notes="..."`) after each milestone.
- New sub-tasks are created as they're discovered (`mneme create`).
- Completed tasks are closed with a reason (`mneme close <id> --reason="..."`).

**Read rules:**
- Every session checks `mneme ready` (unblocked tasks) and `mneme list --status=in_progress` (current work).
- The agent picks one task as its focus for the session. Not two. Not five. One.

**Why Dolt?** Hash-based IDs prevent merge conflicts when multiple agents or branches create tasks concurrently. Dolt's cell-level merge means task updates from parallel sessions don't collide. The dependency graph lets agents reason about what's actionable without human intervention.

### Layer 3: OpenCode (Execution)

**Purpose:** Execute the current task. Read code, edit files, run commands.

**Storage:** None. Lives entirely in the agent's context window.

**Contents:**
- Code analysis and reasoning
- File edits in progress
- Command output
- Intermediate conclusions that only matter for the current task

**Rules:**
- The execution layer does not carry memory. When the session ends, this context is gone.
- It does not manage tasks. It reads task state from Beads and writes progress back.
- It does not store facts. It reads facts from Ledger and proposes new ones for human review.
- Before context compaction, it must flush confirmed conclusions to Beads and propose any new facts to Ledger.

**Why no persistence?** Because most of what happens during execution is transient. The reasoning chain, the failed approaches, the debug output — these don't need to survive. What matters is the conclusion, and that gets written to the appropriate layer (Beads for progress, Ledger for facts). Trying to persist everything leads to bloated context that slows down future sessions.

## Why separate the layers?

The separation isn't arbitrary. It follows from three observations about how information behaves in long-running projects:

### Different information has different lifetimes

An architecture decision ("use event sourcing") lasts the life of the project. A task ("implement the event store") lasts days or weeks. A code analysis ("this function has a bug on line 47") lasts minutes. Storing all three in the same place means either the short-lived information drowns out the long-lived, or the system tries to keep everything forever and becomes unwieldy.

By assigning each category to a layer with a matching lifetime, nothing is over-retained or under-retained.

### Different information has different trust levels

Facts in Ledger have been verified by a human. Task state in Beads is maintained by agents but is inspectable and correctable. Execution context is raw agent reasoning that may be wrong.

If these were mixed, an agent could overwrite a human-verified architectural decision with a conclusion from a single debugging session. The layered model prevents this: facts require human approval to change, while task notes can be updated freely.

### Compaction is inevitable

Context windows are finite. Every production agent system will compact context eventually. The question is what survives.

Without structure, compaction is lossy in unpredictable ways — maybe the architecture decision survives, maybe the task progress does, maybe neither. With the three-layer model, compaction only affects Layer 3 (execution context). Layers 1 and 2 are outside the context window entirely, stored on disk, and read fresh at session start.

The design principle is: **you can lose the reasoning, but you must not lose the state or the facts.**

## Information routing

When an agent encounters new information during work, it must decide where it belongs. The routing logic is a decision tree:

```
New information
  │
  ├─ "Will this matter in 6 months?"
  │    ├─ Yes, and it's a fact/constraint/lesson → Ledger (propose, await approval)
  │    ├─ Yes, and it's a task or progress note  → Beads (write directly)
  │    └─ No →  "Will the next session need this?"
  │              ├─ Yes → Beads (write to notes or create a task)
  │              └─ No  → Stay in execution context, don't persist
```

Examples:

| Information | Layer | Reasoning |
|---|---|---|
| "This project uses Dolt as its database" | Ledger | Architecture decision, won't change |
| "Never run bd edit from an agent" | Ledger | Pitfall, repeatedly relevant |
| "Need to implement auth module" | Beads | Work item with a clear completion criteria |
| "Auth module: JWT signing done, verification next" | Beads | Progress that the next session needs |
| "This function's third arg is a timeout" | Execution | Only relevant to the current task |

## Data flow

```
Session start:
  Agent ──read──→ Ledger facts         (establish long-term context)
  Agent ──read──→ Beads via mneme ready   (find actionable work)
  Agent ──claim──→ one task               (single focus per session)

During execution:
  Agent ──work──→ code changes
  Agent ──write──→ Beads notes            (record progress)
  Agent ──create──→ new Beads tasks       (discovered sub-work)

Before compaction:
  Agent ──flush──→ Beads notes            (persist confirmed conclusions)
  Agent ──propose──→ Ledger             (new facts, pending human review)

Session end:
  Agent ──close──→ Beads task             (if complete)
  Agent ──push──→ git                     (code + facts + task state)
```

## Technical dependencies

mneme is a Node.js CLI with zero npm dependencies. It orchestrates three external tools:

| Component | Role | Storage |
|---|---|---|
| **mneme** | Unified CLI entry point | — |
| **[OpenCode](https://opencode.ai)** | AI agent runtime | Context window (ephemeral) |
| **[bd (beads)](https://github.com/steveyegge/beads)** | Task tracker | `.beads/` (Dolt database) |
| **[Dolt](https://www.dolthub.com/)** | Version-controlled SQL database | `.beads/dolt/` |
| **Git** | Version control | `.git/` |

Ledger is not a separate tool — it's a convention: Markdown files in `.ledger/facts/`, managed through `mneme propose` and `mneme review`.

## File layout

```
.ledger/
  facts/
    architecture.md          Verified architecture decisions
    invariants.md            Constraints that must not be violated
    performance_rules.md     Performance boundaries
    pitfalls.md              Known traps and lessons learned
  proposals/
    <timestamp>-<hash>.json  Pending fact proposals awaiting review
.beads/
  config.yaml                Beads configuration
  dolt/                      Dolt database (gitignored)
.opencode/
  prompt.md                  Session startup instructions for the agent
AGENTS.md                    Agent behavior rules and routing logic
```
