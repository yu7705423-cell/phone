import { settings } from './db/index.js';
import { files } from './db/files.js';

// 提示音。不放音频文件进仓库（无构建，不想为几个叮咚拖二进制），
// 预设一律用 WebAudio 现场合成；想要真实录音就自己传一个，存进 files 域。

// iOS 上 AudioContext 必须由一次真实触摸唤醒，否则永远是 suspended。
// 这里在第一次触摸/点击时解锁一次，之后就能随时出声。
let ctx = null;
let unlocked = false;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function unlock() {
  if (unlocked) return;
  unlocked = true;
  const c = audio();
  if (!c) return;
  // 放一段无声，把输出通道真正打开
  const b = c.createBuffer(1, 1, 22050);
  const src = c.createBufferSource();
  src.buffer = b;
  src.connect(c.destination);
  src.start(0);
}

export function installUnlock() {
  const once = () => unlock();
  window.addEventListener('touchend', once, { once: true, passive: true });
  window.addEventListener('mousedown', once, { once: true });
  window.addEventListener('keydown', once, { once: true });
}

// 一个音：频率、起点、时长、音量、波形
function tone(c, out, { freq, at, dur, gain = 1, type = 'sine', to }) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, at + dur);
  // 短促起音 + 指数衰减，听起来才像敲出来的，不像蜂鸣器
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g); g.connect(out);
  osc.start(at); osc.stop(at + dur + 0.02);
}

export const PRESETS = [
  { id: 'ding',   label: '清脆' },
  { id: 'drop',   label: '水滴' },
  { id: 'wood',   label: '木鱼' },
  { id: 'bell',   label: '风铃' },
  { id: 'pop',    label: '气泡' },
  { id: 'none',   label: '静音' },
];

function play(id, volume) {
  const c = audio();
  if (!c || id === 'none') return;
  const out = c.createGain();
  out.gain.value = Math.max(0, Math.min(1, volume));
  out.connect(c.destination);
  const t = c.currentTime + 0.01;

  if (id === 'drop') {
    tone(c, out, { freq: 900, to: 420, at: t, dur: 0.16, gain: 0.5 });
    tone(c, out, { freq: 1500, to: 900, at: t + 0.02, dur: 0.1, gain: 0.16 });
  } else if (id === 'wood') {
    tone(c, out, { freq: 420, to: 190, at: t, dur: 0.1, gain: 0.55, type: 'triangle' });
    tone(c, out, { freq: 1100, at: t, dur: 0.035, gain: 0.2, type: 'square' });
  } else if (id === 'bell') {
    [1318.5, 1760, 2637].forEach((f, i) =>
      tone(c, out, { freq: f, at: t + i * 0.055, dur: 0.85 - i * 0.2, gain: 0.26 - i * 0.06 }));
  } else if (id === 'pop') {
    tone(c, out, { freq: 260, to: 1000, at: t, dur: 0.07, gain: 0.5, type: 'triangle' });
  } else {
    // ding：两声清脆的上行，最常见的那种消息音
    tone(c, out, { freq: 1244.5, at: t, dur: 0.16, gain: 0.34 });
    tone(c, out, { freq: 1661.2, at: t + 0.085, dur: 0.3, gain: 0.3 });
  }
}

let el = null;
async function playFile(fileId, volume) {
  const url = await files.url(fileId);
  if (!url) return;
  if (!el) el = new Audio();
  el.src = url;
  el.volume = Math.max(0, Math.min(1, volume));
  el.currentTime = 0;
  try { await el.play(); } catch { /* 没解锁就算了，不该为了一声提示音报错 */ }
}

export function config() {
  const s = settings.get().notify || {};
  return {
    banner: s.banner !== false,
    sound: s.sound || 'ding',
    soundFileId: s.soundFileId || null,
    volume: typeof s.volume === 'number' ? s.volume : 0.7,
  };
}

// 响一声。cfg 传进来是为了「试听」能用还没保存的设置
export function ring(cfg = config()) {
  if (cfg.soundFileId) return playFile(cfg.soundFileId, cfg.volume);
  play(cfg.sound, cfg.volume);
}

/**
 * 解锁一枚互动标识时的那一声：四个音往上走。跟着通知音量，通知音关着就不响
 *（见 system/badges.js）。
 */
export function chime(volume = config().volume) {
  const c = audio();
  if (!c || !(volume > 0)) return;
  const out = c.createGain();
  out.gain.value = Math.min(1, volume) * 0.5;
  out.connect(c.destination);
  const at = c.currentTime + 0.02;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
    tone(c, out, { freq: f, at: at + i * 0.09, dur: 0.5, gain: 0.8 - i * 0.12 }));
}
