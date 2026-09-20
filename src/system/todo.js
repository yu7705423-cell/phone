import { todos, settings } from './db/index.js';
import * as when from './when.js';

/**
 * 待办。**用户自己的**，不是角色的日程（那是 day.js），也不是你们之间的
 * 约定（那是 space.js 的 pact）。
 *
 * ---- 两道监督 ----
 *
 * 聊天里说过的事，隔天谁都不记得。所以两边各看一眼：
 *
 *   **本地这一道**  用户发出去的每句话过一遍线索词（我想、打算、准备……）。
 *                   不花钱、不延迟、每条都看。代价是它只认字面：
 *                   「我想你了」和「我想去看那个展」在它眼里一样。
 *   **角色那一道**  角色在回复里写 `[待办：…]`。它读得懂那句话是不是真要做
 *                   一件事，但它只在自己想起来的时候写。**不多花一次接口**：
 *                   这个标记搭在本来就要发的那次回复上（第 15 条）。
 *
 * 两道都不准，所以两道都不直接入库 —— **一律先落成待确认**，
 * 屏幕上问一句，点了才算。没点的那条记为忽略，不再问第二遍。
 *
 * 这一层只管数据与识别，不碰界面。
 */

export const PENDING = 'pending';   // 检测到了，等用户点头
export const OPEN = 'open';         // 已计入，还没做
export const DONE = 'done';
export const DROP = 'drop';         // 忽略掉的，留着免得反复问同一句

export const FROM_LOCAL = 'local';
export const FROM_CHAR = 'char';
export const FROM_ME = 'manual';

export const fromLabel = f =>
  (f === FROM_CHAR ? '角色提出' : f === FROM_LOCAL ? '对话中识别' : '手动添加');

/**
 * 线索词。**用户可以自己改**（第 13 条），设置在「待办」里。
 *
 * 这一份是默认值不是上限：加几个自己常说的、删掉老误报的那几个，都随意。
 * 改成空的一条都不剩，就等于把本地这一道关了。
 */
export const DEFAULT_CUES = [
  '我想', '我要', '我打算', '打算', '我准备', '准备', '我得', '我该',
  '记得', '别忘', '不要忘', '提醒我', '回头', '有空', '改天', '下次',
  '要去', '想去', '得去', '要买', '想买', '要做', '想做', '要写', '要看',
];

/**
 * 明知会误报的那几句。线索词一撞上它们就不当待办。
 *
 * 「我想你」是这一类里最典型的：它是这个 app 上最常出现的句子之一，
 * 而它一个待办都不是。同样可以自己改。
 */
export const DEFAULT_SKIPS = [
  '我想你', '我想他', '我想她', '我想吃你', '我要睡', '我想睡', '我要死',
  '我想哭', '我要哭', '我想笑', '我要疯', '我想不', '我要是', '我想起',
  '我想到', '我要不', '准备好', '打算好', '我得了',
];

const listOf = (key, fallback) => {
  const raw = settings.get()[key];
  return Array.isArray(raw)
    ? raw.map(x => String(x || '').trim()).filter(Boolean)
    : fallback;
};

export const cues = () => listOf('todoCues', DEFAULT_CUES);
export const skips = () => listOf('todoSkips', DEFAULT_SKIPS);
export const detectOn = () => settings.get().todoDetect !== false;

/** 本地这一道开着没有。线索词删光了也算关着。 */
export const localOn = () => detectOn() && cues().length > 0;

// 一句话截到哪儿为止。待办是一句短话，整段独白塞进去没法看
const STOP = /[。！？；\n，,.!?;]/;
const MAX = 40;

/**
 * 本地识别。命中返回 `{ cue, text }`，没命中返回 null。
 *
 * 取的是线索词**连同它后面那一截**：「我想去看那个展」记成「我想去看那个展」，
 * 不是「去看那个展」—— 去掉线索词读着更像待办，可万一切错了，
 * 留着原话至少还看得出这条是从哪句话来的。
 */
export function detect(text, { cueList = cues(), skipList = skips() } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  for (const cue of cueList) {
    const at = raw.indexOf(cue);
    if (at < 0) continue;
    const rest = raw.slice(at);
    if (skipList.some(s => rest.startsWith(s))) continue;
    const stop = rest.search(STOP);
    const one = (stop > 0 ? rest.slice(0, stop) : rest).trim();
    // 光一个线索词不算事。「我想」后面什么都没有，那是半句话
    if (one.length <= cue.length) continue;
    return { cue, text: one.slice(0, MAX) };
  }
  return null;
}

// 同一件事不问第二遍。已经忽略过的也算数 —— 它正是「我不要这条」的意思
const already = (text, chatId) => {
  const t = String(text || '').trim();
  return todos.all().some(x => x.chatId === chatId && String(x.text).trim() === t);
};

/**
 * 落一条待确认的。重复的、空的都不落，返回落下的那条或者 null。
 *
 * **两道监督都走这里**，谁都不能直接写成已计入 —— 这一条是这个功能的全部
 * 分寸所在：它在替你记事，不是在替你决定。
 */
export function propose({ text, chatId = '', charId = '', srcMsgId = '', from = FROM_LOCAL }) {
  const t = String(text || '').trim().slice(0, 200);
  if (!t || already(t, chatId)) return null;
  // 「明天七点去跑步」里那个时刻顺手认出来（见 system/when.js）。
  // **只认说到点钟的**：一句话里顺口带了个「今天」不算约了时间，
  // 那种只会平白给人挂上一个凌晨零点的闹钟
  const got = when.parse(t);
  const at = got?.hasTime ? got.at : 0;
  return todos.create({
    text: t, chatId, charId, srcMsgId, from,
    state: PENDING, dueAt: '', remindAt: at > Date.now() ? at : 0,
    createdAt: Date.now(),
  });
}

/** 用户自己加的一条，不经过确认那一步 —— 他刚刚亲手写完。 */
export function addMine(text, patch = {}) {
  const t = String(text || '').trim().slice(0, 200);
  if (!t) return null;
  return todos.create({
    text: t, chatId: '', charId: '', srcMsgId: '', from: FROM_ME,
    state: OPEN, dueAt: '', createdAt: Date.now(), ...patch,
  });
}

export const get = id => todos.get(id);
export const update = (id, patch) => todos.update(id, patch);
export const remove = id => todos.remove(id);

export const setState = (id, state) => todos.update(id, {
  state,
  doneAt: state === DONE ? Date.now() : 0,
});

export const accept = id => setState(id, OPEN);
export const ignore = id => setState(id, DROP);

/** 某个状态的全部，新的在前。 */
export const listOfState = state => todos.where(x => x.state === state)
  .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

export const openOnes = () => listOfState(OPEN);
export const doneOnes = () => listOfState(DONE);

/** 这段对话里还等着确认的那几条。界面上一条一条问。 */
export const pendingOf = chatId => todos
  .where(x => x.state === PENDING && x.chatId === chatId)
  .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

/** 全部等着确认的，不分对话。「待办」那一页上单列一栏。 */
export const pendingAll = () => listOfState(PENDING);

/** 忽略掉的清干净。留着只为了不反复问，清了就会重新问起。 */
export function clearDropped() {
  const gone = listOfState(DROP);
  gone.forEach(x => todos.remove(x.id));
  return gone.length;
}
