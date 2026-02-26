# Performance Rules — 性能与效率规则

## Context 管理效率

1. **最小化 session 启动开销**
   - OpenClaw facts 文件应保持精简，总量控制在合理范围内
   - 每个 facts 文件建议不超过 200 行
   - 全部 facts 文件总量建议不超过 800 行
   - 目标：session 启动时读取全部 facts 的 token 开销可控

2. **Beads 数据应定期清理**
   - 已完成（done）的 bead 可在确认无参考价值后归档
   - 活跃的 bead 数量建议不超过 20 个
   - 过多的 bead 会增加每次 session 启动的读取开销

3. **信息密度优先于详尽度**
   - facts 文件中优先使用简洁、结构化的表述
   - 避免冗长的解释性文字
   - 一条 fact 应该在 1-3 行内表达清楚

## Compaction 效率

4. **主动管理 compaction 节奏**
   - 不要等到 context 溢出才处理
   - 在完成一个阶段性目标后，主动执行持久化
   - 持久化完成后，允许 compaction 释放上下文空间

5. **结论提取应结构化**
   - 写入 Beads notes 时使用简洁的 bullet points
   - 避免复制大段代码或日志到 notes 中
   - 只记录关键决策和结论，不记录推导过程

## 层间通信效率

6. **减少不必要的层间读写**
   - 不要每次操作都刷新 Beads（批量更新优于频繁更新）
   - OpenClaw 的读取只在 session 启动时进行一次
   - 只在有实质性进展时才更新 Beads 状态

7. **避免信息重复存储**
   - 同一条信息不应同时出现在 OpenClaw 和 Beads 中
   - OpenClaw 存"是什么"，Beads 存"做什么/做到哪"
   - 若在 Beads notes 中发现反复出现的结论，应考虑提升为 OpenClaw fact
