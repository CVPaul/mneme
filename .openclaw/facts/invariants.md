# Invariants — 不可违反的约束与红线

## 三层分离原则

1. **事实与状态不可混放**
   - OpenClaw 只存放已确认的长期事实，禁止存放任务进度或临时结论
   - Beads 只存放任务状态与进度，禁止存放架构决策或长期事实
   - 两者之间的信息流转必须显式操作，不可隐式合并

2. **OpenClaw 的不可变性**
   - OpenClaw facts 一旦写入，不可被 agent 单方面修改或删除
   - 若 agent 发现 facts 与当前情况矛盾，必须**提出质疑**而非直接修改
   - 修改 OpenClaw 内容需要人工确认

3. **Beads 的原子性**
   - 每个 bead 必须是一个明确、可验证的任务
   - 禁止创建模糊的、无法判断完成与否的 bead
   - 禁止创建过大的 bead（应拆分为子任务或使用 epic）

## 信息写入规则

4. **只记录已确认的信息**
   - OpenClaw 禁止记录：临时想法、未验证假设、推测性结论
   - 信息必须经过验证或由人工确认后才能写入 facts

5. **优先级链**
   - OpenClaw facts 的优先级 **高于** 对话历史
   - OpenClaw facts 的优先级 **高于** agent 的推理结论
   - 当两者矛盾时，以 OpenClaw 为准，除非有明确证据推翻

## Session 行为规则

6. **每个 session 必须从三层读取开始**
   - 先读 OpenClaw facts → 再通过 `bd ready` / `bd list` 读 Beads → 再开始执行
   - 禁止跳过读取步骤直接开始工作

7. **单一焦点原则**
   - 每个 session 只选择一个 bead 作为 focus
   - 禁止在一个 session 中同时推进多个不相关的 bead

8. **Compaction 前必须持久化**
   - 在 context compaction 发生前，必须将已确认的结论写入 Beads（`bd update --notes`）
   - 若发现新的长期事实，必须提议写入 OpenClaw
   - 原则：**可以丢失推理过程，但不能丢失状态与事实**

## Beads 使用规则

9. **通过 bd CLI 管理任务**
   - 使用 `bd create` 创建任务（必须指定 `--title`, `--description`, `--type`, `-p`）
   - 使用 `bd update` 更新任务（禁止使用 `bd edit`，它会打开交互式编辑器）
   - 使用 `bd close` 关闭完成的任务
   - 使用 `bd dep add` 管理依赖关系

10. **优先级使用数字 0-4**
    - 0 = Critical, 1 = High, 2 = Medium (默认), 3 = Low, 4 = Backlog
    - 不要使用 "high" / "medium" / "low" 等文字描述

## 格式与命名规则

11. **OpenClaw facts 使用 Markdown 格式**
    - 每个文件有明确的主题范围
    - 使用编号便于引用

12. **Beads 使用 bd CLI 管理**
    - 数据存储在 Dolt 数据库中（`.beads/` 目录）
    - 可通过 `bd export` 导出 JSONL 格式快照
    - ID 为 hash-based 格式（如 `bd-a1b2`），不可手动编辑
