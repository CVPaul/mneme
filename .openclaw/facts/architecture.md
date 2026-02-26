# Architecture — 三层记忆架构

## 总体架构

mneme 采用三层记忆平面（Memory Plane）架构，将不同稳定度和生命周期的信息彻底解耦：

```
┌─────────────────────────────────────────┐
│  Layer 1: OpenClaw  — 长期事实 (Facts)   │  ← 极稳定，跨项目生命周期
├─────────────────────────────────────────┤
│  Layer 2: Beads     — 任务状态 (State)   │  ← 中期变化，跨 session
├─────────────────────────────────────────┤
│  Layer 3: OpenCode  — 当前上下文 (Exec)  │  ← 高频变化，单 session 内
└─────────────────────────────────────────┘
```

## 各层职责边界

### OpenClaw（长期事实层）

- **存储位置**: `.openclaw/facts/` 目录
- **内容类型**: 架构决策、不可变约束、性能红线、已知陷阱
- **写入频率**: 极低，仅在确认新的长期事实时写入
- **读取频率**: 每个 session 启动时必读
- **稳定性要求**: 内容一旦写入，不可轻易修改或删除；若需修改，必须显式提出并说明原因

### Beads（任务状态层）

- **工具**: [bd (beads)](https://github.com/steveyegge/beads) — 分布式 Git-backed 图形 issue tracker
- **后端**: Dolt（版本化 SQL 数据库），支持 cell-level merge、原生分支
- **存储位置**: `.beads/` 目录（由 `bd init` 自动创建和管理）
- **内容类型**: 任务定义、状态、优先级（P0-P4）、依赖关系、备注
- **状态流转**: open → in_progress → closed（也可 blocked、deferred）
- **ID 格式**: Hash-based（如 `bd-a1b2`），防止合并冲突
- **写入频率**: 中等，每完成一个阶段性目标时更新
- **读取频率**: 每个 session 启动时通过 `bd ready` / `bd list` 读取

### OpenCode（短期执行层）

- **无持久化存储**: 仅存在于当前 session 的对话上下文中
- **内容类型**: 代码分析、文件修改、命令执行等即时操作
- **生命周期**: 随 session 结束或 context compaction 而消失
- **核心原则**: 不承担记忆，不承担任务管理

## 数据流

```
Session 启动:
  OpenCode ──读取──→ OpenClaw facts (建立长期上下文)
  OpenCode ── bd ready / bd list ──→ Beads (恢复任务进度)
  OpenCode ── bd update --status=in_progress ──→ claim 一个 bead 作为当前 focus

执行过程:
  OpenCode ──执行──→ 代码操作
  OpenCode ── bd update --notes ──→ Beads (记录进度)
  OpenCode ── bd create ──→ Beads (创建新发现的子任务)

Compaction 前:
  OpenCode ── bd update --notes ──→ Beads (持久化已确认结论)
  OpenCode ──提议──→ 新的长期事实 → OpenClaw (需人工确认)
```

## 目录结构

```
mneme/
├── README.md                    # 项目概览与快速开始
├── ARCHITECTURE.md              # 三层记忆架构设计文档
├── AGENTS.md                    # OpenCode agent 行为规则
├── .openclaw/
│   └── facts/
│       ├── architecture.md      # 本文件 - 项目架构
│       ├── invariants.md        # 不可违反的约束与红线
│       ├── performance_rules.md # 性能相关规则
│       └── pitfalls.md          # 已知陷阱与教训
├── .beads/                      # Beads 数据（由 bd init 管理）
│   ├── config.yaml              # Beads 配置
│   └── dolt/                    # Dolt 数据库目录
└── .opencode/
    └── prompt.md                # OpenCode session 启动 prompt
```

## 技术依赖

- **bd** (beads CLI): `npm install -g @beads/bd` 或 `brew install beads`
- **Dolt**: bd 的后端数据库，由 bd 自动管理
- **Git**: 版本控制与协作基础
