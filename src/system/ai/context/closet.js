import * as closet from '../../closet.js';
import { groupOf, COLORS, labelIn } from '../../closet-kinds.js';
import { characters } from '../../db/index.js';
import { dateKey } from '../../health.js';

// 衣帽间那一段（system/closet.js，ARCHITECTURE 4.213）。
//
// 三样，只写事实（第 16 条）：
//   今天穿的     对方今天勾了的那几件；角色自己今天穿的（用户替它挑的）。有礼物就写是谁送的、哪天
//   清单         **只在聊到穿搭、化妆的时候带**。按大类分行，每类几件在「用量与上限」里改
//   快用完、快过期  低频：一件东西只在第一次递出去的那一天出现，之后隔冷却期（默认 30 天）
//                才再出现一次（closet.takeAlerts）。频率是代码管的，不靠提示词去劝
//   好久没穿     同样低频：一次一件，两次之间至少隔几天（closet.takeIdle，ARCHITECTURE 4.214）
//
// 带不带清单用一份本地词表认（「穿、搭配、口红……」），和能力目录的冷热同一个做法，不花钱

export const meta = {
  id: 'closet',
  label: '衣帽间',
  desc: '对方与角色今天穿的；聊到穿搭、化妆时带上衣帽间的清单；快用完、快过期与好久没穿的东西隔一段时间出现一次',
};

const { WEAR_TOPIC } = closet;
const BEAUTY_TOPIC = /化妆|妆|口红|唇|粉底|眼影|腮红|香水|护肤|面膜|防晒|makeup|lipstick|perfume/i;

// 这一轮在聊什么：最近几条我说的话
const talkOf = messages => (messages || []).filter(m => m.role === 'user').slice(-3)
  .map(m => String(m.content || '')).join('\n');

function tagsOf(r) {
  const g = groupOf(r.group);
  const where = [g?.label, r.sub].filter(Boolean).join(' / ');
  const colors = (r.colors || []).map(id => labelIn(COLORS, id)).filter(Boolean).join('、');
  return [where, colors, r.shade].filter(Boolean).join('; ');
}

// 来源那一小段，按「读它的这个角色」的视角写
function originOf(r, char, userName) {
  if (r.source === 'gift' && r.giver) {
    const from = r.giver === char?.id ? 'you'
      : r.giver === closet.ME ? userName : (characters.get(r.giver)?.name || 'someone');
    return `a gift from ${from}${r.giftAt ? `, ${dateKey(r.giftAt)}` : ''}`;
  }
  if (r.source === 'made') return r.with === char?.id ? 'made together with you' : 'made together with someone';
  return '';
}

function itemLine(r, char, userName) {
  const tags = tagsOf(r);
  const origin = originOf(r, char, userName);
  const desc = closet.garmentOnly(r.desc).slice(0, 60);
  return `- ${r.name}${tags ? ` (${tags})` : ''}${desc ? `: ${desc}` : ''}${origin ? `; ${origin}` : ''}`;
}

function alertLine(r, f) {
  const bits = [];
  if (f.low) bits.push(`about ${f.low.pct}% left; at the recorded usage it runs out in about ${f.low.daysLeft} days`);
  if (f.exp) {
    bits.push(f.exp.daysLeft < 0
      ? `past its use-by date (${dateKey(f.exp.at)})`
      : `use-by date ${dateKey(f.exp.at)}, in ${f.exp.daysLeft} days`);
  }
  return `- ${r.name}${tagsOf(r) ? ` (${tagsOf(r)})` : ''}: ${bits.join('; ')}`;
}

export function build({ char, persona, messages, settings: s } = {}) {
  const pid = persona?.id;
  const user = persona?.name || 'They';
  const limit = Math.max(0, Math.round(Number(s?.closetListMax ?? 8) || 0));
  const talk = talkOf(messages);
  const out = [];

  const mine = closet.wornToday(closet.ME, pid);
  if (mine.length) out.push(`## What ${user} is wearing today`, ...mine.map(r => itemLine(r, char, user)));
  const theirs = char ? closet.wornToday(char.id) : [];
  if (theirs.length) out.push('## What you are wearing today', ...theirs.map(r => itemLine(r, char, user)));

  if (WEAR_TOPIC.test(talk)) {
    const a = closet.listLines(closet.ME, pid, 'wear', limit);
    if (a.length) out.push(`## ${user}'s wardrobe`, ...a);
    const b = char ? closet.listLines(char.id, '', 'wear', limit) : [];
    if (b.length) out.push('## Your own wardrobe', ...b);
  }
  if (BEAUTY_TOPIC.test(talk)) {
    const a = closet.listLines(closet.ME, pid, 'beauty', limit);
    if (a.length) out.push(`## ${user}'s dressing table`, ...a);
  }

  const alerts = closet.takeAlerts(pid);
  if (alerts.length) out.push(`## On ${user}'s dressing table`, ...alerts.map(x => alertLine(x.item, x.f)));

  // 好久没穿：一次一件，两次之间隔几天，同一件一段闲置只递一次（closet.takeIdle）
  const idle = closet.takeIdle(pid);
  if (idle) {
    const days = Math.floor((idle.idleAt - idle.lastWorn) / 86400000);
    out.push(`## ${user} has not worn this for a while`,
      `- ${idle.name}${tagsOf(idle) ? ` (${tagsOf(idle)})` : ''}: last worn ${dateKey(idle.lastWorn)}, ${days} days ago`);
  }

  if (!out.length) return '';
  return `\n\n[衣帽间]\n${out.join('\n')}\n`
    + 'These come from their own records. Anything not listed here is unknown; do not invent items.\n';
}
