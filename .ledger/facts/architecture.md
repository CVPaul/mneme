# Architecture — Three-Layer Memory Architecture

## Overall Architecture

mneme uses a three-layer memory plane architecture that fully decouples information of different stability levels and lifetimes:

```
┌─────────────────────────────────────────┐
│  Layer 1: Ledger  — Long-term Facts    │  ← Extremely stable, project lifetime
├─────────────────────────────────────────┤
│  Layer 2: Beads     — Task State         │  ← Mid-term changes, cross-session
├─────────────────────────────────────────┤
│  Layer 3: OpenCode  — Current Context    │  ← High-frequency changes, single session
└─────────────────────────────────────────┘
```

## Agent Orchestration

Layer 3 uses [OpenCode](https://opencode.ai) with [oh-my-opencode](https://github.com/nickarora/oh-my-opencode) for multi-agent orchestration. oh-my-opencode provides specialized agents (Sisyphus, Hephaestus, Prometheus, Atlas, etc.) that the user can switch between via Tab in the TUI.

The mneme plugin (`.opencode/plugins/mneme.ts`) registers 12 tools that give all agents direct access to the Ledger and Beads layers:
- **Beads tools**: `mneme_ready`, `mneme_list`, `mneme_show`, `mneme_create`, `mneme_update`, `mneme_close`, `mneme_blocked`, `mneme_dep`
- **Ledger tools**: `mneme_facts`, `mneme_propose_fact`
- **Status tools**: `mneme_status`, `mneme_doctor`

A compaction hook automatically injects task state and facts overview into the compaction context, ensuring critical information survives context compaction.

## Layer Responsibilities

### Ledger (Long-term Facts Layer)

- **Storage**: `.ledger/facts/` directory
- **Content**: Architecture decisions, immutable constraints, performance red lines, known pitfalls
- **Write frequency**: Extremely low — only when a new long-term fact is confirmed
- **Read frequency**: Must be read at the start of every session (via `mneme_facts` tool)
- **Stability requirement**: Once written, content must not be easily modified or deleted; changes require human approval

### Beads (Task State Layer)

- **Tool**: [bd (beads)](https://github.com/steveyegge/beads) — distributed Git-backed graph issue tracker
- **Backend**: Dolt (versioned SQL database) with cell-level merge and native branching
- **Storage**: `.beads/` directory (created and managed by `bd init`)
- **Content**: Task definitions, status, priority (P0–P4), dependencies, notes
- **State flow**: open → in_progress → closed (also blocked, deferred)
- **ID format**: Hash-based (e.g. `bd-a1b2`) to prevent merge conflicts
- **Write frequency**: Moderate — updated after each milestone (via `mneme_update`, `mneme_create`, `mneme_close` tools)
- **Read frequency**: Checked via `mneme_ready` / `mneme_list` tools at session start

### OpenCode (Short-term Execution Layer)

- **Runtime**: OpenCode + oh-my-opencode multi-agent system
- **Agents**: Sisyphus (primary), Hephaestus (deep analysis), Prometheus (fast planning), Atlas (refactoring), and more
- **No persistent storage**: Exists only in the current session's conversation context
- **Content**: Code analysis, file modifications, command execution, and other immediate operations
- **Lifetime**: Disappears on session end or context compaction
- **Core principle**: Does not carry memory, does not manage tasks; accesses Ledger and Beads through mneme tools

## Data Flow

```
Session start:
  Agent ── mneme_facts ──→ Ledger facts (establish long-term context)
  Agent ── mneme_ready / mneme_list ──→ Beads (restore task progress)
  Agent ── mneme_update (status=in_progress) ──→ claim one bead as focus

During execution:
  Agent ── executes ──→ code operations
  Agent ── mneme_update (notes) ──→ Beads (record progress)
  Agent ── mneme_create ──→ Beads (create newly discovered sub-tasks)

Before compaction:
  Agent ── mneme_update (notes) ──→ Beads (persist confirmed conclusions)
  Agent ── mneme_propose_fact ──→ new facts → Ledger (requires human approval)
  Compaction hook ── injects ──→ mneme state into compaction context
```

## Directory Structure

```
project/
├── opencode.json                # OpenCode config (plugin declarations, default model)
├── AGENTS.md                    # Agent behavior rules
├── .ledger/
│   └── facts/
│       ├── architecture.md      # Project architecture
│       ├── invariants.md        # Hard constraints and red lines
│       ├── performance_rules.md # Performance rules
│       └── pitfalls.md          # Known pitfalls and lessons
├── .beads/                      # Beads data (managed by bd init)
│   ├── config.yaml              # Beads config
│   └── dolt/                    # Dolt database directory
└── .opencode/
    ├── prompt.md                # Session startup prompt
    ├── plugins/
    │   └── mneme.ts             # mneme plugin (12 tools + compaction hook)
    ├── oh-my-opencode.jsonc     # Agent/model routing configuration
    ├── package.json             # Plugin dependencies
    └── node_modules/            # Installed plugins (gitignored)
```

## Technical Dependencies

- **mneme**: `npm install -g @xqli02/mneme` — unified CLI entry point (zero npm dependencies)
- **OpenCode**: AI agent runtime
- **oh-my-opencode**: Multi-agent orchestration plugin for OpenCode
- **bd** (beads CLI): Task management backend, called internally by mneme
- **Dolt**: Backend database for bd, managed automatically
- **Git**: Version control and collaboration foundation
