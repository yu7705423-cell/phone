import { characters, chats } from '../../db/index.js';
import * as accounts from '../../accounts.js';
import * as clock from '../../time.js';
import * as dayStore from '../../day.js';
import * as space from '../../space.js';
import { fillTemplate, template } from '../templates.js';
import { runJSONTask } from '../engine.js';

// 生成角色当天的日程。
//
// **一天只调一次。** 这是整个功能里唯一花钱的地方 —— 撞上什么、吃什么、
// 运势怎么走，全是本地掷的（见 day.js 的 rollLocal）。
//
// 生成的是「她打算干什么」，不是「她今天过得怎么样」。后者要等时间真的走过去，
// 由聊天本身写出来。所以这里只要时段和一句话，不要结果、不要心情。
//
// 纪念日、还没完成的约定、今天是不是周末，是**硬约束**：它们必须落进日程里。
// 一个人不会在纪念日当天随便安排别的事。

export const dayKey = charId => `day-plan:${charId}`;

// 这个角色和当前身份之间那段单人会话 —— 纪念日和约定都长在它上面。
function pairChatOf(charId) {
  const me = accounts.currentId();
  return chats.all().find(c => (c.characterIds || []).length === 1
    && c.characterIds[0] === charId && (c.personaId || me) === me) || null;
}

function constraintsOf(charId, date) {
  const chat = pairChatOf(charId);
  if (!chat) return '';
  const lines = [];
  space.upcoming(chat.id).forEach(x => {
    if (x.left === 0) lines.push(`- 今天是${x.item.title}，这一天的安排必须围绕它`);
    else if (x.left > 0 && x.left <= 3) lines.push(`- 再过 ${x.left} 天是${x.item.title}，可以开始准备`);
  });
  space.pacts(chat.id)
    .filter(m => m.pact === space.PACT_OPEN)
    .forEach(m => lines.push(`- 还欠着一个约定：${m.title}`));
  return lines.join('\n');
}

/**
 * 生成日程。返回的是**还没入库**的 [{ slot, text }]，由调用方决定存不存。
 */
export async function generatePlan(charId) {
  const char = characters.get(charId);
  if (!char) throw new Error('角色不存在');
  const date = dayStore.dateKey(char);
  const cons = constraintsOf(charId, date);

  const system = fillTemplate(template('task.day-plan'), {
    charName: char.name || '她',
    charPersona: char.persona || '（没写人设）',
    date,
    weekday: dayStore.weekdayOf(char),
    zone: clock.zoneLabel(clock.charZone(char)),
    slots: dayStore.SLOTS.map(s => `${s.id} = ${s.label}（${s.from} 点到 ${s.to} 点）`).join('\n'),
    constraints: cons ? `## 今天有这些绕不开的事\n${cons}` : '',
  });

  const out = await runJSONTask('day.plan', {
    system, key: dayKey(charId), maxTokens: 1200,
  });

  const rows = Array.isArray(out?.items) ? out.items : [];
  return rows
    .map(it => ({
      slot: dayStore.slotOf(it?.slot) ? it.slot : '',
      text: String(it?.text ?? '').trim().slice(0, 60),
    }))
    .filter(it => it.slot && it.text);
}

/**
 * 生成并落库，本地那几样（大运、随机事件、三顿）顺手一起掷了。
 * force 为真就重排今天 —— 同一天再落一次是整条换掉。
 */
export async function makeToday(charId, { force = false, rng } = {}) {
  const char = characters.get(charId);
  if (!char) throw new Error('角色不存在');
  if (!dayStore.isOn(char)) throw new Error('这个角色还没有开启当日日程');
  const date = dayStore.dateKey(char);
  const had = dayStore.get(charId, date);
  if (had && !force) return had;

  const items = await generatePlan(charId);
  const local = dayStore.rollLocal(charId, { rng, date });
  return dayStore.save(charId, { date, items, ...local });
}

/**
 * 开着日程的角色，今天还没生成的就生成。聊天开始前调一次。
 * 失败不抛：日程没排出来不该让消息发不出去。
 */
export async function ensureToday(charId) {
  const char = characters.get(charId);
  if (!char || !dayStore.isOn(char)) return null;
  if (dayStore.today(charId)) return null;
  try { return await makeToday(charId); }
  catch (err) { console.warn('[day] 今天的日程没排出来:', err.message || err); return null; }
}
