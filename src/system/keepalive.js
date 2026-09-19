import { createStore } from './store.js';

// 保活。循环播放一段无声音频，让系统把这个页面当成正在放东西的标签页，
// 切到后台之后不那么快被冻结，主动消息的定时器才有机会照常跑。
//
// 这不是什么正经 API，是个业内通用的将就办法，效果取决于系统当时的心情：
// iOS 锁屏之后照样会停，只是比什么都不做能多撑一阵。所以默认关着，
// 由用户自己决定要不要用这点电量换这点存活时间。
//
// ---- 被打断之后怎么回来 ----
//
// 来一通电话、别的 app 抢走音频、系统把页面冻了，这段音频都会被按停。
// 从前有三个毛病，合起来就是「断一次就再也不回来」：
//
//   一、状态是**假的**。play() 成功就把 on 记成 true，之后元素被按停了
//       也没人改它，界面上看还开着，实际早停了。现在以 el.paused 为准。
//   二、补救只有一次。从前那个 pointerdown 监听器**第一次点击就摘掉自己**，
//       不管那次补救成没成。现在只要还想开着就一直挂着。
//   三、没人盯着。现在三路一起盯：元素自己的 pause/ended/error、
//       回到前台、以及一个二十秒的巡检。
//
// 自动续不上的时候（浏览器要求先有一次真实触摸），才弹条让用户点一下 ——
// 那一下既是许可也是手势，是唯一能可靠恢复的办法。
//
// ---- 装成 ipa 之后由外壳自己放 ----
//
// **零音量那一招在 app 里不灵。** WKWebView 不会为一个音量为零的元素去占
// 音频焦点，系统那边压根不认为这只 app 在放音频，后台照停 —— 外壳把
// AVAudioSession 配好也没用，因为根本没人在放。
//
// 所以外壳自己放一段极轻的噪声（ios/Sources/KeepAliveBridge.swift），
// 并在文档一开始注入 window.phoneKeepAlive。**有那座桥就一律走桥**：
// 下面那个 <audio> 元素、手势补救、needsTap 横幅全都用不上了 ——
// 原生播放不需要用户手势，断了直接续。

const WATCH_MS = 20000;
const RETRY_MS = 800;

/**
 * want  用户要不要开
 * on    现在是不是真的在播（以元素为准，不是我们记的）
 * needsTap  想开、没在播、自动续不上了，得用户点一下
 */
export const state = createStore({
  want: false, on: false, needsTap: false,
  // 走外壳那条路时，外壳回来的实情：音频会话是什么类别、有没有在混音、
  // 出了什么错。**界面要把它显示出来** —— 开关打开之后屏幕上什么都不变的话，
  // 坏没坏谁也看不出来
  note: '',
});

let el = null;
let watchdog = null;
let retry = null;
let wired = false;

// ---- 外壳那条路 ----

const BRIDGE = () => window.webkit?.messageHandlers?.keepalive;

/** 外壳有没有这座桥。有就一律走它。 */
export const native = () => !!(window.phoneKeepAlive && BRIDGE());

async function callNative(action) {
  const got = await BRIDGE().postMessage({ action });
  if (got && got.error) throw new Error(String(got.error));
  return got || {};
}

/** 走外壳时的续播。原生不需要用户手势，所以 needsTap 永远立不起来。 */
/** 外壳回来的那几项翻成一句人话，显示在设置那一行上。 */
function noteOf(got) {
  if (!got.on) return '没有在运行';
  // mixing 为真时系统不拿这段音频当「这只 app 正在放东西」，后台照停 ——
  // 那种情况下这个功能等于没开，得说出来
  return got.mixing
    ? '正在运行，但音频与其他应用混合，后台可能仍会被暂停'
    : '正在运行';
}

async function nativeResume() {
  try {
    const got = await callNative('start');
    state.set({ on: got.on === true, needsTap: false, note: noteOf(got) });
    return got.on === true;
  } catch (err) {
    // 原生这一层开不起来是真开不起来，点一下也没用，不要去骗用户点。
    // 但要把原话显示出来，不然只剩一句「没反应」
    state.set({ on: false, needsTap: false, note: String(err.message || err) });
    return false;
  }
}

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
  if (!wired) {
    wired = true;
    // 被按停不等于我们想停。想开着就再续上
    ['pause', 'ended', 'error'].forEach(ev => el.addEventListener(ev, onStopped));
    el.addEventListener('playing', () => sync());
  }
  return el;
}

/** 以元素为准同步一次状态。on 从来不靠我们自己记。 */
function sync(needsTap) {
  const playing = !!el && !el.paused && !el.ended;
  const s = state.get();
  state.set({
    on: playing,
    needsTap: needsTap === undefined ? (playing ? false : s.needsTap) : needsTap,
  });
  return playing;
}

function onStopped() {
  if (!state.get().want) { sync(false); return; }
  sync();
  // 别在事件回调里直接重放，先让这一轮事件走完
  clearTimeout(retry);
  retry = setTimeout(() => { resume(); }, RETRY_MS);
}

/**
 * 试着续上。续不上就把 needsTap 立起来，界面据此弹一条。
 * 浏览器要求先有一次真实触摸，这种时候代码怎么试都没用。
 */
export async function resume() {
  if (!state.get().want) return false;
  if (native()) return nativeResume();
  const a = ensure();
  try {
    await a.play();
    sync(false);
    return true;
  } catch {
    sync(true);
    return false;
  }
}

export async function start() {
  state.set({ want: true });
  const okd = await resume();
  startWatch();
  return okd;
}

export function stop() {
  // 先把 want 放下来，否则下面这一停会被 onStopped 当成「被打断」又续回去
  state.set({ want: false, needsTap: false });
  clearTimeout(retry);
  stopWatch();
  if (native()) {
    callNative('stop').catch(() => {});
    state.set({ on: false, note: '' });
    return;
  }
  if (el) { el.pause(); el.currentTime = 0; }
  sync(false);
}

function startWatch() {
  stopWatch();
  // 事件不一定每次都来（被系统冻住那种就没有），所以还得自己巡一遍
  watchdog = setInterval(async () => {
    if (!state.get().want) return;
    // 走外壳时以那边的播放器为准；来一通电话就会被按停，巡到了就续上
    if (native()) {
      const got = await callNative('status').catch(() => ({ on: false }));
      state.set({ on: got.on === true, note: noteOf(got) });
      if (!got.on) nativeResume();
      return;
    }
    if (!sync()) resume();
  }, WATCH_MS);
}

function stopWatch() { clearInterval(watchdog); watchdog = null; }

/**
 * 挂上所有盯梢。返回一个清理函数。
 *
 * 关键的一处：手势那个监听器**一直挂着**，不是点一次就摘。
 * 从前那个只补救一次，于是第一次点击如果没能救回来，就永远没有第二次机会。
 */
export function install(getWant) {
  const onTap = () => { if (getWant() && !state.get().on) resume(); };
  const onVis = () => {
    if (document.visibilityState !== 'visible') return;
    if (native()) { if (getWant()) resume(); return; }
    if (getWant() && !sync()) resume();
  };
  // 手势补救只对网页那条路有意义。原生不需要手势，挂着只是白跑
  if (!native()) window.addEventListener('pointerdown', onTap);
  document.addEventListener('visibilitychange', onVis);
  return () => {
    window.removeEventListener('pointerdown', onTap);
    document.removeEventListener('visibilitychange', onVis);
    stopWatch();
    clearTimeout(retry);
  };
}

/** 界面上那条横幅按了「知道了」：这一次不提示了，等下一次断再说。 */
export const dismiss = () => state.set({ needsTap: false });

export const running = () => state.get().on;
