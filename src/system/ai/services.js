import { settings } from '../db/index.js';
import { uid } from '../store.js';

// 服务配置。聊天与生图都是「预设列表 + 当前选中」，其余各只有一份。
export const EMPTY_SERVICES = {
  chat:  { presets: [], activeId: null, fallbackId: null },
  image: { presets: [], activeId: null },
  voice: { enabled: false, baseUrl: '', groupId: '', apiKey: '', model: '' },
  embed: { baseUrl: '', apiKey: '', model: '', dims: 0 },
  // 识图：把用户发的图片读成文字，角色才看得见
  vision: { baseUrl: '', apiKey: '', model: '' },
  // 语音识别：把用户发的语音读成文字。mode 决定只转文字还是连语气一起读
  asr: { baseUrl: '', apiKey: '', model: '', mode: 'text' },
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
export function visionReady() {
  const v = services().vision;
  return !!(v.apiKey && v.model);
}

// ---- 语音识别 ----
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
