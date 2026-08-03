# Codex Goal 模式完成提醒设计

## 目标

Codex `/goal` 模式执行期间会产生中间回复和轮次完成信号。当前 Watch 会把这些信号当作普通任务完成并发送提醒。本次在不改变普通 Codex、其他 CLI、通知渠道和多会话隔离行为的前提下，只在 Goal 真正停止后发送一次提醒，并将项目版本更新为 `2.13.0`。

## 状态来源

JSONL 会话日志中的 `event_msg:thread_goal_updated` 包含 Codex 原生 Goal 状态：

- `active`：目标仍在自动执行。
- `complete`：目标已完成。
- `blocked`、`usage_limited`、`budget_limited`：目标已停止继续执行。
- `paused`：目标被暂停。

Watch 按会话保存最新 Goal 状态，不能按工作目录共享，避免一个 Goal 影响其他 Codex 会话。

## 提醒规则

1. Goal 为 `active` 时，跳过该会话的 `task_complete` 和“助手消息 + 静默窗口”回退提醒。
2. Goal 进入 `complete`、`blocked`、`usage_limited` 或 `budget_limited` 后，允许随后的最终完成信号发送一次提醒。
3. Goal 为 `paused` 时不发送完成提醒；用户恢复目标后继续跟随新的状态事件。
4. 没有 Goal 状态事件时沿用现有逻辑，兼容旧版 Codex 和普通任务。
5. Watch 在会话中途启动时读取种子日志中的最新 Goal 状态，但不重放历史通知。

## 后端兼容

- JSONL 后端直接消费 `thread_goal_updated`。
- SQLite 后端识别对应的 `thread_goal_updated` SSE 事件；如果事件不存在，则保持当前行为，不直接依赖外部数据库文件。

## 测试

- `active` Goal 的中间 `task_complete` 不提醒。
- `active` Goal 的静默回退不提醒。
- `complete` Goal 的最终 `task_complete` 只提醒一次。
- `paused` Goal 不发送完成提醒。
- 普通 Codex 任务、多会话和确认提醒回归测试保持通过。
- Node 测试、前端构建、Rust 检查和版本一致性检查通过。

## 版本更新

项目自身版本统一更新为 `2.13.0`，包括 Node、Tauri、Cargo 和五份 README 的版本标识及版本历史；不修改历史测试数据中的示例版本号或第三方依赖版本。
