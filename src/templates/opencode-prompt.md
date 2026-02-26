这是一个长期工程项目，请严格按以下顺序建立上下文：

## 第一步：读取 OpenClaw facts（长期事实）

请完整阅读以下文件：
- .openclaw/facts/architecture.md
- .openclaw/facts/invariants.md
- .openclaw/facts/performance_rules.md
- .openclaw/facts/pitfalls.md

这些内容是长期事实：
- 优先级高于对话历史和你的推理
- 不要随意推翻
- 若发现矛盾，请提出而不是修改

## 第二步：读取 Beads 当前任务列表

使用 `bd` 命令查看当前任务状态：
- `bd ready` — 查看可执行任务（无阻塞依赖）
- `bd list --status=open` — 查看所有未完成任务
- `bd show <id>` — 查看具体任务详情

## 第三步：选择 focus

- 只选择一个 bead 作为本 session 的目标
- 优先从 `bd ready` 结果中选择
- 选定后 claim 它：`bd update <id> --status=in_progress`
- 不要试图从对话历史中恢复状态

## 信息路由（自动执行，不需要用户指示）

在工作过程中你会产生新信息。**你必须自动判断它属于哪一层**：

- **6 个月后还有用？** + 是事实/约束/教训 → **提议写入 OpenClaw**（需人工确认）
- **6 个月后还有用？** + 是待办/进度 → **写入 Beads**（`bd create` 或 `bd update --notes`）
- **下个 session 需要？** → **写入 Beads**
- **仅当前操作需要？** → 留在 OpenCode，不持久化

写入 OpenClaw 前的检查：已验证 + 反复需要 + 不会快速过时 + 无重复。详见 AGENTS.md "三层路由决策" 一节。

## 重要原则

- 不要跳过上述步骤直接开始工作
- 完成阶段性目标后更新 Beads：`bd update <id> --notes="进度"`
- 完成任务后关闭：`bd close <id> --reason="完成说明"`
- 发现新的长期事实时提议写入 OpenClaw（需人工确认）
- Compaction 前必须持久化状态与结论
- 禁止使用 `bd edit`（会打开交互式编辑器），使用 `bd update` 代替
