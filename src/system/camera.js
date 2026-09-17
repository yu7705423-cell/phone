// 摄像头。只在视频通话里用，而且只在用户自己选了「真实画面」之后才打开。
//
// 这里有一条线要守住：**画面一帧都不落库**。取到的帧只在那一次请求里出现，
// 用完就没了。视频通话是演出来的，但摄像头是真的 —— 真的东西按真的规矩办。
let stream = null;
let el = null;          // 界面上那个 <video>，取帧时从它身上画

export function supported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia
    && typeof HTMLCanvasElement !== 'undefined');
}

export function running() { return !!stream; }

export async function start() {
  if (stream) return stream;
  if (!supported()) throw new Error('这个浏览器不支持摄像头');
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } },
    audio: false,
  });
  return stream;
}

export function stop() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  el = null;
}

export function current() { return stream; }

// 界面把自己那个 <video> 交过来，取帧时用它 —— 一路流两个元素反而更容易对不上
export function attach(node) { el = node || null; }
export function detach(node) { if (!node || el === node) el = null; }

/**
 * 取一帧，压成 dataURL。
 * 长边压到 max，jpeg 质量给 0.6 —— 通话一轮一帧，原尺寸传上去既慢又贵，
 * 而「对方在干什么」这种判断根本不需要高清。
 */
export function grab({ max = 512, quality = 0.6 } = {}) {
  if (!el || !stream) return null;
  const w = el.videoWidth, h = el.videoHeight;
  if (!w || !h) return null;
  const scale = Math.min(1, max / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  // 前置摄像头看到的是镜像，界面上也是镜像显示的，传出去的这一帧要翻回来，
  // 否则模型看到的字全是反的
  ctx.translate(cw, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(el, 0, 0, cw, ch);
  try {
    return { dataUrl: cv.toDataURL('image/jpeg', quality), mediaType: 'image/jpeg' };
  } catch { return null; }
}
