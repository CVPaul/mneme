# Architecture — Three-Layer Memory Architecture

## Overall Architecture

mneme uses a three-layer memory plane architecture that fully decouples information of different stability levels and lifetimes:

```
┌─────────────────────────────────────────┐
│  Layer 1: OpenClaw  — Long-term Facts    │  ← Extremely stable, project lifetime
├─────────────────────────────────────────┤
│  Layer 2: Beads     — Task State         │  ← Mid-term changes, cross-session
├─────────────────────────────────────────┤
│  Layer 3: OpenCode  — Current Context    │  ← High-frequency changes, single session
└─────────────────────────────────────────┘
```

## Layer Responsibilities

### OpenClaw (Long-term Facts Layer)

- **Storage**: `.openclaw/facts/` directory
- **Content**: Architecture decisions, immutable constraints, performance red lines, known pitfalls
- **Write frequency**: Extremely low — only when a new long-term fact is confirmed
- **Read frequency**: Must be read at the start of every session
- **Stability requirement**: Once written, content must not be easily modified or deleted; changes require explicit justification

### Beads (Task State Layer)

- **Tool**: [bd (beads)](https://github.com/steveyegge/beads) — distributed Git-backed graph issue tracker
- **Backend**: Dolt (versioned SQL database) with cell-level merge and native branching
- **Storage**: `.beads/` directory (created and managed by `bd init`)
- **Content**: Task definitions, status, priority (P0–P4), dependencies, notes
- **State flow**: open → in_progress → closed (also blocked, deferred)
- **ID format**: Hash-based (e.g. `bd-a1b2`) to prevent merge conflicts
- **Write frequency**: Moderate — updated after each milestone
- **Read frequency**: Checked via `mneme ready` / `mneme list` at session start

### OpenCode (Short-term Execution Layer)

- **No persistent storage**: Exists only in the current session's conversation context
- **Content**: Code analysis, file modifications, command execution, and other immediate operations
- **Lifetime**: Disappears on session end or context compaction
- **Core principle**: Does not carry memory, does not manage tasks

## Data Flow

```
Session start:
  OpenCode ── reads ──→ OpenClaw facts (establish long-term context)
  OpenCode ── mneme ready / mneme list ──→ Beads (restore task progress)
  OpenCode ── mneme update --status=in_progress ──→ claim one bead as focus

During execution:
  OpenCode ── executes ──→ code operations
  OpenCode ── mneme update --notes ──→ Beads (record progress)
  OpenCode ── mneme create ──→ Beads (create newly discovered sub-tasks)

Before compaction:
  OpenCode ── mneme update --notes ──→ Beads (persist confirmed conclusions)
  OpenCode ── proposes ──→ new long-term facts → OpenClaw (requires human approval)
```

## Directory Structure

```
project/
├── README.md                    # Project overview and quick start
├── ARCHITECTURE.md              # Three-layer memory architecture design doc
├── AGENTS.md                    # Agent behavior rules
├── .openclaw/
│   └── facts/
│       ├── architecture.md      # Project architecture
│       ├── invariants.md        # Hard constraints and red lines
│       ├── performance_rules.md # Performance rules
│       └── pitfalls.md          # Known pitfalls and lessons
├── .beads/                      # Beads data (managed by bd init)
│   ├── config.yaml              # Beads config
│   └── dolt/                    # Dolt database directory
└── .opencode/
    └── prompt.md                # Session startup prompt
```

## Technical Dependencies

- **mneme**: `npm install -g @xqli02/mneme` — unified CLI entry point
- **bd** (beads CLI): Task management backend, called internally by mneme
- **Dolt**: Backend database for bd, managed automatically by bd
- **Git**: Version control and collaboration foundation
