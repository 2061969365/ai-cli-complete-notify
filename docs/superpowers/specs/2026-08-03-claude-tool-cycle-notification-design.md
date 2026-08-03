# Claude 工具调用周期完成提醒设计

## 目标

Claude transcript 会把工具结果记录为顶层 `type: "user"`。当前 Watch 将其误认为真人新输入，同时 Assistant 的 `tool_use` 记录仍会启动静默完成计时，导致 Claude 尚在工作时发送空内容或过期内容提醒。本次修复纳入 `2.13.0`，只调整 Claude Watch，不改变 Claude Hook、SDK 会话过滤或其他 CLI。

## 记录识别

- 真人输入：`type: "user"`，且内容不包含 `tool_result`。
- 工具结果：`type: "user"`，内容数组包含 `tool_result`。
- 工具调用：`type: "assistant"`，内容数组包含 `tool_use`。
- 最终候选：Assistant 记录不包含 `tool_use`，并且能够提取非空文本。

## 状态规则

1. 只有真人输入开始新轮次，更新用户原文并重置该轮通知状态，同时取消上一轮遗留计时。
2. Assistant 包含 `tool_use` 时保存上下文但不启动完成计时，并取消此前同轮 Assistant 文本启动的计时。
3. 收到 `tool_result` 时不更新用户原文、不重置轮次，只取消完成计时并保持工具活动状态。
4. 只有不含 `tool_use` 的非空 Assistant 文本才能启动静默完成计时。
5. 计时触发前再次确认当前 Assistant 不是工具调用且输出非空，避免空内容提醒。
6. 明确的确认提醒、失败提醒和 `onlyInteractive` SDK 过滤保持现有行为。

## 测试

- `user -> assistant text -> assistant/tool_use -> user/tool_result` 等待超过 quiet 时间不提醒。
- 多次 `tool_use / tool_result` 交替期间不提醒。
- 最终 Assistant 文本到达后只提醒一次，并保留最初真人输入作为摘要上下文。
- 普通 Claude Watch、Claude Hook、SDK 过滤、Codex、Gemini 和 OpenCode 回归测试保持通过。

## 文档

五份 README 的 `2.13.0` 版本历史增加 Claude 工具调用周期误提醒修复说明，不改动已统一的版本号。
