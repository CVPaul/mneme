# mneme

面向长期工程项目的 AI Agent 上下文与记忆架构。解决 coding agent 在跨 session 工作中的状态丢失、事实遗忘和重复分析问题。

> 架构设计详见 [ARCHITECTURE.md](ARCHITECTURE.md)

---

## 项目结构

```
.openclaw/facts/         长期事实（架构、约束、红线、陷阱）
.beads/                  任务状态（由 bd 管理）
.opencode/prompt.md      Session 启动 prompt
AGENTS.md                Agent 行为规则
ARCHITECTURE.md          三层记忆架构设计文档
```

## 三层记忆架构

| 层 | 工具 | 职责 | 生命周期 |
|---|---|---|---|
| OpenClaw | `.openclaw/facts/*.md` | 不能忘的事实 | 跨项目 |
| Beads | [bd](https://github.com/steveyegge/beads) | 不能断的进度 | 跨 session |
| OpenCode | 对话上下文 | 当下的执行 | 单 session |

## 快速开始

```bash
git clone <repo-url> && cd mneme
./setup.sh            # 一键安装 git/dolt/bd + 初始化项目
./setup.sh --check    # 仅检查依赖状态
```

安装脚本会自动完成：
1. 安装 git、dolt、bd（按 brew → npm → install script 优先级）
2. 启动 dolt server
3. 初始化 git 和 beads
4. 验证 `.openclaw/`、`.opencode/`、`AGENTS.md` 是否就绪

### Session 工作流

```bash
# 1. 读取长期事实
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

## 核心文件说明

### `.openclaw/facts/`

存放已确认的长期工程事实，agent 不可单方面修改。

| 文件 | 内容 |
|---|---|
| `architecture.md` | 三层架构与数据流 |
| `invariants.md` | 不可违反的约束与红线 |
| `performance_rules.md` | 上下文管理与效率规则 |
| `pitfalls.md` | 已知陷阱与教训 |

### `AGENTS.md`

定义 agent 的 session 启动流程、执行规则、compaction 前动作和禁止行为。包含完整的 bd 命令参考。

### `.opencode/prompt.md`

每个新 session 的启动 prompt，引导 agent 按正确顺序建立上下文。

## 什么信息放哪一层？——一个例子

假设你在做一个 HFT 交易系统项目，某天的工作场景如下：

### 场景：重构订单路由模块

**Session 开始** — agent 读取三层上下文：

```
[OpenClaw]  读取 facts → 得知：
  - 订单路由必须走 FPGA 直连，禁止走内核网络栈（invariants.md）
  - 全链路延迟红线 < 5μs（performance_rules.md）
  - 去年试过 DPDK 方案，因驱动兼容性放弃了（pitfalls.md）

[Beads]     bd ready → 看到：
  - bd-a1b2: "将订单路由从单播改为组播" (open, P1)
  - bd-c3d4: "补充路由模块单元测试" (open, P2, blocked by bd-a1b2)

[OpenCode]  选择 bd-a1b2 作为本 session focus
```

**执行过程中** — 三层各自承担不同的事：

| 发生了什么 | 写入哪一层 | 具体操作 |
|---|---|---|
| 修改了 `router.cpp` 中的组播逻辑 | **OpenCode** | 直接改代码，不需要持久化 |
| 发现组播需要新增一个配置项 | **Beads** | `bd create --title="路由模块增加组播配置项" -p 2 --type=task` |
| 确认组播方案延迟实测 3.2μs，符合红线 | **Beads** | `bd update bd-a1b2 --notes="组播延迟实测 3.2μs，pass"` |
| 发现 FPGA 固件 v2.3+ 才支持组播 | **OpenClaw** | 提议写入 `invariants.md`：「组播路由要求 FPGA 固件 >= v2.3」 |
| 调试时 gdb 断点位置的笔记 | **哪都不写** | 纯临时信息，丢了无所谓 |

**Session 结束（compaction 前）**：

```
[Beads]     bd close bd-a1b2 --reason="组播重构完成，延迟 3.2μs"
[OpenClaw]  等人工确认后，将 FPGA 固件版本要求写入 invariants.md
[OpenCode]  上下文可以安全丢弃
```

### 判断准则

```
这条信息半年后还重要吗？
├── 是 → 它在所有项目中都成立吗？
│       ├── 是 → OpenClaw（长期事实）
│       └── 否 → 还是 OpenClaw，但写在项目特定的 facts 文件里
└── 否 → 它跨 session 还需要吗？
        ├── 是 → Beads（任务进度/阶段性结论）
        └── 否 → OpenCode（当前上下文，丢了没关系）
```

## 当前任务

```bash
bd ready     # 查看可执行任务
bd list      # 查看所有任务
```
