// 剧情里的衣帽间（ARCHITECTURE 4.217）。
//
// 衣帽间不是一个单独的 app，它是剧情的一部分：角色在聊天或线下剧情里换了件衣服、借走你的围巾、
// 把外套借给你、还回来、趁你不注意往你包里塞了点什么，衣帽间都要跟着变。
//
// 靠的是几个标记（角色写，本地认，不多调接口）：
//   [换上：名字]      该角色换上自己衣帽间里的、或借来的一件
//   [借走：名字]      该角色借走对方的一件
//   [借给你：名字]    该角色把自己的一件借给对方
//   [归还：名字]      还回一件借着的，哪一边的都行
//   [塞进包里：东西]  只在线下：偷偷放进对方包里。对方在收场之前看不到
//
// 线上走 reply.js（落一行提示，重新生成那一轮时撤回）；线下走 scene.js 的 addBeat 那几处
// （标记从正文里摘掉，记在那一段上，重写、删掉那一段时撤回）。认不出是哪一件就当没写过：
// 凭空借走一件不存在的东西比少记一笔更糟。
//
// 我这一边往对方包里放东西走界面（线下「这一场」菜单里），不写标记：那一行要是写进正文，
// 角色当场就读到了。
import { scenes, chats, characters, messages, closet as closetDb } from './db/index.js';
import * as accounts from './accounts.js';
import * as closet from './closet.js';
import { foldMarks } from './markfold.js';

export const MARK = /[[【]\s*(换上|借走|借给你|归还|塞进包里)\s*[:：]\s*([^\]】]+)[\]】]/g;

const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();

// 按名字认一件：一模一样的先，互相包含的其次
function find(rows, name) {
  const k = norm(name);
  if (!k) return null;
  return rows.find(r => norm(r.name) === k)
    || rows.find(r => norm(r.name) && (k.includes(norm(r.name)) || norm(r.name).includes(k))) || null;
}

const wearable = rows => rows.filter(r => r.side === 'wear' && !closet.isOutfit(r) && closet.live(r));

/** 这一条改了哪一件、改之前是什么样。撤回时照着改回去 */
const snap = r => ({ id: r.id, lent: r.lent || null, wornOn: r.wornOn || '', wornCount: r.wornCount || 0, lastWorn: r.lastWorn || 0 });

/**
 * 做一件事。返回 { kind, name, itemId, text, undo }；认不出返回 null。
 * text 是给界面与历史的那一句（中文，是数据）
 */
export function act(kind, body, { charId, personaId = accounts.currentId() } = {}) {
  const char = characters.get(charId);
  const name = String(body || '').trim().slice(0, 40);
  if (!char || !name) return null;
  const who = char.name || '对方';
  if (kind === '换上') {
    const r = find(wearable([...closet.itemsOf(charId).filter(x => !closet.lentOut(x)), ...closet.borrowedBy(charId)]), name);
    if (!r) return null;
    const undo = snap(r);
    closet.wear(r.id, true);
    return { kind, name: r.name, itemId: r.id, undo, text: `${who}换上了${r.owner === charId ? '' : '借来的'}${r.name}` };
  }
  if (kind === '借走') {
    const r = find(wearable(closet.itemsOf(closet.ME, personaId).filter(x => !closet.lentOut(x))), name);
    if (!r) return null;
    const undo = snap(r);
    closet.lend(r.id, charId);
    return { kind, name: r.name, itemId: r.id, undo, text: `${who}借走了你的${r.name}` };
  }
  if (kind === '借给你') {
    const r = find(wearable(closet.itemsOf(charId).filter(x => !closet.lentOut(x))), name);
    if (!r) return null;
    const undo = snap(r);
    closet.lend(r.id, closet.ME);
    return { kind, name: r.name, itemId: r.id, undo, text: `${who}把${r.name}借给了你` };
  }
  if (kind === '归还') {
    const r = find(closet.lentBetween(charId, personaId), name);
    if (!r) return null;
    const undo = snap(r);
    closet.giveBack(r.id);
    return { kind, name: r.name, itemId: r.id, undo,
      text: r.owner === charId ? `你把${r.name}还给了${who}` : `${who}把${r.name}还给了你` };
  }
  return null;
}

/** 撤回一件事：把那一件改回做之前的样子 */
export function undo(u) {
  if (!u || !u.id || !closetDb.has(u.id)) return;
  closetDb.update(u.id, { lent: u.lent, wornOn: u.wornOn, wornCount: u.wornCount, lastWorn: u.lastWorn });
}

// ---- 线下：一段正文里的标记 ----

/**
 * 从一段线下正文里摘出标记、照做，返回摘干净的正文与做了的几件事。
 * 塞进包里的记在这一场的 slips 上
 */
export function takeMarks(text, { sceneId, beatId = '', charId }) {
  const done = [];
  const t = foldMarks(String(text || '')).replace(MARK, (all, kind, body) => {
    if (kind === '塞进包里') {
      const s = slip(sceneId, { from: 'char', authorId: charId, what: body, beatId });
      if (s) done.push({ kind, name: s.what, slipId: s.id });
      return '';
    }
    const r = act(kind, body, { charId });
    if (r) done.push(r);
    return '';
  }).replace(/\n{3,}/g, '\n\n').trim();
  return { text: t, done };
}

/** 撤回一段正文里做过的几件事（重写、删掉那一段时） */
export function undoAll(done, sceneId) {
  (done || []).forEach(d => {
    if (d.slipId) dropSlip(sceneId, d.slipId);
    else undo(d.undo);
  });
}

// ---- 塞进包里 ----
//
// 记在这一场上：{ id, from: 'char' | 'me', authorId, what, beatId, at }。
// 收场时（arrive）才落到会话里：角色放的，我这边收到一张「包里多了一样东西」，点开才看得到；
// 我放的，落一行角色到家打开包发现了什么，角色下一轮读到

export function slip(sceneId, { from, authorId = '', what, beatId = '' }) {
  const row = scenes.get(sceneId);
  const w = String(what || '').trim().slice(0, 60);
  if (!row || !w || row.endedAt) return null;
  const s = { id: `sl${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    from: from === 'me' ? 'me' : 'char', authorId, what: w, beatId, at: Date.now() };
  scenes.update(sceneId, { slips: [...(row.slips || []), s] });
  return s;
}

export function dropSlip(sceneId, id) {
  const row = scenes.get(sceneId);
  if (row) scenes.update(sceneId, { slips: (row.slips || []).filter(s => s.id !== id) });
}

/** 还没收场、还没落到会话里的那几样 */
export const slipsOf = (sceneId, from = '') => (scenes.get(sceneId)?.slips || [])
  .filter(s => !s.arrived && (!from || s.from === from));

/**
 * 收场：包里的东西落到会话里。只做一次（arrived）。
 * 角色放的：一张封着的卡片，我点开才看得到（openSlip）。
 * 我放的：一行提示，角色回到家打开包发现了什么，下一轮读到；认得出是衣帽间里的东西就收进它的衣帽间
 */
export function arrive(sceneId) {
  const row = scenes.get(sceneId);
  if (!row) return [];
  const chat = chats.get(row.chatId);
  const charId = (row.castIds || [])[0] || (chat?.characterIds || [])[0] || '';
  const char = characters.get(charId);
  const out = [];
  const list = (row.slips || []).map(s => {
    if (s.arrived) return s;
    if (s.from === 'char') {
      out.push(messages.create({
        chatId: row.chatId, role: 'char', authorId: s.authorId || charId, kind: 'slip', status: 'done',
        slipWhat: s.what, slipOpened: false, sceneId,
        content: `[塞进包里：${s.what}]`,
      }));
    } else {
      out.push(messages.create({
        chatId: row.chatId, role: 'user', authorId: closet.ME, kind: 'notice', status: 'done',
        content: `[${char?.name || '对方'}回到家打开包，发现了你偷偷放进去的：${s.what}]`,
      }));
      if (char) {
        const k = closet.guessKind(s.what);
        closet.create({ owner: char.id, name: s.what, ...(k || { group: closet.CARRY, sub: '小物' }),
          source: 'gift', giver: closet.ME, giftChatId: row.chatId, giftAt: Date.now() });
      }
    }
    return { ...s, arrived: true };
  });
  if (out.length) {
    scenes.update(sceneId, { slips: list });
    chats.update(row.chatId, { lastMessageAt: Date.now() });
  }
  return out;
}

/** 我打开包：卡片揭开，落一行我发现了什么，角色下一轮读到 */
export function openSlip(msgId) {
  const m = messages.get(msgId);
  if (!m || m.kind !== 'slip' || m.slipOpened) return null;
  messages.update(msgId, { slipOpened: true });
  return messages.create({
    chatId: m.chatId, role: 'user', authorId: closet.ME, kind: 'notice', status: 'done',
    content: `[打开包，发现了：${m.slipWhat}]`,
  });
}

/** 打开之后收进我的衣帽间。认得出分类就放进那一类，认不出放进随身 */
export function keepSlip(msgId) {
  const m = messages.get(msgId);
  if (!m || m.kind !== 'slip' || !m.slipOpened) return null;
  const had = closetDb.all().find(r => r.giftMsgId === msgId);
  if (had) return had;
  const k = closet.guessKind(m.slipWhat);
  return closet.create({ owner: closet.ME, name: m.slipWhat, ...(k || { group: closet.CARRY, sub: '小物' }),
    source: 'gift', giver: m.authorId, giftMsgId: msgId, giftChatId: m.chatId, giftAt: m.createdAt || Date.now() });
}

/** 给线下提示词的那一段：这一场里该角色自己偷偷放进去、对方还不知道的 */
export function secretsFor(sceneId, userName) {
  const list = slipsOf(sceneId, 'char');
  if (!list.length) return '';
  return `## Put into ${userName}'s bag by you during this scene, not yet found by ${userName}\n`
    + list.map(s => `- ${s.what}`).join('\n');
}
