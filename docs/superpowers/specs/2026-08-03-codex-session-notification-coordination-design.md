# Codex Session 提醒协调改进设计

## 目标

解决 Issue #18 中 Codex VSCode 插件使用一段时间后漏提醒的问题，同时保留明确子任务不重复提醒的行为。修改只作用于 Codex `sessions` Watch 后端，不改变 Claude、Gemini、OpenCode、Hook、Webhook 或通知渠道。

## 问题原因

当前实现按工作目录协调所有 Codex session。任意 session 被标记为 `turnActive` 后，只要没有收到对应的 `task_complete`，同一工作目录下其他 session 的完成提醒就会一直暂存。VSCode 切换会话、任务中断、日志缺少结束事件或 session 被移出最新文件列表时，都可能留下无法自动清理的活动状态。

协调器还只保留一个待发送完成结果，后完成的 session 可能覆盖先完成的 session。按 `cwd` 分组只能证明多个会话位于同一项目，不能证明它们属于同一个父子任务。

## 方案比较

### 方案一：按明确父子元数据过滤，顶层 session 独立提醒

使用 `thread_source: subagent`、`source.subagent.thread_spawn` 和 `parent_thread_id` 等现有元数据识别子任务。明确的 subagent 完成时不提醒，普通顶层 session 收到完成信号后立即独立提醒。

这是推荐方案。它消除跨 session 活动状态依赖，能够从根本上避免一个异常 session 阻塞其他正常 session。旧日志缺少父子元数据时按普通 session 处理，可能比旧实现多提醒，但不会静默漏提醒。

### 方案二：保留按工作目录协调并增加超时

为 `turnActive` 增加过期时间，并在 session 移除时刷新待发送提醒。该方案改动较小，但独立的同项目长任务仍会延迟其他会话的提醒，超时时间也无法同时适配短任务和长任务。

### 方案三：扩大监听数量并保留现有协调器

提高 `CODEX_FOLLOW_TOP_N` 可以降低 session 被移出监听列表的概率，但不能处理任务中断或缺少 `task_complete`，只能降低出现频率，不能消除根因。

## 完成提醒数据流

1. 每个 JSONL session 独立维护本轮状态和去重字段。
2. 从 session 文件头和实时事件中读取 session 元数据。
3. 明确识别为 subagent 的 session 跳过确认提醒和完成提醒。
4. 普通顶层 session 收到 `task_complete` 或现有完成 fallback 后，直接调用通知引擎。
5. 完成结果只更新当前 session 的 `lastNotifiedTurnId`、`lastNotifiedAssistantAt` 等状态，不读取其他 session 的活动状态。
6. session 被移出最新文件列表或停止监听时，只清理自身定时器，不影响其他 session。

## 确认提醒

确认提醒只由明确的 Codex `request_user_input` 事件触发。普通 `task_complete` 文本即使以“是否继续”“需要我继续吗”等问题结尾，也按完成提醒处理，避免已经完成的回复被播报为确认提醒。

当 `request_user_input` 尚未解决时：

- 已启用确认提醒：发送或保留本轮确认提醒，并跳过完成提醒。
- 未启用确认提醒：不发送确认提醒，但仍跳过完成提醒，因为任务正在等待用户输入。
- 收到对应工具输出后：清除等待状态，后续真正完成时正常发送完成提醒。

## 兼容性

- 现有明确 subagent 元数据过滤继续生效。
- 顶层 Codex CLI、Codex Desktop 和 VSCode session 相互独立，不再按工作目录互相等待。
- 缺少 subagent 元数据的旧格式不再使用工作目录推断父子关系，优先保证完成提醒可达。
- SQLite 后端保持现状。
- `CODEX_FOLLOW_TOP_N` 和 seed catchup 行为保持现状。
- 不修改全局版本号和版本历史。

## 测试

- 同一工作目录中一个 session 长期活动时，另一个顶层 session 完成仍立即提醒。
- 两个同一工作目录的顶层 session 分别完成时，各自发送一次提醒。
- 明确标记为 subagent 的 session 完成时不提醒，父 session 完成时提醒一次。
- session 缺少父子元数据时不被其他 session 阻塞。
- 完成文本以普通追问结尾时发送完成提醒，不发送确认提醒。
- 明确 `request_user_input` 仍发送确认提醒并抑制等待阶段的完成提醒。
- 现有 Codex TUI failure、SQLite、Claude、Gemini、Hook 和通知引擎测试保持通过。

## 非目标

- 不重新设计 Codex SQLite 事件协议。
- 不改变桌面界面或增加新的用户配置项。
- 不尝试从文件名、时间顺序或工作目录猜测缺少元数据的父子关系。
