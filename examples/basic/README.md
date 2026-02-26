# Example: todo-api

This is what a project looks like **after running `mneme init`**, with realistic content filled in.

The scenario: you're building a REST API for a todo application using Node.js, Express, and PostgreSQL. An AI agent has been working on it across multiple sessions, using mneme to retain memory.

## Directory structure

```
todo-api/
├── AGENTS.md                              # Agent rules (scaffolded by mneme init)
├── .openclaw/
│   └── facts/
│       ├── architecture.md                # Tech stack, API design decisions
│       ├── invariants.md                  # Hard constraints the agent must follow
│       ├── performance_rules.md           # Performance lessons learned
│       └── pitfalls.md                    # Known gotchas discovered during development
├── .opencode/
│   └── prompt.md                          # Session startup instructions for the agent
├── .beads/                                # Task database (not shown — managed by bd)
└── .gitignore
```

## What each file demonstrates

### `.openclaw/facts/architecture.md`

Long-term architecture decisions that survive forever. Once the team decided on Express + PostgreSQL + JWT auth, these facts are recorded so every future agent session starts with this knowledge.

### `.openclaw/facts/invariants.md`

Hard constraints — things that must never be violated. API authentication requirements, migration compatibility rules, and response time budgets. An agent that proposes removing auth middleware will see this fact and know it's not allowed.

### `.openclaw/facts/performance_rules.md`

Performance lessons learned from production. When the agent discovered that batch size > 500 causes connection pool exhaustion, that became a fact. Future sessions won't repeat the experiment.

### `.openclaw/facts/pitfalls.md`

Non-obvious traps discovered during development. The Express `async` error handling issue, the timestamp timezone bug — these are things an agent would waste a session rediscovering without persistent memory.

### `.opencode/prompt.md`

The session startup prompt. This tells the agent to read facts first, then check tasks, then pick one task to focus on. It's the entry point that makes the three-layer architecture work.

## Try it yourself

```bash
# Install mneme
npm install -g @xqli02/mneme

# In your own project:
cd your-project
mneme init

# Fill in your facts based on what you know about the project:
#   .openclaw/facts/architecture.md  — your tech stack and design decisions
#   .openclaw/facts/invariants.md    — your hard constraints
#
# Then start the agent:
mneme
```

The agent will read your facts, check for tasks, and start working with full context.
