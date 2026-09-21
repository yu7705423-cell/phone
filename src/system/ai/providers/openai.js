import { sseLines } from '../sse.js';

const DEFAULT_BASE = 'https://api.openai.com/v1';

function headers(cfg) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${cfg.apiKey}`,
  };
}

function url(cfg) {
  const base = (cfg.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
  return /\/v\d+$/.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

function buildBody(cfg, { system, messages, maxTokens, stream }) {
  const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages;
  const body = {
    model: cfg.model,
    // 带图的消息换成内容块数组。图片以 dataURL 内联，不经过任何中转存储。
    messages: msgs.map(m => ({
      role: m.role === 'char' ? 'assistant' : m.role,
      content: m.image
        ? [{ type: 'text', text: m.content }, { type: 'image_url', image_url: { url: m.image.dataUrl } }]
        : m.content,
    })),
  };
  // 0 表示**整个字段都不送**，让服务端用它自己的上限。填一个大数是不行的：
  // 各家模型的上限不一样，给一个上限 8192 的模型填 200000，请求直接被退回来，
  // 而报错文案通常看不出是哪个字段的事。见 CLAUDE.md 第 13 条、ARCHITECTURE 4.107
  if (maxTokens > 0) body.max_tokens = maxTokens;
  if (cfg.temperature != null) body.temperature = cfg.temperature;
  if (stream) body.stream = true;
  return body;
}

async function failure(res) {
  let detail = '';
  try {
    const j = await res.json();
    detail = j?.error?.message || JSON.stringify(j).slice(0, 300);
  } catch { detail = await res.text().catch(() => ''); }
  const err = new Error(`接口 ${res.status}: ${detail || res.statusText}`);
  err.status = res.status;
  throw err;
}

export const openai = {
  id: 'openai',
  label: 'OpenAI 兼容',
  defaultModel: 'gpt-4o-mini',
  models: [],
  usesTemperature: true,
  usesEffort: false,

  async stream(cfg, { system, messages, maxTokens, signal, onDelta }) {
    const res = await fetch(url(cfg), {
      method: 'POST', headers: headers(cfg), signal,
      body: JSON.stringify(buildBody(cfg, { system, messages, maxTokens, stream: true })),
    });
    if (!res.ok) await failure(res);

    let text = '';
    for await (const data of sseLines(res)) {
      if (!data || data === '[DONE]') continue;
      let ev;
      try { ev = JSON.parse(data); } catch { continue; }
      if (ev.error) throw new Error(ev.error.message || '流式响应报错');
      const piece = ev.choices?.[0]?.delta?.content;
      if (piece) { text += piece; onDelta && onDelta(piece, text); }
    }
    return text;
  },

  async complete(cfg, { system, messages, maxTokens, signal }) {
    const res = await fetch(url(cfg), {
      method: 'POST', headers: headers(cfg), signal,
      body: JSON.stringify(buildBody(cfg, { system, messages, maxTokens, stream: false })),
    });
    if (!res.ok) await failure(res);
    const j = await res.json();
    return j.choices?.[0]?.message?.content || '';
  },
};
