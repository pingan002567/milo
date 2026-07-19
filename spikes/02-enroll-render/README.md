# Spike 02：enroll 渲染链路

**回答的问题**：MiloPack → 成员工作区（config.yaml + `users/milo/agents/<名>/SOUL.md` + skills/）
的渲染产物，能否让 DeerFlowClient 以 `agent_name` 正确加载 persona 与 skills 白名单？

## 步骤（在 Spike 01 跑通后进行）

1. 手写一个最小 MiloPack（manifest.yaml 过 `packages/schemas/milopack.schema.json` 校验 + persona/system.md + 1 个 SKILL.md）
2. 手写渲染逻辑：manifest + 假想 org 条目 + bindings → 工作区目录
3. `DeerFlowClient(config_path=…, agent_name=…, available_skills=[…])` 构造并对话，验证：
   - SOUL.md 是否生效（人设注入 system prompt `<soul>` 段）
   - skills 白名单是否生效
   - 模型档位绑定是否正确路由
4. 结论回填 `milod/pack/`（渲染器正式实现）与 `EmbeddedAdapter.enroll()`
