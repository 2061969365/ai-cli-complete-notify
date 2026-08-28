const fs = require('fs');
const path = require('path');
const os = require('os');

const HOOK_MARKER = 'ai-cli-complete-notify';
const HOOK_MARKER_ALT = 'ai-reminder';
const HOOK_FLAG = '--from-hook';
const OPENCODE_PLUGIN_FILE = 'ai-cli-complete-notify.js';
const OPENCODE_PLUGIN_MARKER = `${HOOK_MARKER}:opencode-plugin`;

function getExePath() {
  try {
    const isPackaged = typeof process.pkg !== 'undefined'
      || (process.execPath && !process.execPath.includes('node') && !process.execPath.includes('electron'));
    if (isPackaged) return process.execPath;
  } catch (_error) {
    // ignore
  }

  const candidate = path.resolve(path.join(__dirname, '..', 'ai-reminder.js'));
  if (fs.existsSync(candidate)) return candidate;

  return process.argv[1] || process.execPath;
}

function shellQuote(value) {
  if (process.platform === 'win32') {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildNotifyCommand(exePath, source) {
  const quoted = shellQuote(exePath);
  const needsNode = exePath.endsWith('.js');
  const prefix = needsNode ? `node ${quoted}` : quoted;
  return `${prefix} notify --source ${source} --from-hook --force`;
}

function buildNotifyArgv(exePath, source) {
  const prefix = exePath.endsWith('.js') ? ['node', exePath] : [exePath];
  return [...prefix, 'notify', '--source', source, '--from-hook', '--force'];
}

function getClaudeSettingsPath() {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function getGeminiSettingsPath() {
  return path.join(os.homedir(), '.gemini', 'settings.json');
}

function getOpenCodeConfigDir() {
  const override = String(process.env.OPENCODE_CONFIG_DIR || '').trim();
  if (override) return path.resolve(override);
  return path.join(os.homedir(), '.config', 'opencode');
}

function getOpenCodePluginPath() {
  return path.join(getOpenCodeConfigDir(), 'plugins', OPENCODE_PLUGIN_FILE);
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (_error) {
    return {};
  }
}

function writeJsonFile(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function isOurHookCommand(command) {
  return typeof command === 'string'
    && command.includes(HOOK_FLAG)
    && (command.includes(HOOK_MARKER) || command.includes(HOOK_MARKER_ALT));
}

function normalizeHookCommand(hook) {
  if (!hook || typeof hook !== 'object') return null;
  if (typeof hook.command !== 'string') return null;
  return {
    type: hook.type || 'command',
    command: hook.command
  };
}

function convertLegacyClaudeHooks(legacyHooks) {
  const grouped = {};
  for (const hook of legacyHooks) {
    if (!hook || typeof hook !== 'object' || typeof hook.event !== 'string') continue;
    const normalized = normalizeHookCommand(hook);
    if (!normalized) continue;
    if (!Array.isArray(grouped[hook.event])) {
      grouped[hook.event] = [];
    }
    grouped[hook.event].push({ hooks: [normalized] });
  }
  return grouped;
}

function ensureClaudeHooksObject(settings) {
  if (!settings.hooks || typeof settings.hooks !== 'object') {
    settings.hooks = {};
    return settings.hooks;
  }

  if (Array.isArray(settings.hooks)) {
    settings.hooks = convertLegacyClaudeHooks(settings.hooks);
  }

  return settings.hooks;
}

function extractHookCommands(block) {
  if (!block || typeof block !== 'object' || !Array.isArray(block.hooks)) return [];
  return block.hooks.filter((hook) => hook && typeof hook.command === 'string');
}

function isOurClaudeHook(hook) {
  if (!hook || typeof hook !== 'object') return false;
  if (typeof hook.command !== 'string') return false;
  return isOurHookCommand(hook.command);
}

function buildClaudeHooks(exePath) {
  const cmd = buildNotifyCommand(exePath, 'claude');
  return {
    Stop: [
      {
        hooks: [
          { type: 'command', command: cmd }
        ]
      }
    ]
  };
}

function installClaudeHook(exePath) {
  const settingsPath = getClaudeSettingsPath();
  const settings = readJsonFile(settingsPath);
  const hooks = ensureClaudeHooksObject(settings);
  const desiredHooks = buildClaudeHooks(exePath);

  for (const [eventName, blocks] of Object.entries(hooks)) {
    if (!Array.isArray(blocks)) continue;
    const nextBlocks = blocks
      .map((block) => {
        if (!block || typeof block !== 'object' || !Array.isArray(block.hooks)) return block;
        const remainingHooks = block.hooks.filter((hook) => !isOurHookCommand(hook && hook.command));
        if (remainingHooks.length === 0) return null;
        return { ...block, hooks: remainingHooks };
      })
      .filter(Boolean);

    if (nextBlocks.length > 0) {
      hooks[eventName] = nextBlocks;
    } else {
      delete hooks[eventName];
    }
  }

  for (const eventName of Object.keys(desiredHooks)) {
    const existingBlocks = Array.isArray(hooks[eventName]) ? hooks[eventName] : [];
    hooks[eventName] = [...existingBlocks, ...desiredHooks[eventName]];
  }

  writeJsonFile(settingsPath, settings);
  return { ok: true, settingsPath };
}

function uninstallClaudeHook() {
  const settingsPath = getClaudeSettingsPath();
  const settings = readJsonFile(settingsPath);

  if (Array.isArray(settings.hooks)) {
    settings.hooks = settings.hooks.filter((hook) => !isOurClaudeHook(hook));
    if (settings.hooks.length === 0) {
      delete settings.hooks;
    }
    writeJsonFile(settingsPath, settings);
    return { ok: true, settingsPath };
  }

  if (!settings.hooks || typeof settings.hooks !== 'object') return { ok: true, settingsPath };

  for (const [eventName, blocks] of Object.entries(settings.hooks)) {
    if (!Array.isArray(blocks)) continue;
    const nextBlocks = blocks
      .map((block) => {
        if (!block || typeof block !== 'object' || !Array.isArray(block.hooks)) return block;
        const remainingHooks = block.hooks.filter((hook) => !isOurHookCommand(hook && hook.command));
        if (remainingHooks.length === 0) return null;
        return { ...block, hooks: remainingHooks };
      })
      .filter(Boolean);

    if (nextBlocks.length > 0) {
      settings.hooks[eventName] = nextBlocks;
    } else {
      delete settings.hooks[eventName];
    }
  }

  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  writeJsonFile(settingsPath, settings);
  return { ok: true, settingsPath };
}

function getClaudeHookStatus() {
  const settingsPath = getClaudeSettingsPath();
  const settings = readJsonFile(settingsPath);
  let installed = false;

  if (Array.isArray(settings.hooks)) {
    installed = settings.hooks.some((hook) => isOurClaudeHook(hook));
  } else if (settings.hooks && typeof settings.hooks === 'object') {
    installed = Object.values(settings.hooks).some((blocks) =>
      Array.isArray(blocks) && blocks.some((block) =>
        extractHookCommands(block).some((hook) => isOurHookCommand(hook.command))
      )
    );
  }

  return { installed, settingsPath };
}

function isOurGeminiHook(hook) {
  if (!hook || typeof hook !== 'object') return false;
  if (typeof hook.command !== 'string') return false;
  return isOurHookCommand(hook.command);
}

function buildGeminiHooks(exePath) {
  const cmd = buildNotifyCommand(exePath, 'gemini');
  return [
    {
      hooks: [
        { type: 'command', command: cmd }
      ]
    }
  ];
}

function removeOurGeminiHooks(definitions) {
  return definitions
    .map((definition) => {
      if (isOurGeminiHook(definition)) return null;
      if (!definition || typeof definition !== 'object' || !Array.isArray(definition.hooks)) {
        return definition;
      }

      const hasOurHook = definition.hooks.some((hook) => isOurGeminiHook(hook));
      if (!hasOurHook) return definition;

      const remainingHooks = definition.hooks.filter((hook) => !isOurGeminiHook(hook));
      if (remainingHooks.length === 0) return null;
      return { ...definition, hooks: remainingHooks };
    })
    .filter(Boolean);
}

function installGeminiHook(exePath) {
  const settingsPath = getGeminiSettingsPath();
  const settings = readJsonFile(settingsPath);

  if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
    settings.hooks = {};
  }

  if (!Array.isArray(settings.hooks.AfterAgent)) {
    settings.hooks.AfterAgent = [];
  }

  const existingHooks = removeOurGeminiHooks(settings.hooks.AfterAgent);
  settings.hooks.AfterAgent = [...existingHooks, ...buildGeminiHooks(exePath)];

  writeJsonFile(settingsPath, settings);
  return { ok: true, settingsPath };
}

function uninstallGeminiHook() {
  const settingsPath = getGeminiSettingsPath();
  const settings = readJsonFile(settingsPath);

  if (!settings.hooks || typeof settings.hooks !== 'object') return { ok: true, settingsPath };

  if (Array.isArray(settings.hooks.AfterAgent)) {
    settings.hooks.AfterAgent = removeOurGeminiHooks(settings.hooks.AfterAgent);
    if (settings.hooks.AfterAgent.length === 0) {
      delete settings.hooks.AfterAgent;
    }
  }

  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  writeJsonFile(settingsPath, settings);
  return { ok: true, settingsPath };
}

function getGeminiHookStatus() {
  const settingsPath = getGeminiSettingsPath();
  const settings = readJsonFile(settingsPath);
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const list = Array.isArray(hooks.AfterAgent) ? hooks.AfterAgent : [];
  const installed = list.some((definition) =>
    extractHookCommands(definition).some((hook) => isOurGeminiHook(hook))
  );
  return { installed, settingsPath };
}

function buildOpenCodePlugin(exePath) {
  const notifyArgv = buildNotifyArgv(exePath, 'opencode');
  return `// ${OPENCODE_PLUGIN_MARKER}
const NOTIFY_CMD = ${JSON.stringify(notifyArgv, null, 2)};
const DEDUPE_MS = 1500;
let lastEventKey = '';
let lastEventAt = 0;
let lastClashKey = '';
let lastClashAt = 0;

function firstEnv(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}
function loadClashFileConfig() {
  try {
    let fsMod = null, pathMod = null, osMod = null;
    try { fsMod = typeof require !== 'undefined' ? require('fs') : null; } catch(e) {}
    if (!fsMod) try { fsMod = globalThis.require ? globalThis.require('fs') : null; } catch(e) {}
    try { pathMod = typeof require !== 'undefined' ? require('path') : null; } catch(e) {}
    if (!pathMod) try { pathMod = globalThis.require ? globalThis.require('path') : null; } catch(e) {}
    try { osMod = typeof require !== 'undefined' ? require('os') : null; } catch(e) {}
    if (!osMod) try { osMod = globalThis.require ? globalThis.require('os') : null; } catch(e) {}
    if (!fsMod || !pathMod || !osMod) return null;
    const dataDir = process.env.AI_CLI_COMPLETE_NOTIFY_DATA_DIR || (process.platform === 'win32' ? pathMod.join(osMod.homedir(), 'AppData', 'Roaming', 'ai-cli-complete-notify') : pathMod.join(osMod.homedir(), '.config', 'ai-cli-complete-notify'));
    const p = pathMod.join(dataDir, 'settings.json');
    if (!fsMod.existsSync(p)) return null;
    const raw = fsMod.readFileSync(p, 'utf8');
    const cfg = JSON.parse(raw);
    if (cfg && cfg.clash) return cfg.clash;
  } catch (_) {}
  return null;
}
function getClashConfig() {
  const fileCfg = loadClashFileConfig();
  const enabledEnv = process.env.CLASH_AUTO_SWITCH_ENABLED ?? process.env.CLASH_ENABLED;
  let enabled;
  if (enabledEnv !== undefined) {
    const v = String(enabledEnv).toLowerCase();
    enabled = v === 'true' || v === '1';
  } else {
    enabled = fileCfg ? !!fileCfg.enabled : false;
  }
  const api = process.env.CLASH_API || process.env.CLASH_VERGE_API || (fileCfg && fileCfg.api) || 'http://127.0.0.1:9097';
  const fallbackApi = process.env.CLASH_FALLBACK_API || (fileCfg && fileCfg.fallbackApi) || 'http://127.0.0.1:9090';
  const secret = process.env.CLASH_SECRET || process.env.CLASH_VERGE_SECRET || (fileCfg && fileCfg.secret) || '';
  const group = process.env.CLASH_GROUP || (fileCfg && fileCfg.group) || '🚀 节点选择';
  const excludeNodes = (process.env.CLASH_EXCLUDE_NODES ? process.env.CLASH_EXCLUDE_NODES.split(',') : (fileCfg && fileCfg.excludeNodes) || ['DIRECT','REJECT']).map(s=>String(s).trim()).filter(Boolean);
  const dedupeMs = parseInt(String(process.env.CLASH_DEDUPE_MS || (fileCfg && fileCfg.dedupeMs) || '30000'),10);
  return { enabled, api, fallbackApi, secret, group, excludeNodes, dedupeMs };
}

const QUOTA_PATTERNS = [
  /FreeUsageLimitError/i,
  /GoUsageLimitError/i,
  /Free usage exceeded/i,
  /insufficient[_-\\s]?quota/i,
  /quota[_-\\s]?exceeded/i,
  /quota/i,
  /exhausted/i,
  /billing/i,
  /over_quota/i,
  /rate limit/i,
  /resource[_-\\s]?exhausted/i,
  /429/,
  /额度|配额|余额|已用完/,
];

function isQuotaExhausted(text) {
  if (!text || typeof text !== "string") return false;
  return QUOTA_PATTERNS.some(p => p.test(text));
}

function isQuotaStatusEvent(event) {
  if (getEventType(event) !== "session.status") return false;
  const props = event && typeof event.properties === "object" ? event.properties : {};
  const status = props.status;
  if (!status || typeof status !== "object" || status.type !== "retry") return false;
  const action = status.action && typeof status.action === "object" ? status.action : {};
  if (action.reason === "free_tier_limit" || action.reason === "quota_exhausted" || action.reason === "account_rate_limit") return true;
  const msg = firstString(status.message, action.message, action.title);
  return isQuotaExhausted(msg);
}

function shouldSkipClash(group, next, dedupeMs) {
  const key = \`\${group}::\${next}\`;
  const now = Date.now();
  if (key && key === lastClashKey && now - lastClashAt < dedupeMs) return true;
  lastClashKey = key;
  lastClashAt = now;
  return false;
}

let clashFailCount = 0;
let clashCircuitOpenUntil = 0;
const CLASH_CIRCUIT_THRESHOLD = 3;
const CLASH_CIRCUIT_COOLDOWN_MS = 5 * 60 * 1000;
function isClashCircuitOpen() { return Date.now() < clashCircuitOpenUntil; }
function recordClashSuccess() { clashFailCount = 0; clashCircuitOpenUntil = 0; }
function recordClashFail() {
  clashFailCount++;
  if (clashFailCount >= CLASH_CIRCUIT_THRESHOLD) clashCircuitOpenUntil = Date.now() + CLASH_CIRCUIT_COOLDOWN_MS;
}
async function fetchWithTimeout(url, opts={}, timeoutMs=5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (e) { clearTimeout(id); throw e; }
}
async function checkClashHealth(cfg) {
  const { api, fallbackApi, secret } = cfg;
  const apis = [api, fallbackApi].filter(Boolean);
  for (const base of apis) {
    try {
      const baseUrl = base.replace(/\\/+$/, "");
      const headers = secret ? { Authorization: \`Bearer \${secret}\` } : {};
      const res = await fetchWithTimeout(\`\${baseUrl}/version\`, { headers }, 3000);
      if (res.ok) return true;
    } catch (_) {}
  }
  return false;
}

async function switchClashNext(cfg) {
  if (isClashCircuitOpen()) throw new Error('Clash circuit open (too many fails, cooling)');
  const { group, api, fallbackApi, secret, excludeNodes, dedupeMs } = cfg;
  // Validate group exists quickly
  const healthy = await checkClashHealth(cfg);
  if (!healthy) { recordClashFail(); throw new Error('Clash API not reachable'); }
  const apis = [api];
  if (api.includes("9097") && !apis.includes(fallbackApi)) apis.push(fallbackApi);
  if (api.includes("9090") && !apis.includes("http://127.0.0.1:9097")) apis.push("http://127.0.0.1:9097");
  let lastErr = null;
  for (const base of apis) {
    try {
      const baseUrl = base.replace(/\\/+$/, "");
      const getUrl = \`\${baseUrl}/proxies/\${encodeURIComponent(group)}\`;
      const headers = secret ? { Authorization: \`Bearer \${secret}\` } : {};
      const res = await fetchWithTimeout(getUrl, { headers }, 5000);
      if (!res.ok) {
        lastErr = new Error(\`GET \${group} \${res.status}\`);
        continue;
      }
      const data = await res.json();
      const all = Array.isArray(data.all) ? data.all : [];
      const now = firstString(data.now);
      // 优先切叶节点（Vless等具体节点），避免切到子策略组（♻️ 自动选择等）
      let leafCandidates = all;
      try {
        const allProxiesRes = await fetchWithTimeout(\`\${baseUrl}/proxies\`, { headers }, 5000);
        if (allProxiesRes.ok) {
          const allProxies = (await allProxiesRes.json()).proxies || {};
          const groupTypes = ['Selector','URLTest','Fallback','LoadBalance','Relay'];
          leafCandidates = all.filter(n => {
            if (excludeNodes.includes(n)) return false;
            const t = allProxies[n]?.type;
            if (!t) return true;
            return !groupTypes.includes(t);
          });
          if (leafCandidates.length === 0) leafCandidates = all.filter(n => !excludeNodes.includes(n));
        } else {
          leafCandidates = all.filter(n => !excludeNodes.includes(n));
        }
      } catch (_) {
        leafCandidates = all.filter(n => !excludeNodes.includes(n));
      }
      const candidates = leafCandidates;
      if (candidates.length === 0) throw new Error(\`no candidates in \${group}\`);
      let idx = candidates.indexOf(now);
      if (idx === -1) idx = all.indexOf(now);
      // if now not in candidates (e.g. DIRECT), start from 0
      const nextIdx = idx === -1 ? 0 : (candidates.indexOf(now) !== -1 ? (candidates.indexOf(now) + 1) % candidates.length : (all.indexOf(now) + 1) % all.length);
      // Simpler: use candidates index
      let next = "";
      if (candidates.includes(now)) {
        const cIdx = candidates.indexOf(now);
        next = candidates[(cIdx + 1) % candidates.length];
      } else {
        // now not in candidates, pick first candidate
        next = candidates[0];
        // but if all.length > candidates.length, ensure round-robin still uses all order fallback
        if (!next) next = all[(all.indexOf(now) + 1) % all.length];
      }
      if (!next || next === now) throw new Error("no next proxy");
      if (shouldSkipClash(group, next, dedupeMs)) {
        return { switched: false, reason: "dedupe", from: now, to: next };
      }
      const putUrl = \`\${baseUrl}/proxies/\${encodeURIComponent(group)}\`;
      const putRes = await fetchWithTimeout(putUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ name: next }),
      });
      if (!putRes.ok && putRes.status !== 204) {
        lastErr = new Error(\`PUT \${group}->\${next} \${putRes.status}\`);
        continue;
      }
      // verify
      await delay(500);
      try {
        const verifyRes = await fetchWithTimeout(getUrl, { headers }, 3000);
        if (verifyRes.ok) {
          const v = await verifyRes.json();
          if (v.now !== next) {
            // still consider success if API accepted, but log mismatch
          }
        }
      } catch (_) {}
      recordClashSuccess();
      return { switched: true, from: now, to: next, api: base };
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  recordClashFail();
  throw lastErr || new Error("clash switch failed");
}

async function handleQuotaSwitch(payload, event, client) {
  const cfg = getClashConfig();
  if (!cfg.enabled) return;
  try {
    const result = await switchClashNext(cfg);
    if (result.switched) {
      const msg = \`Clash 已切同组下一个: \${cfg.group} \${result.from} -> \${result.to} (429/quota)\`;
      // log via client if available
      try {
        if (client && client.app && typeof client.app.log === "function") {
          await client.app.log({ body: { service: "clash-failover", level: "warn", message: msg, extra: { sessionID: payload.session_id, group: cfg.group, from: result.from, to: result.to, api: result.api } } });
        }
      } catch (_) {}
      // dispatch notification via original channel (additive)
      const notifyPayload = {
        ...payload,
        task_info: msg,
        output_content: \`\${msg}\\n原错误: \${payload.error_message || ""}\\n\${payload.assistant_message || ""}\`.trim(),
        hook_event_name: payload.hook_event_name + "+clash-switch",
      };
      await dispatchPayload(notifyPayload);
    } else if (result.reason === "dedupe") {
      // skip notify on dedupe
    }
  } catch (e) {
    const errMsg = e && e.message ? e.message : String(e);
    try {
      if (client && client.app && typeof client.app.log === "function") {
        await client.app.log({ body: { service: "clash-failover", level: "error", message: \`Clash 切换失败: \${errMsg}\`, extra: { sessionID: payload.session_id, group: cfg.group } } });
      }
    } catch (_) {}
    // still notify failure via original channel
    const failPayload = {
      ...payload,
      task_info: \`Clash 切换失败: \${cfg.group} \${errMsg}\`,
      output_content: \`Clash 切换失败: \${errMsg}\\n原错误: \${payload.error_message || ""}\`.trim(),
      hook_event_name: payload.hook_event_name + "+clash-fail",
    };
    await dispatchPayload(failPayload);
  }
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function getEventType(event) {
  return firstString(event && event.type);
}

function getSessionId(event) {
  const props = event && typeof event.properties === 'object' ? event.properties : {};
  return firstString(
    event && event.sessionID,
    event && event.sessionId,
    props.sessionID,
    props.sessionId,
    props.id,
  );
}

function getErrorMessage(event) {
  const props = event && typeof event.properties === 'object' ? event.properties : {};
  const directError = event && typeof event.error === 'object' ? event.error : {};
  const propError = props && typeof props.error === 'object' ? props.error : {};
  return firstString(
    directError && directError.message,
    propError && propError.message,
    props.message,
    event && event.message,
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return typeof value === 'string' ? value.replace(/\\r\\n/g, '\\n').trim() : '';
}

function appendText(parts, value) {
  const text = normalizeText(value);
  if (text) parts.push(text);
}

function isVisibleTextPart(part) {
  if (!part || typeof part !== 'object') return false;
  const type = firstString(part.type, part.kind).toLowerCase();
  if (!type) return true;
  if (type !== 'text') return false;
  return part.ignored !== true;
}

function appendMessageParts(parts, messageParts) {
  if (!Array.isArray(messageParts)) return;
  for (const part of messageParts) {
    if (!isVisibleTextPart(part)) continue;
    appendText(parts, part.text);
    appendText(parts, part.content);
    appendText(parts, part.value);
  }
}

function extractMessageText(entry) {
  const parts = [];
  const entryParts = Array.isArray(entry && entry.parts) ? entry.parts : null;
  appendMessageParts(parts, entryParts);

  const message = entry && typeof entry.message === 'object' ? entry.message : null;
  const messageParts = message && Array.isArray(message.parts) ? message.parts : null;
  if (message) {
    appendMessageParts(parts, messageParts);
  }

  const hasStructuredParts = Boolean(entryParts || messageParts);
  if (!hasStructuredParts) {
    if (message) {
      appendText(parts, message.text);
      appendText(parts, message.content);
    }
    appendText(parts, entry && entry.text);
    appendText(parts, entry && entry.content);
    appendText(parts, typeof (entry && entry.message) === 'string' ? entry.message : '');
  }

  return parts.join('\\n\\n').trim();
}

function isAssistantMessage(entry) {
  const info = entry && typeof entry.info === 'object' ? entry.info : {};
  const role = firstString(info.role, entry && entry.role).toLowerCase();
  const kind = firstString(info.type, entry && entry.type).toLowerCase();
  return role === 'assistant' || kind === 'assistant';
}

function toMessageList(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result && result.data)) return result.data;
  if (Array.isArray(result && result.messages)) return result.messages;
  if (result && Array.isArray(result.data && result.data.messages)) return result.data.messages;
  return [];
}

async function fetchLatestAssistantText(client, sessionId) {
  if (!client || !client.session || typeof client.session.messages !== 'function' || !sessionId) {
    return '';
  }

  for (const waitMs of [0, 150, 500]) {
    if (waitMs > 0) {
      await delay(waitMs);
    }

    try {
      const result = await client.session.messages({ path: { id: sessionId } });
      const messages = toMessageList(result);
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const entry = messages[index];
        if (!isAssistantMessage(entry)) continue;
        const text = extractMessageText(entry);
        if (text) return text;
      }
    } catch (_error) {
      // ignore
    }
  }

  return '';
}

async function buildPayload(event, context, client) {
  const eventType = getEventType(event);
  const errorMessage = getErrorMessage(event);
  const sessionId = getSessionId(event);
  const assistantText = eventType === 'session.idle' || isSessionIdleStatus(event)
    ? await fetchLatestAssistantText(client, sessionId)
    : '';
  return {
    hook_source: 'opencode-plugin',
    hook_event_name: eventType,
    cwd: firstString(
      event && event.cwd,
      event && event.directory,
      context.worktree,
      context.directory,
    ),
    task_info: eventType === 'session.error'
      ? (errorMessage ? \`OpenCode 失败: \${errorMessage}\` : 'OpenCode 失败')
      : truncateAssistantText(assistantText, 40) || 'OpenCode 完成',
    session_id: sessionId,
    error_message: errorMessage,
    project_name: firstString(context.project && context.project.name),
    assistant_message: assistantText,
    output_content: eventType === 'session.error' ? errorMessage : assistantText,
  };
}

function isSessionIdleStatus(event) {
  if (getEventType(event) !== 'session.status') return false;
  const props = event && typeof event.properties === 'object' ? event.properties : {};
  const status = props.status;
  return status && typeof status === 'object' && status.type === 'idle';
}

function truncateAssistantText(text, maxWords) {
  const value = normalizeText(text);
  if (!value) return '';
  const words = value.split(/\\s+/).filter(Boolean);
  if (words.length <= maxWords) return value;
  return \`\${words.slice(0, maxWords).join(' ')}...\`;
}

function isCompletionEvent(event) {
  const type = getEventType(event);
  if (type === 'session.idle') return true;
  if (type === 'session.error') return true;
  return isSessionIdleStatus(event);
}

function shouldSkip(payload) {
  const key = [payload.hook_event_name, payload.session_id, payload.error_message].join('::');
  const now = Date.now();
  if (key && key === lastEventKey && now - lastEventAt < DEDUPE_MS) {
    return true;
  }
  lastEventKey = key;
  lastEventAt = now;
  return false;
}

async function dispatchPayload(payload) {
  const payloadJson = JSON.stringify(payload);
  try {
    Bun.spawn({
      cmd: NOTIFY_CMD,
      cwd: payload.cwd || undefined,
      env: {
        ...process.env,
        DESKTOP_NOTIFY_MODE: process.platform === 'win32' ? 'popup' : String(process.env.DESKTOP_NOTIFY_MODE || ''),
      },
      stdin: new TextEncoder().encode(payloadJson),
      stdout: 'ignore',
      stderr: 'ignore',
    });
  } catch (_error) {
    // ignore
  }
}

export const AiCliCompleteNotifyPlugin = async ({ client, project, directory, worktree }) => {
  return {
    event: async ({ event }) => {
      const isQuotaStatus = isQuotaStatusEvent(event);
      const isCompletion = isCompletionEvent(event);
      if (!isQuotaStatus && !isCompletion) return;

      // --- original notification path (preserved) ---
      if (isCompletion) {
        const payload = await buildPayload(event, { project, directory, worktree }, client);
        if (!shouldSkip(payload)) {
          await dispatchPayload(payload);
        }
        // quota check also on completion events (session.error with 429 text)
        const quotaTextForCompletion = [payload.error_message, payload.assistant_message, getErrorMessage(event)].join("\\n");
        // For session.error, assistant_message is empty (original buildPayload), try fetch extra for quota detection
        let extraQuotaText = "";
        if (payload.session_id && !payload.assistant_message) {
          try {
            extraQuotaText = await fetchLatestAssistantText(client, payload.session_id);
          } catch (_) {}
        }
        const fullQuotaText = quotaTextForCompletion + "\\n" + extraQuotaText;
        if (isQuotaExhausted(fullQuotaText)) {
          // need payload with assistant for switch notification; enrich
          if (extraQuotaText) {
            payload.assistant_message = payload.assistant_message ? payload.assistant_message + "\\n" + extraQuotaText : extraQuotaText;
            payload.output_content = payload.error_message ? payload.error_message + "\\n" + extraQuotaText : extraQuotaText;
          }
          await handleQuotaSwitch(payload, event, client);
        } else if (isQuotaStatus) {
          // status retry but not matched via text, still switch (already filtered by reason)
          await handleQuotaSwitch(payload, event, client);
        }
        return;
      }

      // --- quota-only path (session.status retry) ---
      if (isQuotaStatus) {
        // Build a payload for notification/switch (no original isCompletion, so create one)
        const sessionId = getSessionId(event);
        let assistantText = "";
        try {
          assistantText = await fetchLatestAssistantText(client, sessionId);
        } catch (_) {}
        const status = event.properties && event.properties.status ? event.properties.status : {};
        const action = status.action || {};
        const errMsg = firstString(status.message, action.message, action.title, getErrorMessage(event)) || "FreeUsageLimitError";
        const payload = {
          hook_source: 'opencode-plugin',
          hook_event_name: getEventType(event),
          cwd: firstString(event.cwd, event.directory, worktree, directory),
          task_info: \`OpenCode 429/额度: \${errMsg}\`.slice(0, 120),
          session_id: sessionId,
          error_message: errMsg,
          project_name: firstString(project && project.name),
          assistant_message: assistantText,
          output_content: assistantText || errMsg,
        };
        await handleQuotaSwitch(payload, event, client);
      }
    },
  };
};
`;
}

function isOurOpenCodePlugin() {
  const pluginPath = getOpenCodePluginPath();
  try {
    if (!fs.existsSync(pluginPath)) return false;
    const content = fs.readFileSync(pluginPath, 'utf8');
    return content.includes(OPENCODE_PLUGIN_MARKER);
  } catch (_error) {
    return false;
  }
}

function installOpenCodeHook(exePath) {
  const pluginPath = getOpenCodePluginPath();
  const pluginDir = path.dirname(pluginPath);
  if (!fs.existsSync(pluginDir)) {
    fs.mkdirSync(pluginDir, { recursive: true });
  }
  fs.writeFileSync(pluginPath, buildOpenCodePlugin(exePath), 'utf8');
  return { ok: true, settingsPath: pluginPath };
}

function uninstallOpenCodeHook() {
  const pluginPath = getOpenCodePluginPath();
  try {
    if (fs.existsSync(pluginPath)) {
      const content = fs.readFileSync(pluginPath, 'utf8');
      if (content.includes(OPENCODE_PLUGIN_MARKER)) {
        fs.unlinkSync(pluginPath);
      }
    }
  } catch (_error) {
    return { ok: false, error: 'Failed to remove OpenCode plugin', settingsPath: pluginPath };
  }
  return { ok: true, settingsPath: pluginPath };
}

function getOpenCodeHookStatus() {
  const settingsPath = getOpenCodePluginPath();
  return {
    installed: isOurOpenCodePlugin(),
    settingsPath
  };
}

function getHookStatus() {
  return {
    claude: getClaudeHookStatus(),
    gemini: getGeminiHookStatus(),
    opencode: getOpenCodeHookStatus()
  };
}

function installHook(target) {
  const exePath = getExePath();
  if (target === 'claude') return installClaudeHook(exePath);
  if (target === 'gemini') return installGeminiHook(exePath);
  if (target === 'opencode') return installOpenCodeHook(exePath);
  return { ok: false, error: `Unknown target: ${target}` };
}

function uninstallHook(target) {
  if (target === 'claude') return uninstallClaudeHook();
  if (target === 'gemini') return uninstallGeminiHook();
  if (target === 'opencode') return uninstallOpenCodeHook();
  return { ok: false, error: `Unknown target: ${target}` };
}

function getHookConfigPreview(target) {
  const exePath = getExePath();
  if (target === 'claude') {
    const hooks = buildClaudeHooks(exePath);
    return JSON.stringify({ hooks }, null, 2);
  }
  if (target === 'gemini') {
    const hooks = { AfterAgent: buildGeminiHooks(exePath) };
    return JSON.stringify({ hooks }, null, 2);
  }
  if (target === 'opencode') {
    return buildOpenCodePlugin(exePath);
  }
  return '';
}

module.exports = {
  getExePath,
  getHookStatus,
  installHook,
  uninstallHook,
  getHookConfigPreview
};
