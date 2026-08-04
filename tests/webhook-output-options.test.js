const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const test = require('node:test');

function mockHttpsRequest(t) {
  const originalRequest = https.request;
  let postedPayload = null;

  t.after(() => {
    https.request = originalRequest;
  });

  https.request = (_options, callback) => {
    let body = '';
    const req = new EventEmitter();
    req.write = (chunk) => {
      body += chunk.toString();
    };
    req.end = () => {
      postedPayload = JSON.parse(body);
      const res = new EventEmitter();
      res.statusCode = 200;
      callback(res);
      res.emit('data', Buffer.from(JSON.stringify({ errcode: 0, errmsg: 'ok' })));
      res.emit('end');
    };
    req.setTimeout = () => {};
    req.destroy = () => {};
    return req;
  };

  return () => postedPayload;
}

function resetWebhookModule() {
  delete require.cache[require.resolve('../src/notifiers/webhook')];
  return require('../src/notifiers/webhook');
}

async function notifyDingtalkWebhook(channel, overrides = {}) {
  const { notifyWebhook } = resetWebhookModule();
  return await notifyWebhook({
    config: {
      channels: {
        webhook: {
          urls: ['https://oapi.dingtalk.com/robot/send?access_token=test'],
          useFeishuCard: false,
          ...channel,
        },
      },
    },
    title: '[Codex] app: summary text',
    contentText: 'Completed at: 2026/6/4 10:00:00\nSource: Codex',
    projectName: 'app',
    timestamp: '2026/6/4 10:00:00',
    durationText: '1s',
    sourceLabel: 'Codex',
    taskInfo: 'summary text',
    outputContent: 'abcdefghijklmnopqrstuvwxyz',
    summaryUsed: true,
    ...overrides,
  });
}

test('non-card webhook keeps summary-first output by default', async (t) => {
  const getPostedPayload = mockHttpsRequest(t);

  const result = await notifyDingtalkWebhook({});

  assert.equal(result.ok, true);
  const content = getPostedPayload().text.content;
  assert.match(content, /\*\*AI 摘要\*\*\nsummary text/);
  assert.doesNotMatch(content, /abcdefghijklmnopqrstuvwxyz/);
});

test('non-card webhook can include summary output with truncation', async (t) => {
  const getPostedPayload = mockHttpsRequest(t);

  const result = await notifyDingtalkWebhook({
    includeOutputWhenSummary: true,
    outputMaxLength: 12,
  });

  assert.equal(result.ok, true);
  const content = getPostedPayload().text.content;
  assert.match(content, /\*\*AI 摘要\*\*\nsummary text/);
  assert.match(content, /\n---\n/);
  assert.match(content, /原文\nabcdefghijkl\n\n\.\.\.\(内容过长已截断\)/);
  assert.doesNotMatch(content, /mnopqrstuvwxyz/);
});

test('non-card webhook keeps original output when summary is not used', async (t) => {
  const getPostedPayload = mockHttpsRequest(t);

  const result = await notifyDingtalkWebhook({
    includeOutputWhenSummary: false,
  }, {
    taskInfo: 'original task text',
    outputContent: 'original output must not be swallowed',
    summaryUsed: false,
  });

  assert.equal(result.ok, true);
  const content = getPostedPayload().text.content;
  assert.doesNotMatch(content, /AI 摘要：/);
  assert.match(content, /输出内容：\noriginal output must not be swallowed/);
});

test('non-card webhook shows summary failure reason before fallback output', async (t) => {
  const getPostedPayload = mockHttpsRequest(t);

  const result = await notifyDingtalkWebhook({}, {
    summaryDiagnostics: {
      attempted: true,
      used: false,
      error: 'timeout',
    },
    taskInfo: 'original task text',
    outputContent: 'fallback original output',
    summaryUsed: false,
  });

  assert.equal(result.ok, true);
  const content = getPostedPayload().text.content;
  assert.match(content, /\*\*AI 摘要\*\*：请求超时，已显示原文/);
  assert.match(content, /\n---\n/);
  assert.match(content, /原文\nfallback original output/);
});

test('webhook adds the AI reminder marker exactly once for real notifications', async (t) => {
  const getPostedPayload = mockHttpsRequest(t);

  const result = await notifyDingtalkWebhook({}, {
    title: '[Codex] app: Codex completed',
    taskInfo: 'Codex completed',
    outputContent: '',
    summaryUsed: false,
  });

  assert.equal(result.ok, true);
  const content = getPostedPayload().text.content;
  assert.match(content, /AI提醒/);
  assert.equal((content.match(/AI提醒/g) || []).length, 1);
});

test('webhook does not duplicate an existing AI reminder marker', async (t) => {
  const getPostedPayload = mockHttpsRequest(t);

  const result = await notifyDingtalkWebhook({}, {
    title: '[Codex] app: AI提醒 测试提醒',
    taskInfo: 'AI提醒 测试提醒',
    outputContent: '',
    summaryUsed: false,
  });

  assert.equal(result.ok, true);
  const content = getPostedPayload().text.content;
  assert.equal((content.match(/AI提醒/g) || []).length, 1);
});

test('webhook exposes provider errors without leaking the webhook URL', async (t) => {
  const originalRequest = https.request;
  t.after(() => {
    https.request = originalRequest;
  });

  https.request = (_options, callback) => {
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      callback(res);
      res.emit('data', Buffer.from(JSON.stringify({
        errcode: 310000,
        errmsg: 'keywords not in content: https://oapi.dingtalk.com/robot/send?access_token=secret',
      })));
      res.emit('end');
    };
    req.setTimeout = () => {};
    req.destroy = () => {};
    return req;
  };

  const result = await notifyDingtalkWebhook({});

  assert.equal(result.ok, false);
  assert.equal(result.error, 'dingtalk: keywords not in content: <redacted URL>');
  assert.doesNotMatch(result.error, /access_token|https?:\/\//i);
});

test('Feishu post, WeCom, and generic webhooks include the AI reminder marker', async (t) => {
  const originalRequest = https.request;
  const posted = [];
  t.after(() => {
    https.request = originalRequest;
  });

  https.request = (options, callback) => {
    let body = '';
    const req = new EventEmitter();
    req.write = (chunk) => {
      body += chunk.toString();
    };
    req.end = () => {
      posted.push({ hostname: options.hostname, payload: JSON.parse(body) });
      const res = new EventEmitter();
      res.statusCode = 200;
      callback(res);
      const response = options.hostname.includes('feishu.cn')
        ? { code: 0, msg: 'success' }
        : { errcode: 0, errmsg: 'ok' };
      res.emit('data', Buffer.from(JSON.stringify(response)));
      res.emit('end');
    };
    req.setTimeout = () => {};
    req.destroy = () => {};
    return req;
  };

  const { notifyWebhook } = resetWebhookModule();
  const result = await notifyWebhook({
    config: {
      channels: {
        webhook: {
          urls: [
            'https://open.feishu.cn/open-apis/bot/v2/hook/test',
            'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test',
            'https://example.com/webhook',
          ],
          useFeishuCard: false,
        },
      },
    },
    title: '[Codex] app: Codex completed',
    contentText: 'Completed at: 2026/8/4 20:00:00\nSource: Codex',
    projectName: 'app',
    timestamp: '2026/8/4 20:00:00',
    durationText: '1m 0s',
    sourceLabel: 'Codex',
    taskInfo: 'Codex completed',
    outputContent: '',
    summaryUsed: false,
  });

  assert.equal(result.ok, true);
  assert.equal(posted.length, 3);
  for (const item of posted) {
    assert.match(JSON.stringify(item.payload), /AI提醒/, item.hostname);
  }
});

test('test panel defaults include the shared AI reminder marker', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const zh = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src-ui', 'i18n', 'zh-CN.json'), 'utf8'));
  const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src-ui', 'i18n', 'en.json'), 'utf8'));

  assert.match(zh['test.defaultTask'], /AI提醒/);
  assert.match(en['test.defaultTask'], /AI提醒/);
});
