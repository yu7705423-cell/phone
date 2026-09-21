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

/**
 * 历史里那几条 system 消息，Anthropic 收不了。
 *
 * **它的 messages 只认 user 与 assistant**，system 必须走顶层参数。而世界书的
 * 「插入深度」和本轮召回都是以 system 角色插进历史的（见 engine.insertLore）——
 * 原样发过去就是一个 400，而 memoryDepth 默认是 1，也就是说**库里一有记忆
 * 能召回，这一轮就发不出去**。走 OpenAI 兼容端点的人碰不到，那边容忍
 * system 混在中间，所以这条一直没被发现。
 *
 * 转成 user，并用 <context> 包住：不包的话它读起来就像用户自己说的话，
 * 模型会回一句「好的我记住了」。包起来是 Anthropic 自己文档里的做法
 * （长上下文里的资料用 XML 标签裹着放进 user 轮）。
 *
 * 转完顺手合并相邻的同角色消息 —— 带图的那条不合，合进去图就和文字错位了。
 */
function toUserTurns(messages) {
  const out = [];
  for (const m of messages) {
    const one = m.role === 'system'
      ? { ...m, role: 'user', content: `<context>\n${m.content}\n</context>` }
      : m;
    const last = out[out.length - 1];
    if (last && last.role === one.role && !last.image && !one.image) {
      last.content += `\n\n${one.content}`;
    } else {
      out.push({ ...one });
    }
  }
  return out;
}

// Anthropic 要求必填。各代模型的输出上限不同，取一个大多数都收的值
const DEFAULT_MAX = 32000;

function buildBody(cfg, { system, messages, maxTokens, stream }) {
  const body = {
    model: cfg.model,
    // Anthropic 这边 max_tokens 是必填的，省不掉，所以 0 退回默认值。
    // OpenAI 兼容那边 0 是「不送这个字段」，两边行为不同是接口决定的
    max_tokens: maxTokens > 0 ? maxTokens : DEFAULT_MAX,
    // 带图的消息换成内容块数组。Anthropic 收的是 base64 加 media_type，
    // 和 OpenAI 那边的 dataURL 形状不一样，所以在各自的 provider 里转。
    messages: toUserTurns(messages).map(m => ({
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
  // 设定区那一段整轮不变，声明成可缓存的：命中之后这一段按一折算。
  //
  // **要的就是它足够稳。** 每轮都变的那几块已经搬到对话末尾去了
  // （见 context/index.js 的 VOLATILE）—— 不搬的话这里声明了也白声明，
  // 前缀一变，缓存从那个字开始就断了。
  //
  // 短于模型的最小可缓存长度时，这个声明会被忽略，不报错也不多花钱。
  if (system) {
    body.system = cfg.cache
      ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
      : system;
  }
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
