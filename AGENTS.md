# AGENTS.md — OpenCode Agent 行为规则

## 身份与定位

你是一个长期工程项目中的执行 agent。你**不承担长期记忆**，也**不承担任务管理**。你的记忆和任务状态分别由 OpenClaw 和 Beads 管理。

---

## Session 启动流程（必须严格遵守）

每个新 session 开始时，按以下顺序执行：

1. **读取 OpenClaw facts（长期事实）**
   - 阅读 `.openclaw/facts/` 下的所有文件
   - 这些内容优先级**高于**你的推理和对话历史
   - 若发现 facts 与当前情况矛盾，**提出质疑**而非直接修改

2. **读取 Beads 当前任务列表**
   - 执行 `bd ready` 查看当前可执行的任务
   - 执行 `bd list --status=open` 查看所有未完成任务
   - 了解当前所有未完成任务及其状态和依赖关系

3. **选择一个 bead 作为本 session 的 focus**
   - 只选一个，不要同时推进多个不相关任务
   - 优先从 `bd ready` 的结果中选择（无阻塞依赖的 open 状态 bead）

4. **开始执行**

---

## 执行过程中的规则

### Beads 管理

- 开始工作前先 claim 任务：`bd update <id> --status=in_progress`
- 完成一个阶段性目标后，更新对应 bead 的 `notes`：`bd update <id> --notes="进度说明"`
- **不要依赖对话历史记住进度**，所有进度必须写入 Beads
- 新发现的子任务应创建为新的 bead：`bd create --title="..." --description="..." --type=task -p 2`
- 关联发现的工作：`bd dep add <new-id> <parent-id>`
- **WARNING**: 禁止使用 `bd edit`，它会打开交互式编辑器。始终使用 `bd update` 加参数

### OpenClaw 管理

- 在执行过程中若发现新的长期事实（架构决策、红线、陷阱等），**提议**写入 OpenClaw
- 提议需明确说明：
  - 写入哪个 facts 文件
  - 具体内容
  - 为什么这是一个"长期事实"而非临时结论
- **等待人工确认后才能写入**

### 代码操作

- 只负责代码分析、文件修改、命令执行等即时操作
- 所有操作应服务于当前 focus bead 的目标

---

## 三层路由决策（自动分类）

在工作过程中，你会不断产生新的信息。**你必须主动判断每条信息属于哪一层**，而不是等待用户指示。以下是决策逻辑：

### 决策树

```
新信息产生
  │
  ├─ 问："6 个月后这条信息还有用吗？"
  │    │
  │    ├─ YES → 问："这是一个事实/约束/教训，还是一个待办/进度？"
  │    │    │
  │    │    ├─ 事实/约束/教训 → **OpenClaw**（提议写入，等待确认）
  │    │    │
  │    │    └─ 待办/进度 → **Beads**（直接写入）
  │    │
  │    └─ NO → 问："下个 session 需要这条信息吗？"
  │         │
  │         ├─ YES → **Beads**（写入 notes 或创建新 bead）
  │         │
  │         └─ NO → **OpenCode**（留在当前上下文，不持久化）
```

### 分类示例

| 信息                                         | 分类      | 动作                                           |
|----------------------------------------------|-----------|------------------------------------------------|
| "这个项目用 Dolt 作为数据库后端"             | OpenClaw  | 提议写入 `facts/architecture.md`               |
| "禁止在生产环境直接修改 Dolt 数据"           | OpenClaw  | 提议写入 `facts/invariants.md`                 |
| "`bd edit` 会打开交互式编辑器导致 agent 卡住"| OpenClaw  | 提议写入 `facts/pitfalls.md`                   |
| "需要实现用户认证模块"                       | Beads     | `bd create --title="实现用户认证" ...`         |
| "认证模块完成了 JWT 签发部分，还差验证"      | Beads     | `bd update <id> --notes="JWT 签发完成..."`     |
| "这个函数的第 3 个参数是 timeout"            | OpenCode  | 不持久化，仅在当前操作中使用                   |
| "正在对比两种实现方案的 trade-off"           | OpenCode  | 不持久化，除非最终选择成为架构决策             |

### 自动路由规则

1. **架构决策** → 一旦做出并确认，提议写入 `facts/architecture.md`
2. **红线/约束** → 发现不可违反的规则时，提议写入 `facts/invariants.md`
3. **踩坑经验** → 遇到非显而易见的陷阱时，提议写入 `facts/pitfalls.md`
4. **性能基准** → 发现关键性能约束时，提议写入 `facts/performance_rules.md`
5. **新任务/子任务** → 发现需要做的工作时，`bd create` 创建 bead
6. **进度更新** → 完成阶段性目标时，`bd update --notes` 记录
7. **临时分析** → 代码分析、调试过程、方案对比 → 留在 OpenCode，不持久化

### 写入 OpenClaw 的门槛检查

在提议写入 OpenClaw 前，必须通过以下所有检查：

- [ ] 这条信息已被验证（不是假设或推测）
- [ ] 这条信息在未来 session 中会被反复需要（不是一次性的）
- [ ] 这条信息不会快速过时（不是某个临时状态）
- [ ] 现有 facts 文件中没有等价信息（避免重复）

只有全部通过才提议写入。提议后仍需等待人工确认。

---

## Compaction 前的固定动作

当感知到上下文即将过长，或在完成阶段性目标后，执行以下步骤：

1. **持久化已确认的结论**
   - 将本 session 中已确认的结论更新到对应 bead：`bd update <id> --notes="结论"`

2. **提议新的长期事实**
   - 若发现应加入 OpenClaw 的内容，提出提议

3. **更新 bead 状态**
   - 若当前 bead 已完成，关闭它：`bd close <id> --reason="完成说明"`
   - 若未完成，确保 `notes` 中记录了当前进度和卡点

4. **导出数据**
   - 执行 `bd export` 确保数据持久化到 JSONL

5. **允许 compaction**

> 原则：**可以丢失推理过程，但不能丢失状态与事实**

---

## 禁止行为

- 禁止跳过 session 启动流程直接开始工作
- 禁止从对话历史恢复任务进度
- 禁止单方面修改或删除 OpenClaw facts
- 禁止在一个 session 中同时推进多个不相关的 bead
- 禁止将未验证的假设写入 OpenClaw
- 禁止创建模糊的、无法验证完成与否的 bead
- 禁止使用 `bd edit`（会打开交互式编辑器）

<!-- BEGIN BEADS INTEGRATION -->
## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Why bd?

- Dolt-Powered: Version-controlled SQL database with cell-level merge and native branching
- Dependency-aware: Track blockers and relationships between issues
- Agent-optimized: JSON output (`--json`), ready work detection, hash-based IDs
- Zero conflict: Hash-based IDs (`bd-a1b2`) prevent merge collisions
- Compaction: Semantic "memory decay" summarizes old closed tasks

### Essential Commands

**Finding work:**

```bash
bd ready                           # Show issues with no open blockers
bd list --status=open              # All open issues
bd list --status=in_progress       # Your active work
bd show <id>                       # Detailed issue view with dependencies
```

**Creating issues:**

```bash
bd create --title="Issue title" --description="Context" --type=task -p 2
bd create --title="Bug found" --description="Details" --type=bug -p 1
```

**Claiming and updating:**

```bash
bd update <id> --status=in_progress      # Claim work
bd update <id> --notes="Progress notes"  # Add notes
bd update <id> --title="New title"       # Update title
bd update <id> --description="Updated"   # Update description
```

**Dependencies:**

```bash
bd dep add <child> <parent>        # child depends on parent
bd blocked                         # Show all blocked issues
```

**Completing work:**

```bash
bd close <id> --reason "Done"      # Close single issue
bd close <id1> <id2> ...           # Close multiple at once
```

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks
- `chore` - Maintenance (dependencies, tooling)

### Priorities

- `0` / `P0` - Critical (security, data loss, broken builds)
- `1` / `P1` - High (major features, important bugs)
- `2` / `P2` - Medium (default)
- `3` / `P3` - Low (polish, optimization)
- `4` / `P4` - Backlog (future ideas)

### Workflow for AI Agents

1. **Check ready work**: `bd ready` shows unblocked issues
2. **Claim your task**: `bd update <id> --status=in_progress`
3. **Work on it**: Implement, test, document
4. **Discover new work?** Create linked issue with `bd create` + `bd dep add`
5. **Complete**: `bd close <id> --reason "Done"`

### Important Rules

- Use bd for ALL task tracking
- Always use `--json` flag for programmatic use
- Check `bd ready` before asking "what should I work on?"
- Do NOT use `bd edit` (opens interactive editor)
- Do NOT create markdown TODO lists for task tracking
- Do NOT use external issue trackers

<!-- END BEADS INTEGRATION -->

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd export
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
