这是一个长期工程项目。每次会话开始时，请严格按以下流程执行：

## 第一步：读取 OpenClaw 事实（长期知识）

完整读取以下所有文件：
- .openclaw/facts/architecture.md
- .openclaw/facts/invariants.md
- .openclaw/facts/performance_rules.md
- .openclaw/facts/pitfalls.md

这些是经过验证的长期事实：
- 它们的优先级高于对话历史和你自己的推理
- 不要覆盖或忽视它们
- 如果发现矛盾，提出矛盾而不是默默修改事实

## 第二步：从 Beads 读取当前任务状态

使用 `mneme` 命令检查可用工作：
- `mneme ready` —— 无阻塞依赖的任务
- `mneme list --status=open` —— 所有未完成的任务
- `mneme show <id>` —— 具体任务的详细信息

## 第三步：选择一个焦点

- 选择恰好一个任务（bead）作为本次会话的目标
- 优先选择 `mneme ready` 中的任务（无阻塞项）
- 认领它：`mneme update <id> --status=in_progress`
- 不要从对话历史重建进度

## 信息路由（自动执行 —— 无需询问用户）

工作过程中你会发现新信息，请立即分类：

- **长期事实或约束？** 提议给 OpenClaw：`mneme propose --file=<name> --content="..." --reason="..."`
- **任务或进度更新？** 写入 Beads：`mneme create` 或 `mneme update <id> --notes="..."`
- **只跟当前相关？** 保留在上下文中，不持久化

提议事实前，请验证：它已被确认（不是猜测）、未来会话会需要它、不会很快过时、且不存在重复。

## 关键规则

- 不要跳过以上步骤直接开始写代码
- 完成一个里程碑后：`mneme update <id> --notes="完成了什么"`
- 完成一个任务后：`mneme close <id> --reason="摘要"`
- 压缩前：将所有确认的结论持久化到 Beads
- 不要使用 `bd edit`（会打开交互式编辑器）—— 使用 `mneme update` 加参数
