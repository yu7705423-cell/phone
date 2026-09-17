import { sseLines } from '../sse.js';

const API_VERSION = '2023-06-01';
const DEFAULT_BASE = 'https://api.anthropic.com';

// 浏览器直连需要这个头,否则被 CORS 拒绝。
// 代价是 key 暴露在前端,只适合自己用,见 ARCHITECTURE 4.2 C
function headers(cfg) {
  return {
    'content-type': 'application/json',
    'x-api-key': cfg.apiKey,
    'anthropic-version': API_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

function buildBody(cfg, { system, messages, maxTokens, stream }) {
  const body = {
    model: cfg.model,
    max_tokens: maxTokens,
    // 带图的消息换成内容块数组。Anthropic 收的是 base64 加 media_type，
    // 和 OpenAI 那边的 dataURL 形状不一样，所以在各自的 provider 里转。
    messages: messages.map(m => ({
      role: m.role,
      content: m.image
        ? [
          { type: 'text', text: m.content },
          { type: 'image',
            source: { type: 'base64', media_type: m.image.mediaType,
              data: String(m.image.dataUrl).split(',')[1] || '' } },
        ]
        : m.content,
    })),
  };
  if (system) body.system = system;
  if (stream) body.stream = true;
  // Opus 5 / Sonnet 5 一族不再接受 temperature,传了会 400。
  // 输出深浅改用 output_config.effort 控制。
  if (cfg.effort) body.output_config = { effort: cfg.effort };
  return body;
}

async function failure(res) {
  let detail = '';
  try {
    const j = await res.json();
    detail = j?.error?.message || JSON.stringify(j).slice(0, 300);
  } catch { detail = await res.text().catch(() => ''); }
  const err = new Error(`Anthropic ${res.status}: ${detail || res.statusText}`);
  err.status = res.status;
  throw err;
}

export const anthropic = {
  id: 'anthropic',
  label: 'Anthropic',
  defaultModel: 'claude-opus-5',
  models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  usesTemperature: false,
  usesEffort: true,

  async stream(cfg, { system, messages, maxTokens, signal, onDelta }) {
    const res = await fetch(`${cfg.baseUrl || DEFAULT_BASE}/v1/messages`, {
      method: 'POST', headers: headers(cfg), signal,
      body: JSON.stringify(buildBody(cfg, { system, messages, maxTokens, stream: true })),
    });
    if (!res.ok) await failure(res);

    let text = '';
    let stopReason = null;
    for await (const data of sseLines(res)) {
      if (!data || data === '[DONE]') continue;
      let ev;
      try { ev = JSON.parse(data); } catch { continue; }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        text += ev.delta.text;
        onDelta && onDelta(ev.delta.text, text);
      } else if (ev.type === 'message_delta' && ev.delta?.stop_reason) {
        stopReason = ev.delta.stop_reason;
      } else if (ev.type === 'error') {
        throw new Error(ev.error?.message || 'Anthropic 流式响应报错');
      }
    }
    // refusal 是 HTTP 200,必须显式检查
    if (stopReason === 'refusal') throw new Error('模型拒绝了这次请求');
    return text;
  },

  async complete(cfg, { system, messages, maxTokens, signal }) {
    const res = await fetch(`${cfg.baseUrl || DEFAULT_BASE}/v1/messages`, {
      method: 'POST', headers: headers(cfg), signal,
      body: JSON.stringify(buildBody(cfg, { system, messages, maxTokens, stream: false })),
    });
    if (!res.ok) await failure(res);
    const j = await res.json();
    if (j.stop_reason === 'refusal') throw new Error('模型拒绝了这次请求');
    return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  },
};
