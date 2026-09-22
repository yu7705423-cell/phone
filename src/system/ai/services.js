import { settings } from '../db/index.js';
import { uid } from '../store.js';

// 服务配置。聊天与生图都是「预设列表 + 当前选中」，其余各只有一份。
export const EMPTY_SERVICES = {
  chat:  { presets: [], activeId: null, fallbackId: null },
  image: { presets: [], activeId: null },
  voice: { enabled: false, kind: 'minimax', baseUrl: '', groupId: '', apiKey: '', model: '',
    lang: '', prompt: '' },
  embed: { baseUrl: '', apiKey: '', model: '', dims: 0 },
  // 重排。向量粗筛出一批候选之后，再让它按相关度排一遍。
  // 每轮多一次请求，所以整项默认关着（rerankOn，见 ai/cost.js）
  rerank: { baseUrl: '', apiKey: '', model: '' },
  // 识图。mode 决定图片怎么让角色看见：
  //   off   不识别，角色只知道你发了一张图
  //   chat  直接把图交给聊天模型（它自己能看图的话，不必再配一套接口）
  //   api   交给下面这套单独的识图接口
  vision: { mode: 'off', baseUrl: '', apiKey: '', model: '' },
  // 语音识别：把用户发的语音读成文字。mode 决定只转文字还是连语气一起读
  asr: { baseUrl: '', apiKey: '', model: '', mode: 'text' },
  // 记忆整理那几件（提取、压底色、导入、压缩历史）单独用哪套接口。
  //   spare  跟着别的后台活儿一起走副用（默认）
  //   api    下面这套单独的
  memory: { mode: 'spare', provider: 'openai', baseUrl: '', apiKey: '', model: '' },
  // 翻译。mode 决定译文从哪儿来：
  //   inline  跟着聊天回复一起给出，不额外调用接口（没配的时候就是这一档）
  //   api     单独调这套接口。只送原文与翻译规则，人设、记忆、对话历史一概不送
  translate: { mode: 'inline', provider: 'openai', baseUrl: '', apiKey: '', model: '' },
  // 会联网搜索的那套接口。和聊天预设是同一种形状，区别只在模型本身能不能上网。
  // 配了它，生成食谱时才问得出「这个地方真的有哪几家店」。
  search: { provider: 'openai', baseUrl: '', apiKey: '', model: '' },
  // 网易云。baseUrl 指向自己部署的那个 NeteaseCloudMusicApi，
  // cookie 是登录后拿到的凭据 —— 它等于账号权限，只存在这台设备的浏览器里。
  // recentGap：发消息时顺便拉一次角色听歌记录的最小间隔，分钟。0 为只手动拉
  // realIP：接口转交网易云当作请求来源。境外 IP 会被风控拦下（code -462），
  //   填一个中国大陆 IP 就绕开了。留空则不带。
  netease: { baseUrl: '', realIP: '', cookie: '', nickname: '', uid: '', sync: false, recentGap: 5 },
  // 书目。只查书名作者封面这类元数据，不碰书的文件。两家都不要密钥
  books: { provider: '', apiKey: '' },
  // 自建的接口来源。除聊天与生图之外那几套服务都只要「地址 + 密钥 + 模型」，
  // 同一个中转站要在五六个页面各填一遍。存在这儿，各服务用 endpointId 指过来。
  // 也可以直接指一个聊天预设的 id —— 两边共用一个 id 空间，见 sourceOf。
  endpoints: [],
};

export function services() {
  const s = settings.get().services;
  return {
    chat:  { ...EMPTY_SERVICES.chat,  ...(s?.chat || {}) },
    image: { ...EMPTY_SERVICES.image, ...(s?.image || {}) },
    voice: { ...EMPTY_SERVICES.voice, ...(s?.voice || {}) },
    embed: { ...EMPTY_SERVICES.embed, ...(s?.embed || {}) },
    rerank: { ...EMPTY_SERVICES.rerank, ...(s?.rerank || {}) },
    vision: { ...EMPTY_SERVICES.vision, ...(s?.vision || {}) },
    asr: { ...EMPTY_SERVICES.asr, ...(s?.asr || {}) },
    memory: { ...EMPTY_SERVICES.memory, ...(s?.memory || {}) },
    translate: { ...EMPTY_SERVICES.translate, ...(s?.translate || {}) },
    search: { ...EMPTY_SERVICES.search, ...(s?.search || {}) },
    netease: { ...EMPTY_SERVICES.netease, ...(s?.netease || {}) },
    books: { ...EMPTY_SERVICES.books, ...(s?.books || {}) },
    endpoints: Array.isArray(s?.endpoints) ? s.endpoints : [],
  };
}

function write(patch) {
  const cur = services();
  settings.set({ services: { ...cur, ...patch } });
}

// ---- 聊天预设 ----
export function chatPresets() { return services().chat.presets; }
export function activeChat() {
  const c = services().chat;
  // activeId 是 null 表示用户主动关掉了主用，别自作主张顶一个上来。
  // 只有从来没设过（undefined）才回落到第一条，兼容老数据。
  if (c.activeId === null) return null;
  return c.presets.find(p => p.id === c.activeId) || c.presets[0] || null;
}
// 主用和副用允许是同一个 —— 有人就只有一个中转站，也想让后台活儿走它
export function fallbackChat() {
  const c = services().chat;
  if (!c.fallbackId) return null;
  return c.presets.find(p => p.id === c.fallbackId) || null;
}

export function newChatPreset(init = {}) {
  const c = services().chat;
  const preset = {
    id: uid('svc'),
    name: init.name || '未命名',
    provider: init.provider || 'anthropic',
    baseUrl: '', apiKey: '', model: '',
    effort: 'low', temperature: 0.9,
    ...init,
  };
  write({ chat: { ...c, presets: [...c.presets, preset], activeId: c.activeId || preset.id } });
  return preset;
}

export function updateChatPreset(id, patch) {
  const c = services().chat;
  write({ chat: { ...c, presets: c.presets.map(p => p.id === id ? { ...p, ...patch } : p) } });
}

export function removeChatPreset(id) {
  const c = services().chat;
  const presets = c.presets.filter(p => p.id !== id);
  write({ chat: {
    ...c, presets,
    activeId: c.activeId === id ? (presets[0]?.id || null) : c.activeId,
    fallbackId: c.fallbackId === id ? null : c.fallbackId,
  } });
}

export function setActiveChat(id) { write({ chat: { ...services().chat, activeId: id } }); }
export function setFallbackChat(id) { write({ chat: { ...services().chat, fallbackId: id } }); }

// ---- 生图预设 ----
export function imagePresets() { return services().image.presets; }
export function activeImage() {
  const i = services().image;
  return i.presets.find(p => p.id === i.activeId) || i.presets[0] || null;
}
export function newImagePreset(init = {}) {
  const i = services().image;
  const preset = {
    id: uid('img'),
    name: init.name || '未命名',
    kind: init.kind || 'openai',       // openai | relay
    baseUrl: '', apiKey: '', model: '', size: '1024x1024',
    respFormat: '',                    // 见 ai/image.js 的 FORMATS。空字符串 = 不发这个字段
    // 等多久算超时，秒。生图一张跑一两分钟是常事，所以默认给得宽
    // （CLAUDE.md 第 13 条：能力不设上限，填 0 就是一直等）
    timeout: 300,
    ...init,
  };
  write({ image: { ...i, presets: [...i.presets, preset], activeId: i.activeId || preset.id } });
  return preset;
}
export function updateImagePreset(id, patch) {
  const i = services().image;
  write({ image: { ...i, presets: i.presets.map(p => p.id === id ? { ...p, ...patch } : p) } });
}
export function removeImagePreset(id) {
  const i = services().image;
  const presets = i.presets.filter(p => p.id !== id);
  write({ image: { ...i, presets, activeId: i.activeId === id ? (presets[0]?.id || null) : i.activeId } });
}
export function setActiveImage(id) { write({ image: { ...services().image, activeId: id } }); }

// ---- 接口来源 ----
//
// 向量、重排、识图、语音识别、记忆、翻译、联网搜索这七套，形状都是
// 「地址 + 密钥 + 模型」。同一个中转站要在七个页面各填一遍地址和密钥，
// 改一次密钥还要再改七遍。
//
// 所以各服务可以只记一个 endpointId，地址与密钥从来源上取：
//   来源可以是一条**自建的接口**（下面这份清单），
//   也可以是一个**聊天预设** —— 多数人的中转站本来就是同一个。
// 两边共用一个 id 空间，先查自建的再查聊天预设。
//
// endpointId 留空就是老样子：这个服务自己填的地址与密钥。
// 指向的那条被删掉时也退回自己填的，不至于整套服务突然不通。

export function endpoints() { return services().endpoints; }

export function addEndpoint(init = {}) {
  const row = {
    id: uid('ep'),
    name: init.name || '未命名',
    baseUrl: (init.baseUrl || '').trim(),
    apiKey: (init.apiKey || '').trim(),
  };
  write({ endpoints: [...endpoints(), row] });
  return row;
}

export function updateEndpoint(id, patch) {
  write({ endpoints: endpoints().map(e => e.id === id ? { ...e, ...patch } : e) });
}

export function removeEndpoint(id) {
  write({ endpoints: endpoints().filter(e => e.id !== id) });
}

/** 这个 id 指的是哪一条。自建的优先，然后才是聊天预设。找不到返回 null。 */
export function sourceOf(id) {
  if (!id) return null;
  const own = endpoints().find(e => e.id === id);
  if (own) return { ...own, kind: 'own' };
  const p = services().chat.presets.find(x => x.id === id);
  if (p) return { id: p.id, name: p.name, baseUrl: p.baseUrl, apiKey: p.apiKey, kind: 'chat' };
  return null;
}

/** 把来源上的地址与密钥盖上去。模型名始终是这个服务自己的。 */
function resolved(cfg) {
  const src = sourceOf(cfg.endpointId);
  return src ? { ...cfg, baseUrl: src.baseUrl, apiKey: src.apiKey } : cfg;
}

// ---- 向量（嵌入）。只有一份，走 OpenAI 兼容的 /v1/embeddings ----
export function rerankConfig() { return resolved(services().rerank); }
export function setRerank(patch) { write({ rerank: { ...services().rerank, ...patch } }); }
export function rerankReady() {
  const r = rerankConfig();
  return !!(r.baseUrl && r.apiKey && r.model);
}

export function embedConfig() { return resolved(services().embed); }
export function setEmbed(patch) { write({ embed: { ...services().embed, ...patch } }); }
export function embedReady() {
  const e = embedConfig();
  return !!(e.apiKey && e.model);
}

// ---- 语音合成 ----
export function voiceConfig() { return services().voice; }
export function setVoice(patch) { write({ voice: { ...services().voice, ...patch } }); }

// ---- 识图。OpenAI 兼容的 chat/completions，带一个 image_url 内容块 ----
export function visionConfig() { return resolved(services().vision); }
export function setVision(patch) { write({ vision: { ...services().vision, ...patch } }); }
export function visionMode() {
  const m = services().vision.mode;
  return m === 'chat' || m === 'api' ? m : 'off';
}

// 单独那套识图接口配全了没有
export function visionReady() {
  const v = visionConfig();
  return !!(v.apiKey && v.model);
}

// 图片到底能不能被看见
export function visionActive() {
  const m = visionMode();
  return m === 'chat' || (m === 'api' && visionReady());
}

// ---- 语音识别 ----
export function searchConfig() { return resolved(services().search); }
export function setSearch(patch) { write({ search: { ...services().search, ...patch } }); }
export function searchReady() {
  const v = searchConfig();
  return !!(v.apiKey && v.model);
}

export function neteaseConfig() { return services().netease; }
export function setNetease(patch) { write({ netease: { ...services().netease, ...patch } }); }
export function neteaseReady() { return !!services().netease.baseUrl; }
export function neteaseLoggedIn() { const n = services().netease; return !!(n.baseUrl && n.cookie); }

// ---- 记忆整理。单独配一套，不配就跟着副用走 ----
export function memoryConfig() { return resolved(services().memory); }
export function setMemory(patch) { write({ memory: { ...services().memory, ...patch } }); }

export function memoryFilled() {
  const m = memoryConfig();
  return !!(m.apiKey && m.model);
}

// 选了单独的接口却没填全，退回副用 —— 记忆整理停摆比慢一点糟得多
export function memoryMode() {
  return services().memory.mode === 'api' && memoryFilled() ? 'api' : 'spare';
}

// ---- 翻译。OpenAI 兼容的 chat/completions ----
export function translateConfig() { return resolved(services().translate); }
export function setTranslate(patch) { write({ translate: { ...services().translate, ...patch } }); }

// 配全了没有。没填全就算选了 api 也走不通，所以这两件事分开问。
export function translateFilled() {
  const t = translateConfig();
  return !!(t.apiKey && t.model);
}

// 译文到底从哪儿来。选了 api 却没填全，仍然回落到跟着回复一起给出 ——
// 翻译开着却一条译文都没有，比慢一点糟得多。
export function translateMode() {
  const t = services().translate;
  return t.mode === 'api' && translateFilled() ? 'api' : 'inline';
}

export function asrConfig() { return resolved(services().asr); }
export function setAsr(patch) { write({ asr: { ...services().asr, ...patch } }); }
export function asrReady() {
  const a = asrConfig();
  return !!(a.apiKey && a.model);
}

// 旧版把接口配置平铺在 settings 顶层，首次进入时收敛成一条预设
export function migrateLegacy() {
  // **库里没读到 settings 这一条就什么都不要写。** 开机时叫这个，而
  // makeKV.load() 读不到会回落成默认值 —— 那时候 apiKey 是空的、presets 也是空的，
  // 正好命中下面那两条，于是把一份默认 settings 盖回库里，自定义图标、接口配置
  // 一起没了。这一次没读到不等于用户没设置过，见 ARCHITECTURE 4.124
  if (!settings.stored()) return;
  const s = settings.get();
  if (s.services?.chat?.presets?.length) return;
  if (!s.apiKey) { settings.set({ services: services() }); return; }
  newChatPreset({
    name: s.provider === 'anthropic' ? 'Anthropic' : '自定义接口',
    provider: s.provider, baseUrl: s.baseUrl, apiKey: s.apiKey,
    model: s.model, effort: s.effort, temperature: s.temperature,
  });
}

export function setBooks(patch) { write({ books: { ...services().books, ...patch } }); }
