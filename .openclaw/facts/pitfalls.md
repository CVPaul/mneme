# Pitfalls — 已知陷阱与教训

## Agent 行为陷阱

1. **重复分析已确认结论**
   - 现象：agent 在新 session 中重新分析已经确认过的架构决策，甚至推翻之前的结论
   - 原因：未读取 OpenClaw facts，或读取后未给予足够优先级
   - 对策：session 启动时强制读取 facts，并在 prompt 中明确 facts 优先级高于推理

2. **从对话历史恢复状态**
   - 现象：agent 试图从前几轮对话中拼凑当前任务进度
   - 原因：未使用 Beads，依赖 context window 中的历史信息
   - 对策：禁止从对话历史恢复状态，必须从 Beads 读取

3. **一个 session 试图做太多事**
   - 现象：agent 在一个 session 中同时推进多个任务，导致 context 快速膨胀
   - 原因：未遵循单一焦点原则
   - 对策：每个 session 只选择一个 bead 作为 focus

## 信息管理陷阱

4. **将临时结论写入 OpenClaw**
   - 现象：未经验证的假设被写入 facts，后续 session 将其当作确认事实
   - 原因：混淆了"推测"和"事实"的边界
   - 对策：OpenClaw 只接受已验证的信息，写入前需人工确认

5. **Beads 任务粒度失控**
   - 现象：单个 bead 过大（如"完成整个模块"），导致状态无法准确跟踪
   - 原因：任务拆分不够细
   - 对策：一个 bead 应该是一个可在 1-3 个 session 内完成的目标

6. **忘记在 compaction 前持久化**
   - 现象：关键结论在 context compaction 后丢失，下个 session 需要重新推导
   - 原因：未执行 compaction 前的固定动作
   - 对策：在感知到 context 接近上限时，主动执行持久化流程

## 架构演进陷阱

7. **facts 文件无限膨胀**
   - 现象：随着项目推进，facts 文件越来越长，读取开销过大
   - 原因：只增不删，且缺乏定期审查
   - 对策：定期审查 facts 文件，过时的内容标记删除或归档

8. **Beads 与 facts 信息重复**
   - 现象：相同的信息同时存在于 Beads notes 和 OpenClaw facts 中
   - 原因：未区分"做什么"和"是什么"
   - 对策：明确分工 — OpenClaw 存事实，Beads 存进度
