import { settings } from '../db/index.js';
import { uid } from '../store.js';

// 服务配置。聊天与生图都是「预设列表 + 当前选中」，语音只有一份。
export const EMPTY_SERVICES = {
  chat:  { presets: [], activeId: null, fallbackId: null },
  image: { presets: [], activeId: null },
  voice: { enabled: false, baseUrl: '', groupId: '', apiKey: '', model: '' },
};

export function services() {
  const s = settings.get().services;
  return {
    chat:  { ...EMPTY_SERVICES.chat,  ...(s?.chat || {}) },
    image: { ...EMPTY_SERVICES.image, ...(s?.image || {}) },
    voice: { ...EMPTY_SERVICES.voice, ...(s?.voice || {}) },
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
  return c.presets.find(p => p.id === c.activeId) || c.presets[0] || null;
}
export function fallbackChat() {
  const c = services().chat;
  if (!c.fallbackId || c.fallbackId === c.activeId) return null;
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

// ---- 语音 ----
export function voiceConfig() { return services().voice; }
export function setVoice(patch) { write({ voice: { ...services().voice, ...patch } }); }

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
