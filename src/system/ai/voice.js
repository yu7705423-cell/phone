import { baseOf } from './url.js';
import { voiceConfig } from './services.js';
import { enqueue } from './queue.js';
import { nfetch, routeOf, canNative } from '../net.js';

/**
 * 语音合成。
 *
 * ---- 为什么改成多家 ----
 *
 * 从前只有 MiniMax 一家，而且那一份是**照着「常见形态」猜着写的**，
 * 从没对过官方文档。两处猜错了：
 *
 *   一、默认地址写的是 `api.minimax.chat`。那个域名已经不是现在的接口地址了，
 *       现在按账号所在地分 `api.minimaxi.com`（国内）与 `api.minimax.io`（国际）。
 *       填了 key 也连不上，报的还是一个看不懂的网络错误。
 *   二、把 GroupId 当成必填。新版的 `sk-cp-` 开头那种 key 只用 Bearer 就够，
 *       GroupId 不再是必需的 —— 而这里没填 GroupId 就直接判定「没配置」，
 *       于是设置页上明明填满了，功能却是灰的。
 *
 * 这两条合起来，正是「我啥都写了但是连不上」。
 *
 * ---- 浏览器直连这件事 ----
 *
 * 这些接口未必允许网页直接调（跨域）。允不允许要看各家自己的响应头，
 * **我们这边改不了**。所以：地址一律可改（填中转站或自建代理即可），
 * 报错分清楚「根本没连上」和「连上了但接口报错」—— 这两种的下一步完全不同。
 */

// ---- 各家 ----

export const KINDS = [
  { id: 'minimax', label: 'MiniMax', base: 'https://api.minimaxi.com',
    needKey: true, needModel: true, hasGroup: true,
    note: '国内账号用 api.minimaxi.com，国际账号用 api.minimax.io。新版 key 不需要 GroupId。' },
  { id: 'openai', label: 'OpenAI 兼容', base: 'https://api.openai.com/v1',
    needKey: true, needModel: true, hasGroup: false,
    note: '走 /v1/audio/speech。OpenAI 本身、以及绝大多数中转站都是这一套。' },
  { id: 'eleven', label: 'ElevenLabs', base: 'https://api.elevenlabs.io',
    needKey: true, needModel: false, hasGroup: false,
    note: '音色填 voice id。模型留空则用该账号的默认模型。' },
];

export const kindOf = id => KINDS.find(k => k.id === id) || KINDS[0];

/** 配全了没有。**不把可选项算成必填** —— 那正是从前那个坑。 */
export function isVoiceReady() {
  const v = voiceConfig();
  const k = kindOf(v.kind);
  if (!v.enabled || !v.apiKey) return false;
  if (k.needModel && !v.model) return false;
  return true;
}

/**
 * 连不上和接口报错要分开说：前者查地址与网络，后者查 key 与参数。
 *
 * 装了 app 的话这一发是交给外壳的（见 system/net.js）—— 那条路没有跨域一说。
 * 所以连不上时该提示什么，要看这一次走的是哪条路，不能一律让人「改中转地址」。
 */
async function ask(url, init, opts) {
  let res;
  try {
    res = await nfetch(url, init, opts);
  } catch (err) {
    const native = routeOf(url) === 'native' && opts?.prefer !== 'direct';
    throw new Error(`连不上语音接口（${url}）。`
      + (native
        ? '本次请求已交由外壳发出，与跨域无关。请检查地址是否填写正确、网络是否可达。'
        : '请检查地址是否填写正确、网络是否可达。'
          + (canNative() ? '' : '若为浏览器拦下的跨域请求，需改填中转地址，或安装为应用后重试。'))
      + `原始错误：${err.message || err}`);
  }
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.clone().json();
      detail = j?.base_resp?.status_msg || j?.error?.message
        || j?.detail?.[0]?.msg || j?.detail || JSON.stringify(j).slice(0, 200);
    } catch { detail = (await res.text().catch(() => '')).slice(0, 200); }
    throw new Error(`语音接口 ${res.status}：${detail || res.statusText}`);
  }
  return res;
}

// ---- MiniMax ----
//
// POST {base}/v1/t2a_v2，Bearer 鉴权。填了 GroupId 就带上（老账号要），
// 没填就不带（新版 key 用不着）。回来的是十六进制串，不是二进制。
async function minimax(v, { text, voiceId, speed, signal }) {
  const base = baseOf(v.baseUrl, 'https://api.minimaxi.com');
  const q = v.groupId ? `?GroupId=${encodeURIComponent(v.groupId)}` : '';
  const res = await ask(`${base}/v1/t2a_v2${q}`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${v.apiKey}` },
    body: JSON.stringify({
      model: v.model, text, stream: false,
      voice_setting: { voice_id: voiceId || '', speed, vol: 1, pitch: 0 },
      audio_setting: { format: 'mp3', sample_rate: 32000 },
    }),
  });
  const j = await res.json();
  // 它的错是包在 200 里的，状态码看不出来
  if (j?.base_resp && j.base_resp.status_code !== 0) {
    throw new Error(`语音接口：${j.base_resp.status_msg || j.base_resp.status_code}`);
  }
  const hex = j?.data?.audio;
  if (!hex) throw new Error('接口没有返回音频数据');
  return hexToBlob(hex);
}

// ---- OpenAI 兼容 ----
//
// POST {base}/audio/speech，回来的直接就是音频字节。中转站基本都实现了这个。
async function openai(v, { text, voiceId, speed, signal }) {
  const base = baseOf(v.baseUrl, 'https://api.openai.com/v1');
  const url = /\/v\d+$/.test(base) ? `${base}/audio/speech` : `${base}/v1/audio/speech`;
  const res = await ask(url, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${v.apiKey}` },
    body: JSON.stringify({
      model: v.model, input: text,
      voice: voiceId || 'alloy', speed, response_format: 'mp3',
    }),
  });
  return new Blob([await res.arrayBuffer()], { type: 'audio/mpeg' });
}

// ---- ElevenLabs ----
//
// POST {base}/v1/text-to-speech/{voiceId}，鉴权走 xi-api-key 这个自家的头，
// 不是 Bearer。同样直接回音频字节。
async function eleven(v, { text, voiceId, speed, signal }) {
  const base = baseOf(v.baseUrl, 'https://api.elevenlabs.io');
  if (!voiceId) throw new Error('这一家要求填写音色 id');
  const res = await ask(`${base}/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'xi-api-key': v.apiKey },
    body: JSON.stringify({
      text,
      ...(v.model ? { model_id: v.model } : {}),
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed },
    }),
  });
  return new Blob([await res.arrayBuffer()], { type: 'audio/mpeg' });
}

const RUN = { minimax, openai, eleven };

/** 合成一段。回来的是一个可以直接播的 URL。 */
export function speak({ text, voiceId, speed = 1, key }) {
  const v = voiceConfig();
  if (!v.apiKey) throw new Error('还没有配置语音接口');
  const run = RUN[kindOf(v.kind).id];
  return enqueue(key || `tts:${Date.now()}`, async signal => {
    const blob = await run(v, { text, voiceId, speed, signal });
    return URL.createObjectURL(blob);
  }, { retries: 0 });
}

/**
 * 连一次看看，把发生了什么原样说出来。
 *
 * 「试听」只能告诉你成没成，成不了的时候它说不出卡在哪一步。这里分四件事报：
 * 走的哪条路、有没有连上、对方回的什么状态、音频取到没有 —— 每一步都可能单独
 * 坏掉，而每一步的下一步都不一样。
 */
export async function testVoice() {
  const v = voiceConfig();
  const k = kindOf(v.kind);
  const base = baseOf(v.baseUrl, k.base);
  const out = { kind: k.label, base, route: canNative() ? '外壳转发' : '浏览器直连' };

  if (!v.apiKey) return { ...out, ok: false, step: '没填密钥', hint: '先填 API Key。' };
  if (k.needModel && !v.model) return { ...out, ok: false, step: '没填模型', hint: `${k.label} 需要填写模型名称。` };

  try {
    const url = await speak({ text: '测试。', voiceId: v.testVoiceId || '', key: `voice:test:${Date.now()}` });
    URL.revokeObjectURL(url);
    return { ...out, ok: true, step: '连通', hint: '接口可用，已取回音频。' };
  } catch (err) {
    const msg = String(err.message || err);
    const cant = /连不上语音接口/.test(msg);
    return {
      ...out, ok: false,
      step: cant ? '没连上' : '接口报错',
      detail: msg,
      hint: cant
        ? (canNative()
          ? '请求由外壳发出，与跨域无关。多半是地址填错或网络不通。'
          : '浏览器可能拦下了跨域请求。可改填中转地址，或安装为应用后重试。')
        : '已经连上了，是对方拒绝了这次请求。多半是密钥、模型名或音色 id 不对。',
    };
  }
}

function hexToBlob(hex) {
  const clean = String(hex).trim();
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  return new Blob([bytes], { type: 'audio/mpeg' });
}

let current = null;
export function play(url) {
  stop();
  current = new Audio(url);
  current.play().catch(() => {});
  return current;
}
export function stop() {
  if (current) { current.pause(); current = null; }
}
