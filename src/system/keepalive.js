import { createStore } from './store.js';
import { settings } from './db/index.js';

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
const BEAT_MS = 5000;     // 心跳。只在内存里记一个时刻，不写库

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
  // 上一次切到后台回来时量到的：离开了多久、其间定时器停了多久。
  // **这一项是为了把「音频在播」和「JS 还在跑」分开** ——
  // iOS 的后台音频保住的是 app 进程，WKWebView 里的网页内容是另一回事，
  // 系统可能照样把它冻住。真冻住了，这套保活对主动消息就没有意义，
  // 而光看「正在运行」是看不出来的
  away: null,   // { away, frozen }，单位毫秒
});

let el = null;
let elUrl = '';
let watchdog = null;
let retry = null;

// ---- 外壳那条路 ----

const BRIDGE = () => window.webkit?.messageHandlers?.keepalive;

/** 外壳有没有这座桥。有就一律走它。 */
export const native = () => !!(window.phoneKeepAlive && BRIDGE());

async function callNative(action, payload = {}) {
  const got = await BRIDGE().postMessage({ action, ...payload });
  if (got && got.error) throw new Error(String(got.error));
  return got || {};
}

/** 用户选的：保活期间要不要和其他应用混音。 */
const wantMix = () => settings.get().keepAliveMix === true;

/** 走外壳时的续播。原生不需要用户手势，所以 needsTap 永远立不起来。 */
// 那一行字必须**先说走的是哪条路**。
//
// 上一版只有外壳那条路会写 note，于是「外壳的桥不在」「在浏览器里」
// 「还没开起来」三种情况在屏幕上长得一模一样，全是一片空白 ——
// 而这一行字本来就是为了把它们分开才加的。现在两条路都写。
const WEB = '网页音频';
const SHELL = '外壳音频';

/** 外壳回来的那几项翻成一句人话。 */
function noteOf(got) {
  if (!got.on) return `${SHELL}：没有在运行`;
  // mixing 为真时系统不拿这段音频当「这只 app 正在放东西」，后台照停 ——
  // 那种情况下这个功能等于没开，得说出来
  // 混音是用户自己选的时候不当成毛病说 —— 它是不是够用，
  // 由那把尺子（切后台几分钟再回来）告诉他，不由这里替他判
  if (got.mixing) {
    return wantMix()
      ? `${SHELL}：正在运行，与其他应用混音`
      : `${SHELL}：正在运行，但与其他应用混音，后台可能仍会被暂停`;
  }
  if (got.playing === false) return `${SHELL}：会话已就绪，但播放器没有在播`;
  return `${SHELL}：正在运行`;
}

async function nativeResume() {
  try {
    const got = await callNative('start', { mix: wantMix() });
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
  elUrl = silentWav();
  const a = new Audio(elUrl);
  a.loop = true;
  a.volume = 0;
  // iOS 要有这个才肯在后台继续播
  a.setAttribute('playsinline', '');
  // 被按停不等于我们想停。想开着就再续上
  ['pause', 'ended', 'error'].forEach(ev => a.addEventListener(ev, onStopped));
  // **关着的时候不许播。** 关掉之后锁屏的播放条、耳机线控还能对这个元素按播放；
  // 从前没人管，它就一直循环播下去。现在一按播放（play）、一出声（playing）都立刻卸掉
  const guard = () => {
    if (!state.get().want || a !== el) { release(a); return true; }
    return false;
  };
  a.addEventListener('play', guard);
  a.addEventListener('playing', () => { if (!guard()) sync(); });
  el = a;
  return el;
}

/**
 * 卸掉：停下、把音源摘掉。只 pause() 的话元素还挂着音源，系统的播放条留着，
 * 之后一点播放就又开始（见上面 playing 那一句）。摘掉之后播放条跟着消失，点了也播不出声
 */
function release(a = el) {
  if (!a) return;
  try { a.pause(); } catch { /* */ }
  try { a.removeAttribute('src'); a.load(); } catch { /* */ }
  if (a === el) {
    el = null;
    if (elUrl) { try { URL.revokeObjectURL(elUrl); } catch { /* */ } elUrl = ''; }
  }
}

/** 以元素为准同步一次状态。on 从来不靠我们自己记。 */
function sync(needsTap) {
  const playing = !!el && !el.paused && !el.ended;
  const s = state.get();
  const tap = needsTap === undefined ? (playing ? false : s.needsTap) : needsTap;
  state.set({
    on: playing,
    needsTap: tap,
    // 走的是网页那条老路。**装成 app 之后还看到这一句，就说明外壳那座桥没接上**
    // —— 那条路在 WKWebView 里本来就不管用，这一行要能把它认出来
    note: playing ? `${WEB}：正在运行`
      : tap ? `${WEB}：被打断了，需要在屏幕上点一下`
      : `${WEB}：没有在运行`,
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
  startBeat();
  return okd;
}

export function stop() {
  // 先把 want 放下来，否则下面这一停会被 onStopped 当成「被打断」又续回去
  state.set({ want: false, needsTap: false });
  clearTimeout(retry);
  stopWatch();
  stopBeat();
  if (native()) {
    callNative('stop').catch(() => {});
    state.set({ on: false, note: '' });
    return;
  }
  release();
  // 系统那边的播放条也说一声「没在放了」（有的浏览器靠它决定留不留那一条）
  try { if (navigator.mediaSession) navigator.mediaSession.playbackState = 'none'; } catch { /* */ }
  sync(false);
  state.set({ note: '' });     // 自己关的，不用在界面上报告
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

// ---- 心跳：后台期间定时器到底有没有在跑 ----
//
// 每 BEAT_MS 记一次「我还活着」。切回前台时拿「现在」减去最后一次心跳，
// 就是定时器被冻住的时长；和「离开了多久」一比，答案很直接：
//
//   冻住 ≈ 离开   网页被整个冻住了，保活对主动消息没有意义
//   冻住 ≈ 0      定时器一直在跑，问题不在这儿
//
// 只记在内存里。每五秒写一次库，为了一个诊断值把 IndexedDB 磨一遍不值。

let beat = 0;
let beater = null;
let leftAt = 0;

function startBeat() {
  stopBeat();
  beat = Date.now();
  beater = setInterval(() => { beat = Date.now(); }, BEAT_MS);
}
function stopBeat() { clearInterval(beater); beater = null; }

/** 切到后台。 */
function onHide() { leftAt = Date.now(); beat = Date.now(); }

/** 回到前台，算一笔账。 */
function onShow() {
  if (!leftAt) return;
  const now = Date.now();
  // 减掉一个心跳周期：最后那次心跳之后本来就还能再活 BEAT_MS 才算停
  const frozen = Math.max(0, now - beat - BEAT_MS);
  state.set({ away: { away: now - leftAt, frozen } });
  leftAt = 0;
  beat = now;
}

/** 那笔账翻成一句话。界面直接显示。 */
export function awayText() {
  const a = state.get().away;
  if (!a || a.away < 15000) return '';       // 离开太短，量不出什么
  const sec = ms => `${Math.round(ms / 1000)} 秒`;
  if (a.frozen < 10000) {
    const line = `上次切到后台 ${sec(a.away)}，其间定时器一直在跑`;
    // **一两分钟以内的样本不算数。** iOS 大约在那个时间点才开始回收后台 app，
    // 三十秒跑着是常态，说明不了保活起没起作用。不把话说满
    return a.away < 120000
      ? `${line}。这段时间还短，系统通常在一两分钟后才开始回收，`
        + '切出去三分钟以上再回来看更准'
      : line;
  }
  // 和**最多能量到多少**比，不是和总时长比。
  // frozen 已经减掉了一个心跳周期，拿它去比 away 的话，离开时间短一点
  // 就永远够不着门槛 —— 16 秒里冻住 11 秒（能量到的全部）也才 69%
  if (a.frozen > Math.max(1, a.away - BEAT_MS) * 0.8) {
    return `上次切到后台 ${sec(a.away)}，其间定时器停了 ${sec(a.frozen)}`
      + ' —— 网页被系统冻住了，这台设备上保活对主动消息没有作用';
  }
  return `上次切到后台 ${sec(a.away)}，其间定时器停了 ${sec(a.frozen)}`;
}

/**
 * 挂上所有盯梢。返回一个清理函数。
 *
 * 关键的一处：手势那个监听器**一直挂着**，不是点一次就摘。
 * 从前那个只补救一次，于是第一次点击如果没能救回来，就永远没有第二次机会。
 */
export function install(getWant) {
  const onTap = () => { if (getWant() && !state.get().on) resume(); };
  const onVis = () => {
    if (document.visibilityState !== 'visible') { onHide(); return; }
    onShow();
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
    stopBeat();
    clearTimeout(retry);
  };
}

/** 界面上那条横幅按了「知道了」：这一次不提示了，等下一次断再说。 */
export const dismiss = () => state.set({ needsTap: false });

export const running = () => state.get().on;
