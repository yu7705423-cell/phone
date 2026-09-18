import { createStore } from './store.js';
import { chats, characters, messages, settings } from './db/index.js';
import * as accounts from './accounts.js';
import * as audio from './audio.js';
import * as voice from './ai/voice.js';
import { isVoiceReady } from './ai/voice.js';
import { buildCallSystem, streamCall, cancelCall, template, isConfigured } from './ai/engine.js';
import { isAbort } from './ai/queue.js';
import { fillTemplate } from './ai/templates.js';
import { configOf, inQuiet } from './ai/proactive.js';
import { notify } from './notify.js';
import * as camera from './camera.js';
import * as extras from './extras.js';
import { visionMode } from './ai/services.js';

// 通话。
//
// 这不是实时语音，也装不成实时语音：一轮要走完「识别、模型、合成」三步，
// 最快也要一秒多。所以整件事按**回合**做，只是把回合藏在一个电话界面后面：
// 说完一句就等对方，对方说完再轮到你 —— 真人打电话本来也是这样。
//
// 三条让它不至于难熬的设计：
//   1. **按句切**。模型流式吐字，遇到句末标点就把这一句排进播放队列，
//      不等整段。等待只剩第一句的时间，后面的句子在前一句播的时候就备好了。
//   2. **字幕是主角**。默认不发声，只出字幕 —— 没配语音接口的人照样能用，
//      而且一分钱不多花。想听声音在通话界面上点开喇叭。
//   3. **system 只拼一次**（见 engine.buildCallSystem）。

export const call = createStore({
  phase: 'idle',
  chatId: '',
  charId: '',
  direction: 'out',       // out 我打出去 | in 它打进来
  video: false,           // 视频通话
  selfReal: false,        // 我这边用真实摄像头，而不是一张虚拟头像
  camera: false,          // 摄像头真的开起来了
  startedAt: 0,           // 接通的时刻
  lines: [],              // { role: 'user' | 'char', text }
  seconds: 0,             // 已经通了多久
  draft: '',              // 对方正在说的那半句，流式填进来
  thinking: false,        // 等模型
  listening: false,       // 我这边麦克风开着
  heard: '',              // 我说到一半的那点，给界面回显
  speak: false,           // 要不要出声
  mic: false,             // 我用嘴还是打字
  outcome: '',            // 结束原因
  error: '',
});

// 喇叭和麦克风是通话控件，不是设置项，但要记住上次怎么用的
function prefs() {
  const s = settings.get();
  return { speak: s.callSpeak === true, mic: s.callMic === true, selfReal: s.callSelfReal === true };
}

// 视频通话里，角色能不能看见我，取决于识图那一档。
//
// **只认「交给聊天模型」这一档。** 另配一套识图接口也能读图，但那是先调一次
// 识图接口拿描述、再调一次聊天接口 —— 通话里每一轮多一次往返，等得人想挂电话。
// 这一档聊天模型自己就能看图，画面跟着那一轮请求一起过去，不多花一次往返。
export function charCanSee() {
  const s = call.get();
  return s.video && s.selfReal && s.camera && visionMode() === 'chat';
}

let timer = null;         // 拨号与响铃的超时
let tock = null;          // 通话中的秒表
let poll = null;          // 回显我说到一半的那点
let listener = null;      // 识别把手
let ended = false;        // 防止重复收尾
let framedAt = 0;         // 上一帧是什么时候送出去的
let systemPrompt = '';    // 整通电话只拼一次

// ---- 播放队列 ----
//
// 配了语音接口且角色有音色就走接口，那才是「这个角色的声音」；
// 否则退回浏览器自带的合成 —— 机械，但不花钱也不用等。
let queue = [];
let player = null;
// 每次 hush 都换一代。正在 await 播放的那个循环回来一看代号变了就自己退出，
// 不然掐掉之后它还会接着念下一句。
let era = 0;

function canUseApi(char) {
  return isVoiceReady() && !!char?.voiceId && char.canSendVoice !== false;
}

async function playOne(text, char) {
  if (canUseApi(char)) {
    try {
      const url = await voice.speak({ text, voiceId: char.voiceId, speed: char.voiceSpeed || 1,
        key: `call-tts:${Date.now()}:${Math.random()}` });
      await new Promise(resolve => {
        player = new Audio(url);
        player.onended = resolve;
        player.onerror = resolve;
        player.play().catch(resolve);
      });
      player = null;
      URL.revokeObjectURL(url);
      return;
    } catch (err) {
      // 接口出问题不能让通话哑掉，退到浏览器那档接着念
      console.warn('[call] 语音接口没出声，改用浏览器合成:', err.message || err);
    }
  }
  await audio.speakLocally(text);
}

let draining = false;
async function drain(char) {
  if (draining) return;
  draining = true;
  const mine = era;
  while (queue.length && mine === era) {
    if (!call.get().speak || call.get().phase !== 'active') break;
    await playOne(queue.shift(), char);
  }
  draining = false;
}

function hush() {
  era++;
  queue = [];
  draining = false;
  audio.stopSpeaking();
  if (player) { try { player.pause(); } catch { /* 已经停了 */ } player = null; }
}

// 视频通话里两帧画面之间至少隔这么久。用户可以改，填 0 就是每轮都带。
const frameGap = () => Math.max(0, settings.get().callFrameGap || 0) * 1000;

// 句末标点处切开。切不出整句就先攒着 —— 半句念出来比等一下更难听。
const SENT = /^[\s\S]*?[。！？!?…；;]+/;
function takeSentences(buf) {
  const out = [];
  let rest = buf;
  for (;;) {
    const m = rest.match(SENT);
    if (!m) break;
    const one = m[0].trim();
    if (one) out.push(one);
    rest = rest.slice(m[0].length);
  }
  return { out, rest };
}

// ---- 接不接 ----
//
// 不为「接不接」单独跑一次模型：那要多花一次往返，还要等它想。
// 直接看角色卡上那个免打扰时段 —— 那本来就是这个人的作息，
// 睡着的时候接不到电话是天经地义的。再掺一点随机，免得成了闹钟。
function willAnswer(char) {
  const cfg = configOf(char);
  if (inQuiet(cfg)) return Math.random() < 0.15;
  return Math.random() < 0.9;
}

function reset(patch) {
  clearTimeout(timer); timer = null;
  clearInterval(tock); tock = null;
  hush();
  stopMic();
  camera.stop();
  call.set({
    phase: 'idle', chatId: '', charId: '', lines: [], draft: '', heard: '',
    thinking: false, listening: false, camera: false, outcome: '', error: '', ...patch,
  });
}

export function active() { return call.get().phase !== 'idle'; }
export function inChat(chatId) { return active() && call.get().chatId === chatId; }

// ---- 起一通电话 ----
export function dial(chatId, { video = false } = {}) {
  if (active()) throw new Error('已经在通话中');
  const chat = chats.get(chatId);
  const char = characters.get((chat?.characterIds || [])[0]);
  if (!chat || !char) throw new Error('会话或角色不存在');
  if (char.canCall === false) throw new Error('该角色未开启通话');
  if (!isConfigured()) throw new Error('尚未配置模型接口');

  ended = false;
  call.set({ ...prefs(), phase: 'dialing', chatId, charId: char.id, direction: 'out',
    video, camera: false, lines: [], draft: '', heard: '', outcome: '', error: '' });
  framedAt = 0;

  // 拨出去总要响一会儿，立刻接通反而假
  const wait = 2500 + Math.round(Math.random() * 3500);
  timer = setTimeout(() => {
    if (call.get().phase !== 'dialing') return;
    if (willAnswer(char)) connect();
    else finish('missed');
  }, wait);
}

// 角色打进来。人不在这段对话里就不响铃，直接记一条未接来电。
export function ring(chatId, { video = false } = {}) {
  const chat = chats.get(chatId);
  const char = characters.get((chat?.characterIds || [])[0]);
  if (!chat || !char || char.canCall === false) return null;
  if (active()) return null;

  ended = false;
  call.set({ ...prefs(), phase: 'ringing', chatId, charId: char.id, direction: 'in',
    video, camera: false, lines: [], draft: '', heard: '', outcome: '', error: '' });
  framedAt = 0;

  notify({
    title: extras.starTitle(char, char.name || '来电'),
    body: video ? '视频通话' : '语音通话', icon: 'phone',
    appId: 'chat', avatar: char.avatar, payload: { route: `/chat/${chatId}` },
  });

  // 响够了没人接就是未接来电
  timer = setTimeout(() => { if (call.get().phase === 'ringing') finish('missed'); }, 20000);
  return true;
}

export function accept() {
  if (call.get().phase !== 'ringing') return;
  connect();
}

export function decline() {
  if (call.get().phase !== 'ringing') return;
  finish('declined');
}

// 我这边给对方看什么：一张虚拟头像，还是真实摄像头。
// 开摄像头要现问权限，所以这里是异步的。
export async function toggleSelf() {
  const on = !call.get().selfReal;
  settings.set({ callSelfReal: on });
  call.set({ selfReal: on });
  if (!on) { camera.stop(); call.set({ camera: false }); return; }
  if (call.get().phase === 'idle' || !call.get().video) return;
  try {
    await camera.start();
    call.set({ camera: true, error: '' });
  } catch (err) {
    call.set({ selfReal: false, camera: false, error: '打不开摄像头：' + (err.message || err) });
    settings.set({ callSelfReal: false });
  }
}

// 拨号中挂掉是「已取消」，通话中挂掉是正常结束
export function hangUp() {
  const { phase } = call.get();
  if (phase === 'idle') return;
  if (phase === 'active') finish('done');
  else if (phase === 'ringing') finish('declined');
  else finish('cancelled');
}

async function connect() {
  clearTimeout(timer);
  const { chatId, charId, direction } = call.get();
  call.set({ phase: 'active', startedAt: Date.now(), seconds: 0 });
  tock = setInterval(() => {
    if (call.get().phase === 'active') call.set({ seconds: elapsed() });
  }, 1000);

  const chat = chats.get(chatId);
  const char = characters.get(charId);
  try {
    systemPrompt = await buildCallSystem(chat, char);
  } catch (err) {
    call.set({ error: '准备通话内容时出错：' + (err.message || err) });
  }
  // 拼提示词要一会儿，这期间可能已经挂了
  if (call.get().phase !== 'active') return;
  if (call.get().mic) startMic();
  if (call.get().video && call.get().selfReal) {
    try { await camera.start(); call.set({ camera: true }); }
    catch (err) { call.set({ selfReal: false, error: '打不开摄像头：' + (err.message || err) }); }
  }

  // 接通之后由角色先开口 —— 拨过去的那一方喊「喂」，打进来的那一方有话要说
  turn(fillTemplate(template('task.call-open'), {
    origin: direction === 'out' ? '，是对方打给你的' : '，是你打给对方的',
  }));
}

// ---- 我说了一句 ----
export function say(text) {
  const t = String(text || '').trim();
  if (!t || call.get().phase !== 'active') return;
  hush();                                  // 我一开口就把它正在说的掐掉
  call.set({ lines: [...call.get().lines, { role: 'user', text: t }], heard: '' });
  turn('');
}

// ---- 一个回合 ----
async function turn(opening) {
  const { chatId, charId } = call.get();
  const chat = chats.get(chatId);
  const char = characters.get(charId);
  if (!chat || !char) return;

  call.set({ thinking: true, draft: '', error: '' });
  let buf = '';
  let spoken = 0;            // 已经排进播放队列的字数

  // 一轮最多带一帧，而且离上一帧至少这么久 —— 你来我往说得快的时候，
  // 每句话都传一张图，贵得没道理，画面也没怎么变。
  let frame = null;
  if (charCanSee() && Date.now() - framedAt >= frameGap()) {
    frame = camera.grab();
    if (frame) framedAt = Date.now();
  }

  try {
    const full = await streamCall({
      chat, char, system: systemPrompt, lines: call.get().lines, opening, image: frame,
      onDelta: (_, all) => {
        if (call.get().phase !== 'active') return;
        buf = all;
        call.set({ thinking: false, draft: all });
        // 按句切：够一整句就排进去，不等整段说完
        if (call.get().speak) {
          const { out, rest } = takeSentences(all.slice(spoken));
          if (out.length) {
            spoken = all.length - rest.length;
            queue.push(...out);
            drain(char);
          }
        }
      },
    });

    const text = String(full || buf || '').trim();
    if (call.get().phase !== 'active') return;
    if (!text) { call.set({ thinking: false, error: '对方那边没有声音' }); return; }

    call.set({
      lines: [...call.get().lines, { role: 'char', text }],
      draft: '', thinking: false,
    });
    // 最后半句没有标点，收尾时补进去。这里按未整理过的 buf 下标算，
    // spoken 记的就是它的下标。
    if (call.get().speak && buf.length > spoken) {
      const tailText = buf.slice(spoken).trim();
      if (tailText) { queue.push(tailText); drain(char); }
    }
  } catch (err) {
    if (isAbort(err)) return;
    call.set({ thinking: false, error: String(err.message || err) });
  }
}

// ---- 麦克风 ----
function startMic() {
  if (listener || !audio.speechSupported()) return;
  try {
    listener = audio.listenStream({ onUtterance: text => say(text) });
    call.set({ listening: true });
    // 说到一半的那点回显出来，不然不知道它听没听见
    clearInterval(poll);
    poll = setInterval(() => {
      if (!listener) return;
      const p = listener.partial();
      if (p !== call.get().heard) call.set({ heard: p });
    }, 300);
  } catch (err) {
    call.set({ mic: false, listening: false, error: String(err.message || err) });
  }
}

function stopMic() {
  clearInterval(poll); poll = null;
  if (listener) { listener.stop(); listener = null; }
  call.set({ listening: false, heard: '' });
}

export function toggleMic() {
  const on = !call.get().mic;
  if (on && !audio.speechSupported()) {
    call.set({ error: '这个浏览器不支持语音识别，请改用输入' });
    return;
  }
  settings.set({ callMic: on });
  call.set({ mic: on });
  if (call.get().phase === 'active') (on ? startMic() : stopMic());
}

export function toggleSpeak() {
  const on = !call.get().speak;
  settings.set({ callSpeak: on });
  call.set({ speak: on });
  if (!on) hush();
}

// ---- 收尾 ----
//
// 通话中的每一轮都不落库，挂断时合成**一条**记录。
// 二十轮对话不该把会话列表冲垮，而角色下次聊天照样要记得电话里说了什么 ——
// 所以正文里带着整段对白，气泡上只画那张记录卡。
function finish(outcome) {
  if (ended) return;
  ended = true;
  const { chatId, charId, direction, startedAt, lines, video } = call.get();
  clearTimeout(timer); clearInterval(tock);
  hush(); stopMic();
  camera.stop();
  cancelCall(chatId);

  const seconds = outcome === 'done' && startedAt
    ? Math.max(1, Math.round((Date.now() - startedAt) / 1000)) : 0;
  const chat = chats.get(chatId);
  const char = characters.get(charId);

  if (chat && char) {
    const me = accounts.get(chat.personaId)?.name || accounts.current()?.name || '我';
    const body = lines.map(l => `${l.role === 'user' ? me : (char.name || '对方')}：${l.text}`).join('\n');
    messages.create({
      chatId, kind: 'call',
      // 记在发起的那一方名下，气泡才落在正确的一侧
      role: direction === 'out' ? 'user' : 'char',
      authorId: direction === 'out' ? 'me' : charId,
      direction, outcome, seconds, callLog: lines, callKind: video ? 'video' : 'voice',
      content: `[${label(direction, outcome, seconds, video)}]${body ? '\n' + body : ''}`,
      status: 'done',
    });
    chats.update(chatId, { lastMessageAt: Date.now() });
  }
  reset({ outcome });
}

export function duration(sec) {
  const n = Math.max(0, Math.round(sec || 0));
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

export function label(direction, outcome, seconds, video) {
  const what = video ? '视频通话' : '语音通话';
  if (outcome === 'done') return `${what} ${duration(seconds)}`;
  if (outcome === 'missed') return direction === 'out' ? `${what}未接听` : `未接${what}`;
  if (outcome === 'declined') return direction === 'out' ? `${what}已被拒接` : `${what}已拒接`;
  return `${what}已取消`;
}

// 通话中的秒数，界面上按秒跳
export function elapsed() {
  const { startedAt, phase } = call.get();
  if (phase !== 'active' || !startedAt) return 0;
  return Math.round((Date.now() - startedAt) / 1000);
}
