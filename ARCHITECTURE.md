# OpenCode + Beads + OpenClaw

## 面向长期工程项目的上下文与记忆架构方案

---

## 1. 背景与问题定义

在使用 OpenCode 进行**长期、迭代频繁的工程项目**（如 C++ / 系统 / AI Infra / HFT / 大模型工程）时，会不可避免遇到以下问题：

* 项目周期长，单个对话无法容纳全部上下文
* 模型频繁触发 context compaction
* 早期已确认的工程事实 / 决策被遗忘
* agent 重复分析、推翻已验证结论
* 每次新 session 都需要大量 prompt 重建

核心结论：

> **这是“状态与记忆架构问题”，而不是 prompt 或 skill 问题**

---

## 2. 总体解决思路（三层记忆架构）

我们采用 **三层 memory plane**，将不同“稳定度 / 生命周期”的信息彻底解耦。

```
┌─────────────────────────────┐
│ OpenClaw  — 长期事实 (Facts) │  ← 极稳定
├─────────────────────────────┤
│ Beads     — 状态 / 任务     │  ← 中期变化
├─────────────────────────────┤
│ OpenCode  — 当前上下文      │  ← 高频变化
└─────────────────────────────┘
```

### 各层职责

* **OpenClaw**：

  * 存储“不可轻易推翻”的工程事实
  * 架构、约定、红线、长期知识
* **Beads**：

  * 存储任务状态、进度、依赖关系
  * 解决“模型忘记做到哪一步”
* **OpenCode**：

  * 执行具体操作
  * 只关注当前短期目标

---

## 3. OpenClaw：长期事实层（Facts Plane）

### 3.1 适合存放的内容

* 项目整体架构
* 模块职责划分
* 不可违反的 invariants
* 性能 / 内存 / 并发红线
* 已踩过的坑（不要再试）

### 3.2 推荐目录结构

```
.openclaw/
  facts/
    architecture.md
    invariants.md
    performance_rules.md
    pitfalls.md
```

### 3.3 编写原则

* 内容 **稳定 > 完整**
* 只记录「已经确认」的信息
* 禁止记录：

  * 临时想法
  * 未验证假设

### 3.4 OpenCode 启动时的使用方式

在每个新 session 的第一条指令中：

```
你将参与一个长期维护的工程项目。

请首先完整阅读以下 OpenClaw facts：
- .openclaw/facts/architecture.md
- .openclaw/facts/invariants.md
- .openclaw/facts/performance_rules.md
- .openclaw/facts/pitfalls.md

这些内容是长期事实：
- 优先级高于对话历史
- 不要随意推翻
- 若发现矛盾，请提出而不是修改
```

---

## 4. Beads：任务与状态层（State Plane）

### 4.1 Beads 解决的问题

* 跨 session 的任务连续性
* agent 忘记：

  * 已完成什么
  * 当前卡在哪里
  * 下一步是什么

### 4.2 初始化 Beads

在项目根目录执行：

```
bd init
```

推荐生成目录：

```
.beads/
  beads.jsonl
```

### 4.3 任务建模原则

* 一个 beads = 一个**明确、可验证的任务**
* 避免：

  * 巨型 beads
  * 模糊 beads

推荐字段关注：

* title
* status (open / blocked / done)
* depends_on
* notes（关键决策）

### 4.4 OpenCode 使用 Beads 的统一规则

在 AGENTS.md 或系统指令中加入：

```
你必须使用 Beads 来管理长期任务状态：

- 开始工作前：
  - 使用 `bd list` 查看当前未完成任务
- 完成一个阶段性目标：
  - 更新对应 beads 的状态或备注
- 不要依赖对话历史记住进度
```

### 4.5 推荐工作节奏

1. 启动 session
2. 读取 OpenClaw facts
3. 读取 Beads 当前任务
4. 选择一个 beads 作为当前 focus
5. 执行
6. 更新 beads
7. 允许 compaction

---

## 5. OpenCode：短期执行层（Execution Plane）

### 5.1 OpenCode 的定位

* 不承担长期记忆
* 不承担任务管理
* 只负责：

  * 代码分析
  * 文件修改
  * 命令执行

### 5.2 推荐的 session 启动模板

```
这是一个长期工程项目，请严格按以下顺序建立上下文：

1. 阅读 OpenClaw facts（长期事实）
2. 阅读 Beads 当前任务列表
3. 只选择一个 beads 作为本 session 的目标

不要试图从对话历史中恢复状态。
```

---

## 6. Compaction 友好流程（关键）

### 6.1 主动 compaction 前的固定动作

当上下文即将过长时，执行：

```
请执行以下步骤：

1. 将本 session 已确认的结论：
   - 更新到对应 beads 的 notes
2. 若发现新的长期事实：
   - 提议是否加入 OpenClaw
3. 完成后，允许 compaction
```

### 6.2 原则

> **可以丢失推理过程，但不能丢失状态与事实**

---

## 7. 实施清单（Checklist）

* [x] 创建 .openclaw/facts 目录
* [x] 编写 architecture / invariants / performance_rules / pitfalls
* [x] 安装 bd CLI 并初始化 beads（bd init）
* [x] 约定 beads 使用规则（AGENTS.md）
* [x] 设置 OpenCode 启动 prompt（.opencode/prompt.md）

---

## 8. 何时扩展 / 调整

* 若任务规模进一步扩大：

  * 可拆分多个 Beads 子图
* 若 facts 频繁变动：

  * 说明其不应进入 OpenClaw

---

## 9. 一句话总结

> OpenClaw 负责「不能忘的事实」
> Beads 负责「不能断的进度」
> OpenCode 负责「当下的执行」

这三者组合，才能在长期工程中真正对抗 context compaction。
