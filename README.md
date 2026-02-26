# mneme

面向长期工程项目的 AI Agent 上下文与记忆架构。解决 coding agent 在跨 session 工作中的状态丢失、事实遗忘和重复分析问题。

> 架构设计详见 [ARCHITECTURE.md](ARCHITECTURE.md)

---

## 快速开始

```bash
# 安装
npm install -g @xqli/mneme

# 在任意项目目录下初始化
mkdir my-project && cd my-project
mneme init

# 开始使用
mneme
```

`mneme init` 会自动完成：
1. 安装依赖（git、dolt、bd）
2. 初始化 git 仓库
3. 创建三层架构文件（`.openclaw/`、`.opencode/`、`AGENTS.md`、`.gitignore`）
4. 启动 dolt server + 初始化 beads

### CLI 命令

```bash
mneme              # 启动 opencode TUI（等同于 mneme start）
mneme init         # 初始化当前目录
mneme doctor       # 检查依赖和项目健康状态
mneme version      # 打印版本号

# opencode 命令透传
mneme run "fix the bug"   # 非交互模式运行
mneme web                 # 启动 Web 界面
mneme serve               # 启动 headless server
```

---

## 三层记忆架构

| 层 | 工具 | 职责 | 生命周期 |
|---|---|---|---|
| OpenClaw | `.openclaw/facts/*.md` | 不能忘的事实 | 跨项目 |
| Beads | [bd](https://github.com/steveyegge/beads) | 不能断的进度 | 跨 session |
| OpenCode | 对话上下文 | 当下的执行 | 单 session |

## 项目结构

`mneme init` 创建的文件：

```
.openclaw/facts/         长期事实（架构、约束、红线、陷阱）
.beads/                  任务状态（由 bd 管理）
.opencode/prompt.md      Session 启动 prompt
AGENTS.md                Agent 行为规则
.gitignore               排除 dolt 数据等运行时文件
```

## Session 工作流

```bash
# 1. 读取长期事实（agent 自动执行）
cat .openclaw/facts/*.md

# 2. 查看可执行任务
bd ready

# 3. Claim 一个任务
bd update <id> --status=in_progress

# 4. 工作、记录进度
bd update <id> --notes="完成了 X，发现了 Y"

# 5. 完成
bd close <id> --reason="Done"
```

## 什么信息放哪一层？

```
新信息产生
  │
  ├─ 6 个月后还有用？
  │    ├─ YES + 事实/约束/教训 → OpenClaw（提议写入，需人工确认）
  │    ├─ YES + 待办/进度     → Beads（直接写入）
  │    └─ NO → 下个 session 需要？
  │         ├─ YES → Beads
  │         └─ NO  → 留在 OpenCode，不持久化
```

| 信息示例 | 写入层 |
|---|---|
| "数据库必须用 PostgreSQL" | OpenClaw `facts/architecture.md` |
| "禁止在生产环境直接改数据" | OpenClaw `facts/invariants.md` |
| "需要实现用户认证模块" | Beads `bd create` |
| "函数第 3 个参数是 timeout" | 不写，留在 OpenCode |

## 核心文件说明

### `.openclaw/facts/`

存放已确认的长期工程事实，agent 不可单方面修改。

| 文件 | 内容 |
|---|---|
| `architecture.md` | 架构决策 |
| `invariants.md` | 不可违反的约束与红线 |
| `performance_rules.md` | 性能规则 |
| `pitfalls.md` | 已知陷阱与教训 |

### `AGENTS.md`

定义 agent 的 session 启动流程、执行规则、三层路由决策树、compaction 前动作和禁止行为。

### `.opencode/prompt.md`

每个新 session 的启动 prompt，引导 agent 按正确顺序建立上下文。
