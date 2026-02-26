# Invariants — Hard Constraints

## Three-Layer Separation Principle

1. **Facts and state must not be mixed**
   - Ledger stores only confirmed long-term facts — no task progress or temporary conclusions
   - Beads stores only task state and progress — no architecture decisions or long-term facts
   - Information transfer between layers must be explicit, never implicit

2. **Ledger immutability**
   - Once written, Ledger facts must not be unilaterally modified or deleted by agents
   - If an agent finds facts contradicting current reality, it must **raise the contradiction** rather than edit directly
   - Modifying Ledger content requires human approval

3. **Beads atomicity**
   - Every bead must be a clear, verifiable task
   - No vague beads that cannot be objectively judged as complete or incomplete
   - No oversized beads — break them into sub-tasks or use an epic

## Information Writing Rules

4. **Only record confirmed information**
   - Ledger must not contain: temporary ideas, unverified hypotheses, speculative conclusions
   - Information must be verified or human-approved before being written to facts

5. **Priority chain**
   - Ledger facts take priority **over** conversation history
   - Ledger facts take priority **over** agent reasoning
   - When they conflict, Ledger wins unless there is clear evidence to overturn it

## Session Behavior Rules

6. **Every session must begin by reading all three layers**
   - Read Ledger facts → check Beads via `mneme ready` / `mneme list` → then start executing
   - Skipping any step is prohibited

7. **Single focus principle**
   - Each session selects exactly one bead as its focus
   - No working on multiple unrelated beads in a single session

8. **Must persist before compaction**
   - Before context compaction, confirmed conclusions must be written to Beads (`mneme update --notes`)
   - If a new long-term fact is discovered, it must be proposed to Ledger
   - Principle: **you can lose the reasoning process, but you must not lose state or facts**

## Beads Usage Rules

9. **Manage tasks through mneme CLI**
   - Use `mneme create` to create tasks (must specify `--title`, `--description`, `--type`, `-p`)
   - Use `mneme update` to update tasks (never use `bd edit` — it opens an interactive editor)
   - Use `mneme close` to close completed tasks
   - Use `mneme dep add` to manage dependencies

10. **Priorities use numbers 0–4**
    - 0 = Critical, 1 = High, 2 = Medium (default), 3 = Low, 4 = Backlog
    - Do not use text descriptions like "high" / "medium" / "low"

## Format and Naming Rules

11. **Ledger facts use Markdown format**
    - Each file has a clear topical scope
    - Use numbering for easy reference

12. **Beads are managed through mneme CLI**
    - Data is stored in a Dolt database (`.beads/` directory)
    - IDs are hash-based (e.g. `bd-a1b2`) and must not be manually edited
