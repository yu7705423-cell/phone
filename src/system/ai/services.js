import { settings } from '../db/index.js';
import { uid } from '../store.js';

// 服务配置。聊天与生图都是「预设列表 + 当前选中」，其余各只有一份。
export const EMPTY_SERVICES = {
  chat:  { presets: [], activeId: null, fallbackId: null },
  image: { presets: [], activeId: null },
  voice: { enabled: false, baseUrl: '', groupId: '', apiKey: '', model: '' },
  embed: { baseUrl: '', apiKey: '', model: '', dims: 0 },
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
  netease: { baseUrl: '', cookie: '', nickname: '', uid: '', sync: false, recentGap: 5 },
};

export function services() {
  const s = settings.get().services;
  return {
    chat:  { ...EMPTY_SERVICES.chat,  ...(s?.chat || {}) },
    image: { ...EMPTY_SERVICES.image, ...(s?.image || {}) },
    voice: { ...EMPTY_SERVICES.voice, ...(s?.voice || {}) },
    embed: { ...EMPTY_SERVICES.embed, ...(s?.embed || {}) },
    vision: { ...EMPTY_SERVICES.vision, ...(s?.vision || {}) },
    asr: { ...EMPTY_SERVICES.asr, ...(s?.asr || {}) },
    memory: { ...EMPTY_SERVICES.memory, ...(s?.memory || {}) },
    translate: { ...EMPTY_SERVICES.translate, ...(s?.translate || {}) },
    search: { ...EMPTY_SERVICES.search, ...(s?.search || {}) },
    netease: { ...EMPTY_SERVICES.netease, ...(s?.netease || {}) },
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

// ---- 向量（嵌入）。只有一份，走 OpenAI 兼容的 /v1/embeddings ----
export function embedConfig() { return services().embed; }
export function setEmbed(patch) { write({ embed: { ...services().embed, ...patch } }); }
export function embedReady() {
  const e = services().embed;
  return !!(e.apiKey && e.model);
}

// ---- 语音合成 ----
export function voiceConfig() { return services().voice; }
export function setVoice(patch) { write({ voice: { ...services().voice, ...patch } }); }

// ---- 识图。OpenAI 兼容的 chat/completions，带一个 image_url 内容块 ----
export function visionConfig() { return services().vision; }
export function setVision(patch) { write({ vision: { ...services().vision, ...patch } }); }
export function visionMode() {
  const m = services().vision.mode;
  return m === 'chat' || m === 'api' ? m : 'off';
}

// 单独那套识图接口配全了没有
export function visionReady() {
  const v = services().vision;
  return !!(v.apiKey && v.model);
}

// 图片到底能不能被看见
export function visionActive() {
  const m = visionMode();
  return m === 'chat' || (m === 'api' && visionReady());
}

// ---- 语音识别 ----
export function searchConfig() { return services().search; }
export function setSearch(patch) { write({ search: { ...services().search, ...patch } }); }
export function searchReady() {
  const v = services().search;
  return !!(v.apiKey && v.model);
}

export function neteaseConfig() { return services().netease; }
export function setNetease(patch) { write({ netease: { ...services().netease, ...patch } }); }
export function neteaseReady() { return !!services().netease.baseUrl; }
export function neteaseLoggedIn() { const n = services().netease; return !!(n.baseUrl && n.cookie); }

// ---- 记忆整理。单独配一套，不配就跟着副用走 ----
export function memoryConfig() { return services().memory; }
export function setMemory(patch) { write({ memory: { ...services().memory, ...patch } }); }

export function memoryFilled() {
  const m = services().memory;
  return !!(m.apiKey && m.model);
}

// 选了单独的接口却没填全，退回副用 —— 记忆整理停摆比慢一点糟得多
export function memoryMode() {
  return services().memory.mode === 'api' && memoryFilled() ? 'api' : 'spare';
}

// ---- 翻译。OpenAI 兼容的 chat/completions ----
export function translateConfig() { return services().translate; }
export function setTranslate(patch) { write({ translate: { ...services().translate, ...patch } }); }

// 配全了没有。没填全就算选了 api 也走不通，所以这两件事分开问。
export function translateFilled() {
  const t = services().translate;
  return !!(t.apiKey && t.model);
}

// 译文到底从哪儿来。选了 api 却没填全，仍然回落到跟着回复一起给出 ——
// 翻译开着却一条译文都没有，比慢一点糟得多。
export function translateMode() {
  const t = services().translate;
  return t.mode === 'api' && translateFilled() ? 'api' : 'inline';
}

export function asrConfig() { return services().asr; }
export function setAsr(patch) { write({ asr: { ...services().asr, ...patch } }); }
export function asrReady() {
  const a = services().asr;
  return !!(a.apiKey && a.model);
}

// 旧版把接口配置平铺在 settings 顶层，首次进入时收敛成一条预设
export function migrateLegacy() {
  const s = settings.get();
  if (s.services?.chat?.presets?.length) return;
  if (!s.apiKey) { settings.set({ services: services() }); return; }
  newChatPreset({
    name: s.provider === 'anthropic' ? 'Anthropic' : '自定义接口',
    provider: s.provider, baseUrl: s.baseUrl, apiKey: s.apiKey,
    model: s.model, effort: s.effort, temperature: s.temperature,
  });
}
