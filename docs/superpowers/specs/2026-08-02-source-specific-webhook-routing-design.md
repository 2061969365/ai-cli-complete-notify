# 来源专属 Webhook 路由与 2.12.0 版本设计

## 目标

支持 Claude、Codex、Gemini 和 OpenCode 使用各自独立的 Webhook URL，同时保持现有全局 `WEBHOOK_URLS`、通知格式、Hook/Watch 路由和其他通知通道的行为不变。项目发布版本统一更新为 `2.12.0`。

## 配置接口

新增以下可选环境变量，每个变量继续支持使用逗号分隔多个 URL：

```env
CLAUDE_WEBHOOK_URLS=
CODEX_WEBHOOK_URLS=
GEMINI_WEBHOOK_URLS=
OPENCODE_WEBHOOK_URLS=
```

同时允许在 `settings.json` 的来源配置中使用 `webhookUrls`：

```json
{
  "sources": {
    "claude": {
      "webhookUrls": ["https://example.com/claude"]
    }
  }
}
```

本次不在桌面界面增加 URL 输入框。敏感地址仍优先放在 `.env`，来源页面已有的 Webhook 开关继续只控制该来源是否启用 Webhook。

## 路由规则

Webhook URL 按以下优先级解析：

1. 当前来源专属环境变量，例如 `CODEX_WEBHOOK_URLS`。
2. 当前来源的 `sources.<source>.webhookUrls`。
3. 全局环境变量 `WEBHOOK_URLS`，或 `channels.webhook.urlsEnv` 指定的兼容名称。
4. 全局 `channels.webhook.urls`。

命中更高优先级后只使用该层地址，不与低优先级地址合并，防止重复通知和跨来源误发。空字符串或空数组视为未配置并继续回退。

来源名称使用通知引擎中的规范键 `claude`、`codex`、`gemini`、`opencode`，不从用于展示的 `sourceLabel` 推断。没有明确来源的旧入口继续使用全局配置。

## 数据流

1. Hook、Watch、CLI 测试或直接通知调用 `sendNotifications`，并传入规范来源键。
2. 通知引擎继续执行来源启用状态、阈值、通知模式和去重判断。
3. 引擎调用 Webhook 发送器时额外传入规范来源键及来源配置。
4. Webhook 发送器根据上述优先级选择唯一一组 URL。
5. 飞书卡片、钉钉、企微、通用 Webhook、摘要和原文截断逻辑继续复用现有实现。

## 向后兼容

- 只配置 `WEBHOOK_URLS` 的现有用户行为完全不变。
- 现有 `channels.webhook.urls` 和 `urlsEnv` 继续有效。
- `feishu-notify.js` 等没有规范来源键的调用继续使用全局地址。
- 每来源 Webhook 开关仍与全局 Webhook 开关共同生效。
- Telegram、桌面通知、声音、邮件、Gotify、AI 摘要、Hook/Watch 检测和通知去重不做行为修改。

## 版本更新

项目自身版本统一更新为 `2.12.0`：

- `package.json` 与 `package-lock.json` 的根项目版本。
- `src-tauri/Cargo.toml` 与 `Cargo.lock` 中根包版本。
- `src-tauri/tauri.conf.json`。
- 五份 README 顶部版本号、徽章和新增的 `2.12.0` 版本历史。

不得批量替换测试用例、历史设计文档或 `Cargo.lock` 中第三方依赖的 `2.11.0`。

## 文档

- `.env.example` 生成模板和五份 README 补充四个来源专属变量。
- 文档明确来源专属配置覆盖全局配置，但不会与全局地址同时发送。
- 版本历史说明按 CLI 分流 Webhook URL 和全局回退兼容。

## 测试

- Claude 和 Codex 配置不同环境变量时分别发送到对应地址。
- 来源专属环境变量覆盖来源 `settings.json` 和全局配置。
- 来源 `settings.json` 覆盖全局环境变量。
- 来源专属配置缺失时回退到现有全局 `WEBHOOK_URLS`。
- 每个来源变量支持逗号分隔多个 URL。
- 没有来源的旧调用保持全局路由。
- 现有飞书卡片、Webhook 输出、Hook/Watch、Gemini、Claude、Codex 和其他通知通道测试全部通过。
- 前端构建、Node 测试、Rust 检查和版本一致性检查通过。

## 非目标

- 不增加桌面端来源专属 URL 输入界面。
- 不支持按来源分别配置飞书卡片格式、摘要策略或输出长度。
- 不改变不同来源的 Hook/Watch 工作模式。
