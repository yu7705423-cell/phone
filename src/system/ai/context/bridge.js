import { chats, messagesOf, characters, settings } from '../../db/index.js';
import * as accounts from '../../accounts.js';
import * as sceneStore from '../../scene.js';

// 线上与线下之间那一段。见 ARCHITECTURE 4.107
//
// 从前定的是「摘要互通，原文不互通」。那条太紧了：chat.summary 只覆盖
// **更早之前**，刚发的那几条根本不在里面 —— 于是「在手机上说好楼下见，
// 见了面却完全不知道这回事」。用户撞见的就是这个。
//
// **两边的原文成本不对称，所以不该对称处理。**
//   线上一条气泡二十来字，二十条也才几百字 —— 带原文，便宜；
//   线下一段上千字 —— 带不起，只带摘要，没有摘要就截一小段。
//
// 截的那一段不调接口（第 15 条）。想要真摘要就把「收场摘要」打开。

export const meta = {
  id: 'bridge',
  label: '另一边',
  desc: '线下带上手机里刚说过的几句；线上带上最近一次见面。两个数在「用量与上限」里',
};

const chatLines = () => Math.max(0, Math.round(Number(settings.get().bridgeChatLines) || 0));
const sceneChars = () => Math.max(0, Math.round(Number(settings.get().bridgeSceneChars) || 0));

const cut = (text, n) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// ---- 线下这一侧：刚才在手机上说了什么 ----
function fromChat({ chat, char, persona }) {
  const n = chatLines();
  if (!n || !chat) return '';
  const list = messagesOf(chat.id)
    .filter(m => m.status !== 'error' && String(m.content || '').trim())
    .slice(-n);
  if (!list.length) return '';

  const meName = persona?.name || accounts.current()?.name || '我';
  const lines = list.map(m => {
    const who = m.role === 'user'
      ? meName
      : (characters.get(m.authorId)?.name || char?.name || '对方');
    return `${who}：${cut(m.content, 120)}`;
  });
  return `\n\n[刚才在手机上]\n${lines.join('\n')}\n`
    + 'These messages were exchanged on the phone shortly before now. '
    + 'They are part of what has already happened.\n';
}

// ---- 线上这一侧：最近一次见面 ----
function fromScene({ chat }) {
  const n = sceneChars();
  if (!n || !chat) return '';
  const row = sceneStore.ofChat(chat.id)[0];
  if (!row) return '';

  const body = String(row.summary || '').trim()
    // 没有摘要就截最后一段。这一步不调接口 —— 真摘要要开「收场摘要」
    || (() => {
      const beats = sceneStore.beatsOf(row.id).filter(b => b.role !== sceneStore.DIRECTOR);
      return beats.length ? beats[beats.length - 1].text : '';
    })();
  if (!String(body).trim()) return '';

  const head = [row.title || row.place, sceneStore.timeOf(row.id)].filter(Boolean).join('　');
  return `\n\n[最近一次见面]\n${head ? head + '\n' : ''}${cut(body, n)}\n`
    + 'This is what happened the last time the two of you were together in person.\n';
}

export function build(ctx) {
  return ctx?.side === 'scene' ? fromChat(ctx) : fromScene(ctx);
}
