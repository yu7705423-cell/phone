import { createStore } from './store.js';
import { settings } from './db/index.js';
import { call, duration } from './call.js';
import { shellApi } from './shellapi.js';

// 通话的桌面悬浮窗：离开 Eira 之后，通话仍以一个小窗浮在桌面与别的应用上面（ARCHITECTURE 4.223）。
//
// 应用内的悬浮球（CallLayer 的 CallBall）只管 Eira 自己这块屏幕。出了 Eira，网页画不了东西，
// 只能借系统的两条路：
//
//   安卓 app（外壳带 EiraNative.setFloat）：系统的「显示在其他应用上层」权限。
//     由外壳画一个原生小窗，只在 Eira 退到后台时出现，回到 Eira 就收起（见 android/.../CallFloat.kt）。
//     这里只负责把「谁、通了多久、刚说到哪句」按时交过去。开没开记在 settings.callDesk。
//
//   iPhone app（外壳注入 phoneCallFloat，消息通道 callfloat）：iOS 不许画在别的应用上面，
//     只有系统画中画。由外壳把同样那几样画成视频帧弹成小窗（见 ios/Sources/CallFloatBridge.swift）。
//     点了才弹，和浏览器那条一样；状态每有变化就交过去，外壳回一句小窗还在不在。
//
//   浏览器与 PWA：系统画中画。画中画只认 <video>，所以拿一块 canvas 画出头像、名字、时长与
//     最近一句，captureStream 成视频流塞进一个藏起来的 <video>，再请系统把它弹成小窗。
//     进画中画必须发生在点击的那一刻，所以视频在通话一开始就备好（prepare），按钮里同步调用。
//
// 哪条都没有（旧版的 app 外壳、不支持画中画的浏览器）就不给按钮。
//
// **小窗里只能看，不能说。** 回到 Eira 才能打字或开麦克风：系统不许后台的网页用麦克风，
// 安卓 11 以后原生应用在后台也一样。角色说的话照常进字幕、照常出声。

export const desk = createStore({ pip: false });

const native = () => (typeof shellApi()?.setFloat === 'function' ? shellApi() : null);

const iosFloat = () => (typeof window !== 'undefined' && window.phoneCallFloat === true
  && window.webkit?.messageHandlers?.callfloat) || null;

const pipOk = () => typeof document !== 'undefined'
  && document.pictureInPictureEnabled === true
  && typeof HTMLVideoElement !== 'undefined'
  && typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function'
  && typeof HTMLCanvasElement !== 'undefined'
  && typeof HTMLCanvasElement.prototype.captureStream === 'function';

/** 'native' 安卓外壳的悬浮窗 | 'ios' iPhone 外壳的画中画 | 'pip' 浏览器的画中画 | '' 都没有 */
export function kind() {
  if (native()) return 'native';
  if (iosFloat()) return 'ios';
  if (pipOk()) return 'pip';
  return '';
}

/** 安卓：开没开（记住的选择） */
export const nativeOn = () => settings.get().callDesk === true;

/** 安卓：系统那边给没给「显示在其他应用上层」 */
export function nativeAllowed() {
  const n = native();
  try { return !!(n && n.floatAllowed()); } catch { return false; }
}

/**
 * 安卓：开 / 关。开的时候还没有权限，就把人带到系统设置那一页，先不记为开 ——
 * 记成开却画不出来，按钮亮着、桌面上什么都没有，没人知道为什么。
 * 回来是 'asked' | 'on' | 'off'
 */
export function toggleNative() {
  const n = native();
  if (!n) return 'off';
  if (nativeOn()) {
    settings.set({ callDesk: false });
    try { n.setFloat(JSON.stringify({ on: false })); } catch { /* 外壳没接住也不要紧 */ }
    return 'off';
  }
  if (!nativeAllowed()) {
    try { n.askFloat(); } catch { /* */ }
    return 'asked';
  }
  settings.set({ callDesk: true });
  sentImage = '';
  return 'on';
}

// ---- 喂给画面的那几样 ----

// 头像压成小图。安卓那边要 dataURL（跨进程传 blob: 地址没用），画中画要一张画得上去的 <img>
const imgCache = new Map();
function loadImage(src) {
  if (!src) return Promise.resolve(null);
  if (imgCache.has(src)) return imgCache.get(src);
  const p = new Promise(resolve => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
  imgCache.set(src, p);
  return p;
}

async function smallDataUrl(src, size = 160) {
  const im = await loadImage(src);
  if (!im || !im.naturalWidth) return '';
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  if (!ctx) return '';
  cover(ctx, im, 0, 0, size, size);
  try { return cv.toDataURL('image/jpeg', 0.8); } catch { return ''; }
}

function cover(ctx, im, x, y, w, h) {
  const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
  if (!iw || !ih) return;
  const k = Math.max(w / iw, h / ih);
  const sw = w / k, sh = h / k;
  ctx.drawImage(im, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

/** 小窗上那一行：对方正在说的半句，没有就是最近一句 */
export function lastLine(s) {
  if (s.draft) return s.draft;
  const l = (s.lines || [])[s.lines.length - 1];
  return l ? l.text : '';
}

export function statusOf(s) {
  if (s.phase === 'dialing') return '正在呼叫';
  if (s.phase === 'ringing') return '来电';
  return duration(s.seconds);
}

// ---- app 外壳（安卓、iPhone） ----

let info = { name: '', image: '', video: false };
let sentImage = '';
let lastFeed = 0;
let feedTimer = null;

// 交给外壳。iPhone 那边回一句小窗还在不在：用户在小窗上点了关闭，这边靠它知道
function send(msg) {
  const n = native();
  if (n) { try { n.setFloat(JSON.stringify(msg)); } catch { /* 外壳没接住也不要紧 */ } return; }
  const h = iosFloat();
  if (!h) return;
  Promise.resolve(h.postMessage({ action: 'set', ...msg }))
    .then(r => { if (r && typeof r.pip === 'boolean' && r.pip !== desk.get().pip) desk.set({ pip: r.pip }); })
    .catch(() => {});
}

function feedNative() {
  const k = kind();
  if (k !== 'native' && k !== 'ios') return;
  const s = call.get();
  const live = s.phase === 'dialing' || s.phase === 'active';
  // 安卓要开着才送（它退到后台自己弹）；iPhone 一直送，点按钮那一刻画面得是现成的
  if (!live || (k === 'native' && !nativeOn())) {
    send({ on: false });
    sentImage = '';
    return;
  }
  const msg = { on: true, title: info.name || '通话', status: statusOf(s), line: lastLine(s), video: !!info.video };
  // 图片只在换了的时候带一次，每秒塞一张 base64 过桥不值得
  const want = info.image || '';
  if (want !== sentImage) {
    smallDataUrl(want).then(url => {
      sentImage = want;
      send({ ...msg, image: url || '' });
    });
    return;
  }
  send(msg);
}

// 字幕是一个字一个字流进来的，每一下都过一次桥太密。最多半秒一次，末尾那一下一定送到
function scheduleNative() {
  const wait = 500 - (Date.now() - lastFeed);
  if (wait <= 0) { lastFeed = Date.now(); feedNative(); return; }
  if (feedTimer) return;
  feedTimer = setTimeout(() => { feedTimer = null; lastFeed = Date.now(); feedNative(); }, wait);
}

// ---- 画中画 ----

const W = 480, H = 360;
let pip = null;        // { canvas, ctx, video, timer }

function token(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch { return fallback; }
}

function wrap(ctx, text, maxWidth, maxLines) {
  const out = [];
  let cur = '';
  for (const ch of String(text || '')) {
    if (ch === '\n') { out.push(cur); cur = ''; continue; }
    if (ctx.measureText(cur + ch).width > maxWidth && cur) { out.push(cur); cur = ch; }
    else cur += ch;
  }
  if (cur) out.push(cur);
  // 只留最后几行：字幕往上走，最新的在最下面
  return out.slice(-maxLines);
}

async function draw() {
  if (!pip) return;
  const { ctx } = pip;
  const s = call.get();
  const font = token('--font', 'sans-serif');
  const im = await loadImage(info.image);
  if (!pip) return;
  const video = info.video && im;
  const bg = token('--bg', 'white');
  const fg = video ? token('--on-scrim', 'white') : token('--text', 'black');
  const dim = video ? token('--on-scrim', 'white') : token('--text-3', 'gray');

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  if (video) {
    cover(ctx, im, 0, 0, W, H);
    ctx.fillStyle = token('--scrim-strong', 'black');
    ctx.fillRect(0, 0, W, H);
  } else {
    const r = 58, cx = W / 2, cy = 30 + r;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath();
    if (im) { ctx.clip(); cover(ctx, im, cx - r, cy - r, r * 2, r * 2); }
    else {
      ctx.fillStyle = token('--group-fill', 'lightgray'); ctx.fill();
      ctx.fillStyle = fg; ctx.font = `500 44px ${font}`; ctx.textBaseline = 'middle';
      ctx.fillText((info.name || '').slice(0, 1), cx, cy);
      ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
  }

  const top = video ? 70 : 186;
  ctx.fillStyle = fg;
  ctx.font = `500 28px ${font}`;
  ctx.fillText(info.name || '通话', W / 2, top + 28);
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = dim;
  ctx.font = `22px ${font}`;
  ctx.fillText(statusOf(s), W / 2, top + 62);
  ctx.globalAlpha = 1;

  ctx.fillStyle = fg;
  ctx.font = `22px ${font}`;
  const lines = wrap(ctx, lastLine(s), W - 56, video ? 4 : 2);
  lines.forEach((t, i) => ctx.fillText(t, W / 2, top + 106 + i * 32));
}

/**
 * 通话一开始就备好画中画要用的那段视频：进画中画必须在点击那一刻同步调用，
 * 到时候再建视频、等它出第一帧，点击的那点「用户手势」早就过期了
 */
export function prepare(next) {
  info = { ...info, ...next };
  if (kind() === 'native' || kind() === 'ios') { scheduleNative(); return; }
  if (!pipOk() || pip) { if (pip) draw(); return; }
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.className = 'pip-source';
  video.srcObject = canvas.captureStream();
  document.body.appendChild(video);
  video.addEventListener('leavepictureinpicture', () => {
    desk.set({ pip: false });
    if (pip) { clearInterval(pip.timer); pip.timer = null; }
  });
  pip = { canvas, ctx, video, timer: null };
  draw();
  video.play().catch(() => {});
}

/** 进 / 出画中画。必须在点击里直接调 */
export function togglePip() {
  if (!pip) return Promise.reject(new Error('画中画还没有准备好，请稍后再试'));
  if (document.pictureInPictureElement === pip.video) {
    return document.exitPictureInPicture().catch(() => {});
  }
  draw();
  const p = pip.video.requestPictureInPicture();
  // 进去之后才开始按时重画：秒表要走、字幕要换
  return p.then(() => {
    desk.set({ pip: true });
    if (pip && !pip.timer) pip.timer = setInterval(draw, 500);
  });
}

/** iPhone 外壳：弹出 / 收起画中画。回来之后 desk.pip 是实情 */
export function toggleShell() {
  const h = iosFloat();
  if (!h) return Promise.reject(new Error('这个版本的 app 不支持画中画'));
  return Promise.resolve(h.postMessage({ action: 'toggle' })).then(r => {
    if (r && r.error) throw new Error(r.error);
    desk.set({ pip: !!(r && r.pip) });
  });
}

/** 通话结束：画中画收掉，外壳那边的小窗撤掉 */
export function release() {
  if (kind() === 'native' || kind() === 'ios') send({ on: false });
  desk.set({ pip: false });
  sentImage = '';
  clearTimeout(feedTimer); feedTimer = null;
  if (!pip) return;
  const { video, timer } = pip;
  pip = null;
  clearInterval(timer);
  if (document.pictureInPictureElement === video) document.exitPictureInPicture().catch(() => {});
  try { video.srcObject?.getTracks?.().forEach(t => t.stop()); } catch { /* */ }
  video.remove();
  desk.set({ pip: false });
}

// 跟着通话走：挂了就收，安卓那边每有变化就按节奏送一次（秒表、字幕）
let wasLive = false;
call.subscribe(s => {
  const live = s.phase !== 'idle';
  if (!live) { if (wasLive) release(); wasLive = false; return; }
  wasLive = true;
  if (kind() === 'native' || kind() === 'ios') scheduleNative();
});
