// 保活。循环播放一段无声音频，让系统把这个页面当成正在放东西的标签页，
// 切到后台之后不那么快被冻结，主动消息的定时器才有机会照常跑。
//
// 这不是什么正经 API，是个业内通用的将就办法，效果取决于系统当时的心情：
// iOS 锁屏之后照样会停，只是比什么都不做能多撑一阵。所以默认关着，
// 由用户自己决定要不要用这点电量换这点存活时间。

let el = null;
let on = false;

// 一段 1 秒的无声 wav，直接内联，不占一次网络请求
function silentWav() {
  const rate = 8000;
  const n = rate;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (off, t) => { for (let i = 0; i < t.length; i++) v.setUint8(off + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

function ensure() {
  if (el) return el;
  el = new Audio(silentWav());
  el.loop = true;
  el.volume = 0;
  // iOS 要有这个才肯在后台继续播
  el.setAttribute('playsinline', '');
  return el;
}

export function running() { return on; }

export async function start() {
  const a = ensure();
  try {
    await a.play();
    on = true;
    return true;
  } catch {
    // 还没有过真实触摸，浏览器不让自动播。等下一次点击再试
    on = false;
    return false;
  }
}

export function stop() {
  on = false;
  if (el) { el.pause(); el.currentTime = 0; }
}

// 开着保活但被浏览器拦下来时，等用户第一次点击再补一次
export function installRetry(enabled) {
  const once = () => {
    if (enabled() && !on) start();
    window.removeEventListener('pointerdown', once);
  };
  window.addEventListener('pointerdown', once);
  return () => window.removeEventListener('pointerdown', once);
}
