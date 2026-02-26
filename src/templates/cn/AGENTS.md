# AGENTS.md

mneme 管理项目中 AI 编程 Agent 的行为规则。

每次会话开始时，Agent 必须读取本文件。本文件定义了 Agent 允许做什么、禁止做什么，以及如何处理信息冲突。

## 上下文优先级

当信息冲突时，按以下优先级链解决（从高到低）：

| 优先级 | 来源 | 示例 |
|--------|------|------|
| 1（最高） | **Ledger 事实** (`.ledger/facts/`) | "数据库必须使用 PostgreSQL" |
| 2 | **本文件** (AGENTS.md) | "不得跳过启动流程" |
| 3 | **Beads 任务状态** (`mneme ready`, `mneme list`) | "认证模块正在开发中" |
| 4 | **用户指令**（当前会话中） | "先聚焦认证模块" |
| 5（最低） | **Agent 推理**和对话历史 | "我觉得应该用 SQLite" |

如果 Agent 的推理与 Ledger 事实矛盾，以事实为准。如果 Agent 认为事实已过时，必须向用户提出矛盾，而非默默覆盖。

## Agent 允许做的事

### 读取所有三层数据

- 会话开始时读取 `.ledger/facts/` 中的所有文件
- 运行 `mneme ready` 和 `mneme list` 检查任务状态
- 读取当前任务所需的任何项目文件

### 通过 mneme 管理任务

- 认领任务：`mneme update <id> --status=in_progress`
- 记录进度：`mneme update <id> --notes="完成了什么"`
- 创建子任务：`mneme create --title="..." --description="..." --type=task -p 2`
- 添加依赖：`mneme dep add <子任务> <父任务>`
- 关闭已完成工作：`mneme close <id> --reason="完成了什么"`

### 提议事实（需人工审批）

- 提议新的长期事实：`mneme propose --file=<name> --content="..." --reason="..."`
- 提议必须指明：哪个事实文件、具体内容、为什么它算长期事实
- 提议不会写入事实，直到人工通过 `mneme review` 审批

### 执行代码操作

- 读取、分析、修改代码文件
- 运行命令（构建、测试、代码检查等）
- 创建提交并推送到远程仓库
- 所有代码操作必须服务于当前聚焦的任务

### 压缩前持久化状态

当上下文变长或达到里程碑时：
- 将确认的结论写入 Beads：`mneme update <id> --notes="..."`
- 将发现的事实提议给 Ledger
- 关闭已完成的任务或更新笔记（记录当前进度和阻塞项）
- 然后允许压缩继续

### 干净地结束会话

结束会话前：
1. 为未完成的工作创建任务：`mneme create`
2. 如果修改了代码，运行质量门禁（测试、代码检查、构建）
3. 关闭已完成的任务，更新进行中任务的笔记
4. 推送到远程 —— 这是强制的：
   ```bash
   git pull --rebase
   git push
   git status  # 必须显示 "up to date with origin"
   ```
5. 如果推送失败，解决冲突并重试直到成功

## Agent 禁止做的事

### 不得跳过启动流程

每次会话必须以以下步骤开始：
1. 读取 `.ledger/facts/`（所有文件）
2. 运行 `mneme ready` 和 `mneme list --status=open`
3. 选择一个任务作为会话焦点
4. 开始工作

跳过任何步骤都是禁止的。不要在读取事实和任务之前就开始写代码。

### 不得直接修改 Ledger 事实

- 不要编辑、删除或覆盖 `.ledger/facts/` 中的文件
- 不要将未验证的假设、临时结论或推测性分析写入事实
- 修改事实的唯一途径是 `mneme propose`，然后由人工 `mneme review --approve`

### 不得从对话历史恢复状态

- 不要从会话中早期的消息重建任务进度
- 所有任务状态必须来自 Beads（`mneme list`、`mneme show`）
- 如果一个 bead 的笔记是空的，向用户询问而不是从上下文猜测

### 不得同时处理多个不相关的任务

- 每次会话聚焦一个任务（一个 bead）
- 不要在单次会话中切换不相关的任务
- 如果发现新的紧急任务，创建为 bead，让下次会话处理

### 不得创建模糊的任务

- 每个 bead 必须有清晰、可验证的完成条件
- 反例："提升性能" —— 无法知道什么时候算完成
- 正例："将 /users 接口的 API 响应时间降到 200ms 以下"

### 不得使用 bd edit

- `bd edit` 会打开交互式编辑器（`$EDITOR`），会导致非交互式 Agent 挂起
- 始终使用 `mneme update <id>` 加参数（`--notes`、`--status`、`--title`、`--description`）

### 不得使用 markdown TODO 跟踪任务

- 所有任务跟踪通过 mneme/beads 进行
- 不要在 markdown 文件、代码注释或任何其他格式中创建 TODO 列表
- 不要使用外部问题跟踪器

### 不得在推送前停止

- 工作没有完成，直到 `git push` 成功
- 不要说"准备好了就推送" —— 立即推送
- 如果推送失败，解决冲突并重试

## 会话生命周期

### 1. 启动

```bash
# 读取长期事实
cat .ledger/facts/*.md

# 检查可用工作
mneme ready
mneme list --status=open
mneme list --status=in_progress

# 认领任务
mneme update <id> --status=in_progress
```

### 2. 执行

聚焦任务进行工作。每完成一个里程碑后：

```bash
mneme update <id> --notes="完成了 X，下一步：Y"
```

如果发现子任务：

```bash
mneme create --title="子任务标题" --description="上下文" --type=task -p 2
mneme dep add <新id> <父id>
```

### 3. 压缩前

当上下文变长或完成了一个里程碑时：

1. 将确认的结论写入 Beads 笔记
2. 通过 `mneme propose` 提议新发现的事实
3. 关闭已完成的任务或更新笔记（记录阻塞项）

原则：**推理过程可以丢失，但状态和事实不能丢失。**

### 4. 完成

```bash
# 关闭已完成的工作
mneme close <id> --reason="完成内容摘要"

# 为剩余工作创建任务
mneme create --title="后续工作" --description="..." --type=task -p 2

# 推送所有内容
git pull --rebase && git push
```

## 信息路由

遇到新信息时，立即分类：

```
新信息
  │
  ├─ 6 个月后还会需要吗？
  │    ├─ 是 + 是事实/约束/教训  → 提议给 Ledger
  │    ├─ 是 + 是任务或进度更新 → 写入 Beads
  │    └─ 否 → 下次会话需要吗？
  │              ├─ 是 → 写入 Beads（笔记或新任务）
  │              └─ 否 → 保留在上下文中，不持久化
```

| 信息 | 层级 | 操作 |
|------|------|------|
| "这个项目使用事件溯源" | Ledger | `mneme propose --file=architecture` |
| "调用支付 API 必须带幂等键" | Ledger | `mneme propose --file=invariants` |
| "批量大小超过 1000 会导致 OOM" | Ledger | `mneme propose --file=performance_rules` |
| "配置解析器会静默丢弃未知的键" | Ledger | `mneme propose --file=pitfalls` |
| "需要给 API 添加限流" | Beads | `mneme create --title="添加 API 限流"` |
| "限流：令牌桶已实现，需要写测试" | Beads | `mneme update <id> --notes="..."` |
| "这个函数在第 47 行返回 null" | 上下文 | 不持久化 |

### 提议事实：阈值检查

提议事实前，验证以下四个条件：

- [ ] 信息已被验证（不是假设或猜测）
- [ ] 未来的会话会反复需要它（不是一次性的）
- [ ] 不会很快过时（不是临时状态）
- [ ] `.ledger/facts/` 中不存在等价的事实

四个条件都满足才能提议，然后等待人工审批。

## 任务管理参考

### 问题类型

| 类型 | 用途 |
|------|------|
| `bug` | 已损坏的功能 |
| `feature` | 新功能 |
| `task` | 工作项：测试、文档、重构 |
| `epic` | 包含子任务的大型功能 |
| `chore` | 维护：依赖、工具链 |

### 优先级

| 优先级 | 级别 | 用途 |
|--------|------|------|
| `0` / P0 | 严重 | 安全问题、数据丢失、构建损坏 |
| `1` / P1 | 高 | 主要功能、重要 bug |
| `2` / P2 | 中（默认） | 默认优先级 |
| `3` / P3 | 低 | 优化、打磨 |
| `4` / P4 | 待办 | 未来想法 |

### 命令

```bash
# 查找工作
mneme ready                           # 无阻塞的任务
mneme list --status=open              # 所有未完成的任务
mneme list --status=in_progress       # 进行中的工作
mneme show <id>                       # 任务详情和依赖关系
mneme blocked                         # 被阻塞的任务

# 创建和关联
mneme create --title="..." --description="..." --type=task -p 2
mneme dep add <子任务> <父任务>

# 更新
mneme update <id> --status=in_progress
mneme update <id> --notes="进度笔记"

# 完成
mneme close <id> --reason="完成"
```
