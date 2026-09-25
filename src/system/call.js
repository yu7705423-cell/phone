import { createStore } from './store.js';
import { chats, characters, messages, settings, files } from './db/index.js';
import * as accounts from './accounts.js';
import * as audio from './audio.js';
import * as voice from './ai/voice.js';
import { isVoiceReady } from './ai/voice.js';
import { buildCallSystem, streamCall, cancelCall, template, isConfigured, runTextTask } from './ai/engine.js';
import * as translate from './ai/translate.js';
import * as vs from './ai/voicescript.js';
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
  mini: false,            // 缩成悬浮球：通话照常进行，界面让出来（见 CallLayer 的 CallBall）
});

// 喇叭和麦克风是通话控件，不是设置项，但要记住上次怎么用的。
//
// **喇叭那一项：没动过就看配没配。** 从前一律默认关着，理由是「没配语音接口
// 的人照样能用，而且一分钱不多花」—— 对没配的人是对的，对配好了音色的人就
// 不对了：他专门去配了一个声音，打通电话却是静音的，还得自己找到那个喇叭。
// 所以改成：手动按过就记住他按的那次；从没按过，就看这个角色能不能真出声。
function prefs(char) {
  const s = settings.get();
  const touched = typeof s.callSpeak === 'boolean';
  return {
    speak: touched ? s.callSpeak === true : canUseApi(char),
    mic: s.callMic === true,
    selfReal: s.callSelfReal === true,
  };
}

/**
 * 这一通为什么没有「这个角色的声音」。回来的是一句话，没问题就回空。
 *
 * 从前这一层是哑的：接口没配、角色没设音色、或者角色的语音被关掉，
 * 三种情况都一声不吭地退回浏览器自带的合成 —— 听着像个机器人，而人不知道
 * 是哪儿没对，只会觉得「配了语音怎么没用」。
 */
export function voiceWhy(char) {
  if (!isVoiceReady()) return '尚未配置语音接口，当前使用浏览器自带的合成';
  if (char && char.canSendVoice === false) return '该角色的语音已关闭，当前使用浏览器自带的合成';
  if (!char?.voiceId) return '该角色尚未设置音色，当前使用浏览器自带的合成';
  return '';
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

/**
 * 念一句。`item` 是 `{ text, bucket }`：bucket 是这一句所属那一轮的音频清单，
 * 合成出来的声音存一份进去。
 *
 * **从前播完就 revoke，声音直接扔了。** 通话结束之后回不去听、也下载不了。
 * 现在存进 files，挂在通话记录上（见 finish）。只有走语音接口的才有得存 ——
 * 浏览器自带那档是现念的，本来就没有文件。
 *
 * **挂断之后不许再出声。** 从前挂断时正在合成的那一句，合成完照样 new Audio
 * 播出来：人已经挂了，手机还在说话。hush 换代之后回来一看代号不对就作罢，
 * 那一句也不存 —— 它没被听见，存下来反而对不上。
 */
async function playOne(item, char) {
  const { text, bucket } = typeof item === 'string' ? { text: item, bucket: null } : item;
  const mine = era;
  // 只剩一个标记、没有字的那一截（「<停顿 1>」落在句号后面）不念
  const words = vs.plain(text);
  if (!words) return;
  if (canUseApi(char)) {
    try {
      const url = await voice.speak({ text, voiceId: char.voiceId, speed: char.voiceSpeed || 1,
        ...voice.styleFor(char),
        key: `call-tts:${Date.now()}:${Math.random()}` });
      if (mine !== era) { URL.revokeObjectURL(url); return; }
      if (bucket) {
        try {
          const blob = await (await fetch(url)).blob();
          bucket.push(await files.put(blob, { name: 'call.mp3', type: blob.type || 'audio/mpeg' }));
        } catch (err) { console.warn('[call] 这一句的声音没存下来:', err.message || err); }
      }
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
  if (mine !== era) return;
  // 浏览器自带那档不认台本标记，念的是去掉标记之后的那句话
  await audio.speakLocally(words);
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
// **默认总是接。** 从前一律按「主动发起对话」里的免打扰时段掷骰子：时段里只有 15% 接，
// 其余时间 90%。可那个时段是给「角色主动发消息」用的，默认 0 点到 8 点，
// 哪怕从没打开过主动消息也在 —— 于是夜里打过去几乎回回不接，而界面上看不出为什么。
// 现在「按作息」是角色卡上一个单独的选项（callAnswer: 'schedule'），开了才走下面那套。
//
// 不为「接不接」单独跑一次模型：那要多花一次往返，还要等它想。
export const ANSWER = [
  { value: 'always', label: '总是接听' },
  { value: 'schedule', label: '按作息' },
];
export const answerOf = char => (char?.callAnswer === 'schedule' ? 'schedule' : 'always');

function willAnswer(char) {
  if (answerOf(char) === 'always') return true;
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
    thinking: false, listening: false, camera: false, outcome: '', error: '', mini: false, ...patch,
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
  call.set({ ...prefs(char), phase: 'dialing', chatId, charId: char.id, direction: 'out',
    video, camera: false, lines: [], draft: '', heard: '', outcome: '', error: '', mini: false });
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
  call.set({ ...prefs(char), phase: 'ringing', chatId, charId: char.id, direction: 'in',
    video, camera: false, lines: [], draft: '', heard: '', outcome: '', error: '', mini: false });
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

// 缩成悬浮球 / 展开回全屏。
//
// 只是界面让出来：回合、声音、麦克风、秒表都照常走。响铃时不许缩 ——
// 接还是不接要当场决定，缩起来就等于替人把电话晾到超时。
export function shrink() {
  const { phase } = call.get();
  if (phase === 'dialing' || phase === 'active') call.set({ mini: true });
}
export function expand() { call.set({ mini: false }); }

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
    systemPrompt = await buildCallSystem(plain(chat), char, { script: scriptOn() });
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
//
// 我一开口就把它正在说的掐掉。**但它已经说出口的那半句留下来。**
// 从前被打断的那一轮整轮作废：字幕上那半句当场消失，通话记录里也没有，
// 下一轮模型看到的历史里同样没有 —— 看起来就是「我一说话，它刚才的话就没了」。
// 现在把字幕上已经出现的那一截落成一句，排在我这一句前面；
// 被掐掉的那一轮就算随后也收了尾，也不再补一条（见 turn 里的 seq）。
export function say(text) {
  const t = String(text || '').trim();
  if (!t || call.get().phase !== 'active') return;
  hush();
  seq += 1;
  const { lines, draft, chatId } = call.get();
  const cut = String(draft || '').trim();
  const next = cut ? [...lines, { role: 'char', text: cut, cut: true }] : lines;
  call.set({ lines: [...next, { role: 'user', text: t }], heard: '', draft: '', thinking: false });
  if (cut) transLine(chats.get(chatId), lines.length, cut);
  turn('');
}

// 第几轮。被打断的那一轮收尾时拿它比一下，已经不是最新的就不落字幕
let seq = 0;

// ---- 一个回合 ----
async function turn(opening) {
  const mine = seq;
  const { chatId, charId } = call.get();
  const chat = chats.get(chatId);
  const char = characters.get(charId);
  if (!chat || !char) return;

  call.set({ thinking: true, draft: '', error: '' });
  let buf = '';
  let spoken = 0;            // 已经排进播放队列的字数
  const bucket = [];         // 这一轮合成出来的声音，存进 files 之后的 id
  // 情绪要跨句带着走：上一句换成了「生气」，下一句没写情绪就还是生气。
  // 按句送进语音接口时每句是单独一次，不补上的话每句开头都回到默认
  let mood = '';
  const enqueue = sentences => {
    for (const s of sentences) {
      const lead = mood && !/^\s*<\s*情绪/.test(s) ? `<情绪 ${mood}>` : '';
      queue.push({ text: lead + s, bucket });
      mood = vs.lastMood(s) || mood;
    }
    drain(char);
  };

  // 一轮最多带一帧，而且离上一帧至少这么久 —— 你来我往说得快的时候，
  // 每句话都传一张图，贵得没道理，画面也没怎么变。
  let frame = null;
  if (charCanSee() && Date.now() - framedAt >= frameGap()) {
    frame = camera.grab();
    if (frame) framedAt = Date.now();
  }

  try {
    const full = await streamCall({
      chat: plain(chat), char, system: systemPrompt, lines: call.get().lines, opening, image: frame,
      onDelta: (_, all) => {
        if (call.get().phase !== 'active' || mine !== seq) return;
        buf = all;
        // 字幕上不露台本标记，半个标记也不露
        call.set({ thinking: false, draft: vs.plain(all) });
        // 按句切：够一整句就排进去，不等整段说完。送去念的是带标记的原文
        if (call.get().speak) {
          const { out, rest } = takeSentences(all.slice(spoken));
          if (out.length) {
            spoken = all.length - rest.length;
            enqueue(out);
          }
        }
      },
    });

    const raw = String(full || buf || '').trim();
    // 字幕、历史、翻译、通话记录用的都是去掉标记的那句；带标记的另存一份，
    // 下一轮原样还给模型（见 engine.streamCall）
    const text = vs.plain(raw);
    if (call.get().phase !== 'active' || mine !== seq) return;
    if (!text) { call.set({ thinking: false, error: '对方那边没有声音' }); return; }

    const idx = call.get().lines.length;
    call.set({
      lines: [...call.get().lines, {
        role: 'char', text, audio: bucket, ...(raw !== text ? { script: raw } : {}),
      }],
      draft: '', thinking: false,
    });
    // 最后半句没有标点，收尾时补进去。这里按未整理过的 buf 下标算，
    // spoken 记的就是它的下标。
    if (call.get().speak && buf.length > spoken) {
      const tailText = buf.slice(spoken).trim();
      if (tailText) enqueue([tailText]);
    }
    transLine(chat, idx, text);
  } catch (err) {
    if (isAbort(err) || mine !== seq) return;
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
    // **抄一份再存。** 每一行的 audio 是那一轮的 bucket，挂断时还可能有一句
    // 在合成、回来往里 push —— 不抄的话那一 push 改的是库里这条记录的内存
    // 副本，重开应用就没了，文件却留在那儿成了孤儿
    const log = lines.map(l => ({ ...l, ...(l.audio ? { audio: [...l.audio] } : {}) }));
    const msg = messages.create({
      chatId, kind: 'call',
      // 记在发起的那一方名下，气泡才落在正确的一侧
      role: direction === 'out' ? 'user' : 'char',
      authorId: direction === 'out' ? 'me' : charId,
      direction, outcome, seconds, callLog: log, callKind: video ? 'video' : 'voice',
      content: `[${label(direction, outcome, seconds, video)}]${body ? '\n' + body : ''}`,
      status: 'done',
    });
    lastMsgId = msg.id;
    chats.update(chatId, { lastMessageAt: Date.now() });
    // 打完就总结。默认关着（第 15 条）：一通电话多一次调用
    if (outcome === 'done' && log.length && settings.get().callSummary !== false) {
      summarize(msg.id).catch(err => console.warn('[call] 总结没生成:', err.message || err));
    }
  }
  reset({ outcome });
}

// ---- 通话里的翻译 ----
//
// **台词只管说，翻译另翻一道。** 通话里不让模型在台词后面夹 `[译文：…]`：
// 那一行会被原样念出来、混进字幕，而 skeleton.call 明文禁止方括号 ——
// 两句话在同一份提示词里打架。所以拼提示词时把这段对话的翻译设置摘掉（plain），
// 角色说完一整轮再单独翻。
//
// **念出来的永远是原文。** 送进语音接口的是角色说的那句话本身，
// 字幕在原文下面另起一行显示译文。
//
// 开关就是这段对话自己的「翻译」设置（第 5 条），没开就一次都不翻。
// 一轮一次，登记在 cost.js 的 callTranslate。
const plain = chat => (chat && chat.translateTo ? { ...chat, translateTo: '' } : chat);

// 通话里要不要让角色自己标台本。和聊天里的语音消息是同一个开关
//（「合成语音前先写成台本」），只是通话里不另调接口
const scriptOn = () => settings.get().writeVoicePrompt === true;

let lastMsgId = '';

async function transLine(chat, idx, text) {
  if (!chat?.translateTo || !text) return;
  let tr = '';
  try {
    [tr] = await translate.runAny([text], {
      lang: chat.translateTo, extra: chat.translateRules, key: `call-tr:${chat.id}:${idx}`,
    });
  } catch (err) {
    console.warn('[call] 这一句没翻出来:', err.message || err);
    return;
  }
  if (!tr) return;
  // 电话还在打：写回字幕
  const cur = call.get().lines;
  if (call.get().chatId === chat.id && cur[idx] && cur[idx].text === text) {
    call.set({ lines: cur.map((l, i) => (i === idx ? { ...l, trans: tr } : l)) });
    return;
  }
  // 已经挂了：写回刚落下的那条通话记录。翻译比挂断慢一步是常事，
  // 不补回去的话最后那一句在记录里永远没有译文
  const m = lastMsgId && messages.get(lastMsgId);
  if (m && m.chatId === chat.id && m.callLog?.[idx]?.text === text) {
    messages.update(m.id, { callLog: m.callLog.map((l, i) => (i === idx ? { ...l, trans: tr } : l)) });
  }
}

// ---- 总结 ----
//
// 打完电话写一段总结。自动的那一档**默认开着**（用户明确要求，是第 15 条的
// 例外，登记在 check-calls.mjs 的 ALLOW_ON）；通话记录里另有一个按钮，随时手动生成一次。
//
// 总结写成**这段对话设置的翻译语言**，没设就跟通话本身同一种语言 ——
// 那是写给人看的，而人已经在这段对话里说过自己要看什么语言了。
export async function summarize(msgId) {
  const m = messages.get(msgId);
  if (!m || m.kind !== 'call') throw new Error('这条不是通话记录');
  const lines = m.callLog || [];
  if (!lines.length) throw new Error('这通电话没有留下内容');
  const chat = chats.get(m.chatId);
  const char = characters.get((chat?.characterIds || [])[0]);
  const me = accounts.get(chat?.personaId)?.name || accounts.current()?.name || '我';
  const body = lines.map(l => `${l.role === 'user' ? me : (char?.name || '对方')}：${l.text}`).join('\n');
  const out = await runTextTask('call.summary', {
    system: fillTemplate(template('task.call-summary'), {
      lang: chat?.translateTo || 'the same language as the transcript',
    }),
    user: body,
    key: `call-sum:${msgId}`,
    maxTokens: 600,
  });
  const text = String(out || '').trim();
  if (!text) throw new Error('没有生成出内容');
  messages.update(msgId, { callSummary: text });
  return text;
}

/**
 * 整通电话的声音，按说话顺序接成一个文件。
 *
 * 各家语音接口回的都是 mp3，mp3 按帧存，首尾直接相接大多数播放器都认。
 * 接不成（某一句的文件已被清理）就跳过那一句，不让整个下载失败。
 */
export async function wholeAudio(msgId) {
  const m = messages.get(msgId);
  const ids = (m?.callLog || []).flatMap(l => l.audio || []);
  const blobs = [];
  for (const id of ids) {
    const b = await files.blob(id).catch(() => null);
    if (b) blobs.push(b);
  }
  if (!blobs.length) return null;
  return new Blob(blobs, { type: blobs[0].type || 'audio/mpeg' });
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
