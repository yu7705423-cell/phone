import { baseOf } from './url.js';
import { voiceConfig } from './services.js';
import { enqueue } from './queue.js';
import { nfetch, routeOf, canNative, reachable } from '../net.js';
import * as script from './voicescript.js';

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

// ---- 语音模型从哪儿来 ----
//
// **`/v1/models` 回的是文本模型，不是语音模型。** 那个端点列的是这个账号能用的
// 聊天模型；语音合成走的是另一个端点（MiniMax 是 `/v1/t2a_v2`，OpenAI 兼容是
// `/audio/speech`），它们的模型名**不在那份列表里**。
//
// 从前「选择语音模型」不分家，一律去拉 `/v1/models` —— 于是 MiniMax 那边列出来
// 满屏 `MiniMax-Text-01`、`abab6.5s-chat`，挑哪个都合成不出声音，而界面上看不出
// 哪儿不对：名字是真的，接口也是真的，只是这批模型不会说话。
//
// 三家各有各的来源，所以分开：

/**
 * MiniMax 的语音模型。**它没有「列出语音模型」这个接口**，只能内置一份。
 *
 * 这是备选不是上限（CLAUDE.md 第 13 条）：新出的型号手填即可，不必等这张表更新。
 * 界面上要写清楚这份列表是内置的，免得新型号没列出来时以为是不支持。
 */
export const MINIMAX_MODELS = [
  'speech-2.5-hd-preview',
  'speech-2.5-turbo-preview',
  'speech-02-hd',
  'speech-02-turbo',
  'speech-01-hd',
  'speech-01-turbo',
  'speech-01-240228',
  'speech-01-turbo-240228',
];

// 一个模型名像不像是会说话的那种。OpenAI 兼容那一档的 `/models` 把几百个
// 模型混在一起回来，文本、向量、重排、生图都有，语音只占几条
const VOICEY = /(^|[-_./])(tts|speech|audio|voice|sovits|vits|t2a)/i;
export const looksLikeVoice = id => VOICEY.test(String(id || ''));

/**
 * 拉这一家的语音模型列表。
 *
 * 回的是 `{ list, from, all }`：
 *   list  这一家的语音模型
 *   all   接口回的全部（只有 openai 那一档有，界面上给一个「显示全部」）
 *   from  这份列表哪儿来的。**界面上要说出来** —— 内置的一份和接口拉回来的
 *         一份，可信程度不一样，而用户有权知道自己在看哪一种
 */
export async function fetchVoiceModels(v, signal) {
  const k = kindOf(v?.kind);

  if (k.id === 'minimax') {
    // 不发请求：那个账号有哪些语音模型，接口本来就不说
    return { list: MINIMAX_MODELS, all: [], from: 'builtin' };
  }

  if (!v?.apiKey) throw new Error('先填 API Key');

  if (k.id === 'eleven') {
    // 这一家有自己的列表接口，而且回的就是语音模型。鉴权走 xi-api-key
    const base = baseOf(v.baseUrl, k.base);
    const res = await ask(`${base}/v1/models`, {
      method: 'GET', signal, headers: { 'xi-api-key': v.apiKey },
    });
    const rows = await res.json();
    const list = (Array.isArray(rows) ? rows : rows?.models || [])
      // can_do_text_to_speech 没有这一项的按「能」算：少认一个总比多滤掉一个好
      .filter(m => m?.can_do_text_to_speech !== false)
      .map(m => m?.model_id || m?.id || m?.name)
      .filter(Boolean).map(String);
    return { list, all: [], from: 'api' };
  }

  // OpenAI 兼容：只有一份混在一起的总表，自己挑出像语音的那几条。
  // **挑剩下的不丢掉**，界面上给一个「显示全部」—— 中转站的命名千奇百怪，
  // 猜错了得有条路走回去（第 13 条）
  const base = baseOf(v.baseUrl, k.base);
  const url = /\/v\d+$/.test(base) ? `${base}/models` : `${base}/v1/models`;
  const res = await ask(url, {
    method: 'GET', signal, headers: { authorization: `Bearer ${v.apiKey}` },
  });
  const json = await res.json();
  const rows = json?.data || json?.models || (Array.isArray(json) ? json : []);
  const all = rows.map(m => (typeof m === 'string' ? m : m.id || m.model_id || m.name || m.model))
    .filter(Boolean).map(String);
  return { list: all.filter(looksLikeVoice), all, from: 'api' };
}

// ---- 语种 ----
//
// 各家收的写法不一样：MiniMax 要它自己那套英文名（language_boost），
// ElevenLabs 要 ISO 码（language_code），OpenAI 没有这个参数、只能写进说明里。
// 所以界面上给的是中文名，这张表负责翻成各家认的东西。
//
// **列表不是上限**（第 13 条）：填一个表里没有的，原样送给 MiniMax ——
// 它认的名字比这张表长，没道理拦着。
export const LANGS = [
  { id: '', label: '自动', mm: '', iso: '' },
  { id: 'zh', label: '中文', mm: 'Chinese', iso: 'zh' },
  { id: 'yue', label: '粤语', mm: 'Chinese,Yue', iso: 'zh' },
  { id: 'en', label: '英语', mm: 'English', iso: 'en' },
  { id: 'ja', label: '日语', mm: 'Japanese', iso: 'ja' },
  { id: 'ko', label: '韩语', mm: 'Korean', iso: 'ko' },
  { id: 'es', label: '西班牙语', mm: 'Spanish', iso: 'es' },
  { id: 'fr', label: '法语', mm: 'French', iso: 'fr' },
  { id: 'de', label: '德语', mm: 'German', iso: 'de' },
  { id: 'it', label: '意大利语', mm: 'Italian', iso: 'it' },
  { id: 'pt', label: '葡萄牙语', mm: 'Portuguese', iso: 'pt' },
  { id: 'ru', label: '俄语', mm: 'Russian', iso: 'ru' },
  { id: 'ar', label: '阿拉伯语', mm: 'Arabic', iso: 'ar' },
  { id: 'id', label: '印尼语', mm: 'Indonesian', iso: 'id' },
  { id: 'th', label: '泰语', mm: 'Thai', iso: 'th' },
  { id: 'vi', label: '越南语', mm: 'Vietnamese', iso: 'vi' },
];
export const langOf = v => LANGS.find(l => l.id === v || l.label === v) || null;

// MiniMax 的风格只收几个固定的值，不是自由文本。词表在 voicescript.js
//（台本的情绪标记用的是同一张），认得的才送；fluent 与 whisper 只有 2.6 认。
// 从前这里还有一个 neutral —— 它不在 MiniMax 的枚举里，填「中性」「平淡」
// 的人整个请求都被退回来。

/**
 * 这个角色该用什么风格、什么语种说话。
 *
 * 角色卡上填了就用角色卡的，没填就用「设置 - 语音」里那份全局的。
 * 这是第 5 条那张表的做法：跟角色绑死的放角色身上，全局的放设置里，
 * 两边不是二选一，是后者兜底。
 */
export function styleFor(char) {
  const v = voiceConfig();
  return {
    prompt: String(char?.voicePrompt || v.prompt || '').trim(),
    lang: String(char?.voiceLang || v.lang || '').trim(),
  };
}

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
async function minimax(v, { text, voiceId, speed, prompt, lang, signal }) {
  const base = baseOf(v.baseUrl, 'https://api.minimaxi.com');
  const q = v.groupId ? `?GroupId=${encodeURIComponent(v.groupId)}` : '';
  // 语种：表里有就翻成它认的英文名，表里没有就原样送 —— 它认的名字比那张表长
  const known = langOf(lang);
  const boost = known ? known.mm : String(lang || '').trim();
  const mood = script.mmEmotion(prompt, v.model);
  const res = await ask(`${base}/v1/t2a_v2${q}`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${v.apiKey}` },
    body: JSON.stringify({
      model: v.model, text, stream: false,
      voice_setting: {
        voice_id: voiceId || '', speed, vol: 1, pitch: 0,
        ...(mood ? { emotion: mood } : {}),
      },
      ...(boost ? { language_boost: boost } : {}),
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
async function openai(v, { text, voiceId, speed, prompt, lang, signal }) {
  const base = baseOf(v.baseUrl, 'https://api.openai.com/v1');
  const url = /\/v\d+$/.test(base) ? `${base}/audio/speech` : `${base}/v1/audio/speech`;
  // 这一家的风格是**自由文本**（instructions）。语种它没有单独的参数，
  // 所以拼进同一句里 —— 那本来就是一句给模型看的说明
  // 「自动」是「不指定」，不是一个语种名 —— 表里那一条的 id 是空的
  const known = langOf(lang);
  const name = known ? (known.id ? known.label : '') : String(lang || '').trim();
  const say = [prompt, name ? `用${name}朗读。` : ''].filter(Boolean).join(' ').trim();
  const res = await ask(url, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${v.apiKey}` },
    body: JSON.stringify({
      model: v.model, input: text,
      voice: voiceId || 'alloy', speed, response_format: 'mp3',
      ...(say ? { instructions: say } : {}),
    }),
  });
  return new Blob([await res.arrayBuffer()], { type: 'audio/mpeg' });
}

// ---- ElevenLabs ----
//
// POST {base}/v1/text-to-speech/{voiceId}，鉴权走 xi-api-key 这个自家的头，
// 不是 Bearer。同样直接回音频字节。
async function eleven(v, { text, voiceId, speed, lang, signal }) {
  const base = baseOf(v.baseUrl, 'https://api.elevenlabs.io');
  if (!voiceId) throw new Error('这一家要求填写音色 id');
  const res = await ask(`${base}/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'xi-api-key': v.apiKey },
    body: JSON.stringify({
      text,
      ...(v.model ? { model_id: v.model } : {}),
      // 这一家收的是 ISO 码，而且只有部分模型认。没有自由文本那种风格参数
      ...(langOf(lang)?.iso ? { language_code: langOf(lang).iso } : {}),
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed },
    }),
  });
  return new Blob([await res.arrayBuffer()], { type: 'audio/mpeg' });
}

const RUN = { minimax, openai, eleven };

/** 合成一段。回来的是一个可以直接播的 URL。 */
export function speak({ text, voiceId, speed = 1, prompt = '', lang = '', key }) {
  const v = voiceConfig();
  if (!v.apiKey) throw new Error('还没有配置语音接口');
  // 没指名道姓给风格和语种时，用全局那份 —— 试听、以及任何不带角色的调用
  // 都该和真正说话时是同一套，不然听到的和用到的不是一回事
  const style = { prompt: prompt || v.prompt || '', lang: lang || v.lang || '' };
  const kind = kindOf(v.kind).id;
  const run = RUN[kind];
  return enqueue(key || `tts:${Date.now()}`, async signal => {
    // 没有台本标记就是从前那一次请求，一个字都不变
    if (!script.hasTags(text)) {
      const blob = await run(v, { text, voiceId, speed, ...style, signal });
      return URL.createObjectURL(blob);
    }
    // 有标记：按情绪切段，一段一次，回来的音频按顺序接上（见 voicescript.js）
    const blobs = [];
    for (const seg of script.plan(kind, text, style.prompt, v.model)) {
      const segText = script.textFor(kind, seg, v.model);
      if (!segText) continue;
      // MiniMax 的情绪只认固定几个词，拿这一段的情绪词本身去认；
      // 别家收自由文本，这一段的情绪与角色卡那一份一起给
      const segPrompt = kind === 'minimax'
        ? (seg.mood || style.prompt)
        : [seg.mood && seg.mood !== style.prompt ? seg.mood : '', style.prompt].filter(Boolean).join('；');
      blobs.push(await run(v, { text: segText, voiceId, speed, prompt: segPrompt, lang: style.lang, signal }));
    }
    if (!blobs.length) throw new Error('台本里没有可念的内容');
    return URL.createObjectURL(new Blob(blobs, { type: blobs[0].type || 'audio/mpeg' }));
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
    if (!cant) {
      return { ...out, ok: false, step: '接口报错', detail: msg,
        hint: '已经连上了，是对方拒绝了这次请求。多半是密钥、模型名或音色 id 不对。' };
    }
    if (canNative()) {
      return { ...out, ok: false, step: '没连上', detail: msg,
        hint: '请求由外壳发出，与跨域无关。多半是地址填错或网络不通。' };
    }
    // 浏览器那句 Failed to fetch 三种情况共用，再问一次才分得清（见 net.js）
    const live = await reachable(base);
    return {
      ...out, ok: false,
      step: live ? '被跨域拦下' : '没连上',
      detail: msg,
      hint: live
        ? '服务器是通的，但它没有允许网页直接调用。'
          + '这一条我们改不了，需改填一个允许跨域的中转地址；安装为应用后由外壳发送则不受此限。'
        : '没有联系上这个地址。请检查地址是否填写正确、域名是否可解析、网络是否可达。',
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
