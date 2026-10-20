'use strict';
// AI 接入层：默认 DeepSeek，可在配置或环境变量中切换服务商/模型，代码中不写死。
// 统一负责：超时、有限重试、结构化输出解析与校验、调用可观测、失败降级。
const fs = require('fs');
const path = require('path');
const store = require('./store');

const CONFIG_FILE = path.join(__dirname, '..', 'config.local.json');

function readConfig() {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { file = {}; }
  const ai = Object.assign({
    provider: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: '',
    model: 'deepseek-flash', visionModel: '', timeoutMs: 120000, maxRetries: 2
  }, file.ai || {});
  // 环境变量优先，便于部署时覆盖，无需改代码
  ai.baseUrl = process.env.AI_BASE_URL || ai.baseUrl;
  ai.apiKey = process.env.AI_API_KEY || ai.apiKey;
  ai.model = process.env.AI_MODEL || ai.model;
  ai.visionModel = process.env.AI_VISION_MODEL || ai.visionModel || ai.model;
  ai.provider = process.env.AI_PROVIDER || ai.provider;
  if (process.env.AI_TIMEOUT_MS) ai.timeoutMs = Number(process.env.AI_TIMEOUT_MS);
  return ai;
}
function serverConfig() {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { file = {}; }
  const s = Object.assign({ host: '127.0.0.1', port: 8899 }, file.server || {});
  s.host = process.env.HOST || s.host;
  s.port = Number(process.env.PORT || s.port);
  return s;
}

const log = (rec) => { try { store.insert('aiLogs', rec); } catch (e) { /* 日志失败不影响主流程 */ } };

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
  return '';
}
function dataUrl(mime, buf) { return 'data:' + (mime || 'image/png') + ';base64,' + buf.toString('base64'); }
function imagePart(mime, buf) { return { type: 'image_url', image_url: { url: dataUrl(mime, buf) } }; }

async function callApi(messages, opts) {
  const ai = readConfig();
  const model = opts.model || ai.model;
  const url = ai.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  // deepseek-flash 会先输出推理内容，预算过小会导致正文为空，因此这里设下限。
  const maxTokens = Math.max(Number(opts.maxTokens) || 0, opts.jsonObject ? 3072 : 2048);
  const body = {
    model,
    messages,
    temperature: opts.temperature === undefined ? 0.4 : opts.temperature,
    max_tokens: maxTokens,
    stream: false
  };
  if (opts.jsonObject) body.response_format = { type: 'json_object' };
  let lastErr = null;
  const attempts = Math.max(1, (ai.maxRetries || 0) + 1);
  for (let i = 0; i < attempts; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ai.timeoutMs || 120000);
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST', signal: ac.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ai.apiKey },
        body: JSON.stringify(body)
      });
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (e) { data = null; }
      clearTimeout(timer);
      if (!res.ok) {
        const msg = (data && data.error && data.error.message) || text.slice(0, 200) || ('HTTP ' + res.status);
        lastErr = new Error(msg);
        if (res.status === 429 || res.status >= 500) continue; // 可重试
        throw lastErr;
      }
      const msg = data.choices && data.choices[0] && data.choices[0].message;
      let content = msg ? (msg.content || '') : '';
      const reasoning = (msg && msg.reasoning_content) || '';
      // 推理内容吃满预算时正文可能为空，此时退回使用推理内容，避免整次调用白费。
      let usedReasoning = false;
      if (!String(content).trim() && reasoning) { content = reasoning; usedReasoning = true; }
      const usage = data.usage || {};
      log({
        userId: opts.userId || null, purpose: opts.purpose || 'chat', provider: ai.provider, model: data.model || model,
        inputSize: (usage.prompt_tokens || 0), outputSize: (usage.completion_tokens || 0),
        status: 'ok', retried: i > 0, degraded: usedReasoning, carriedMemory: false,
        ms: Date.now() - t0, carriedContext: opts.carriedContext || null
      });
      return { ok: true, content, reasoning, model: data.model || model, ms: Date.now() - t0 };
    } catch (e) {
      clearTimeout(timer);
      lastErr = e.name === 'AbortError' ? new Error('模型响应超时') : e;
      if (e.name === 'AbortError') continue;
      if (i === attempts - 1) break;
    }
  }
  log({
    userId: opts.userId || null, purpose: opts.purpose || 'chat', provider: readConfig().provider, model: opts.model || readConfig().model,
    status: 'failed', retried: attempts > 1, degraded: true, carriedMemory: false, error: String(lastErr && lastErr.message || lastErr)
  });
  return { ok: false, error: String((lastErr && lastErr.message) || '调用失败'), content: '' };
}

/** 纯文本生成；失败返回 ok:false，由调用方降级。 */
async function chat(messages, opts = {}) { return callApi(messages, opts); }

function extractJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = s.indexOf('{'); const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const slice = s.slice(start, end + 1);
  try { return JSON.parse(slice); } catch (e) { return null; }
}

/** 输出被 max_tokens 截断时，尽可能抢救出可用结构：逐步回退到上一个逗号并补齐括号。 */
function repairJson(text) {
  let s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = s.indexOf('{');
  if (start < 0) return null;
  s = s.slice(start);
  const tryParse = (str) => { try { return JSON.parse(str); } catch (e) { return null; } };
  let cut = s.length;
  for (let attempt = 0; attempt < 300; attempt++) {
    const lastComma = s.lastIndexOf(',', cut - 1);
    if (lastComma < 0) return null;
    const prefix = s.slice(0, lastComma);
    const stack = [];
    let inStr = false, esc = false;
    for (let i = 0; i < prefix.length; i++) {
      const c = prefix[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
      else if (c === '}' || c === ']') stack.pop();
    }
    const candidate = prefix + (inStr ? '"' : '') + stack.reverse().join('');
    const parsed = tryParse(candidate);
    if (parsed) return parsed;
    cut = lastComma;
  }
  return null;
}

/**
 * 结构化输出：要求模型返回 JSON，解析失败会带着修正提示重试一次。
 * validate(obj) 返回错误字符串数组（空数组=通过）。
 */
async function chatJSON(messages, opts = {}) {
  const validate = opts.validate || (() => []);
  const msgs = messages.slice();
  let lastRaw = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await callApi(msgs, Object.assign({}, opts, { jsonObject: true, temperature: opts.temperature === undefined ? 0.2 : opts.temperature }));
    if (!res.ok) return { ok: false, error: res.error, degraded: true };
    lastRaw = res.content;
    const obj = extractJson(res.content) || repairJson(res.content);
    if (obj) {
      const errs = validate(obj) || [];
      if (!errs.length) return { ok: true, data: obj, model: res.model };
      msgs.push({ role: 'assistant', content: res.content });
      msgs.push({ role: 'user', content: '上一次输出不符合要求：' + errs.join('；') + '。请只输出修正后的 JSON，不要任何解释文字。' });
    } else {
      msgs.push({ role: 'assistant', content: String(res.content).slice(0, 500) });
      msgs.push({ role: 'user', content: '上一次输出不是合法 JSON。请只输出一个 JSON 对象，不要 Markdown 代码块、不要解释。' });
    }
  }
  log({ purpose: (opts.purpose || 'json') + ':parse-failed', status: 'failed', degraded: true, raw: String(lastRaw).slice(0, 200) });
  return { ok: false, error: '模型输出格式不符合要求', degraded: true };
}

module.exports = { readConfig, serverConfig, chat, chatJSON, extractJson, imagePart, dataUrl, textOf, callApi };
