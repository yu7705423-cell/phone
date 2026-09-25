import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Sheet, Button, Field, Input, Icon, Page, EmptyState, toast, prompt, confirm } from '../../ui/index.js';
import { Thumb, ownerName } from './parts.js';

const { db, nav, closet, intent } = phone;

// 单品页下半截的三样（ARCHITECTURE 4.216）：借出与归还、记下的回忆、在会话里用一下。
// 另有从会话里「记到衣帽间」进来的那一页

const pad = n => String(n).padStart(2, '0');
const dayOf = ms => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** 借出与归还。自己的东西可以借给某个角色；角色的东西可以借来穿 */
export function LoanPart({ item }) {
  const [picking, setPicking] = useState(false);
  if (item.side !== 'wear') return null;
  const mine = item.owner === closet.ME;
  const chars = db.characters.all().filter(c => !c.parentId && c.id !== item.owner);
  if (closet.lentOut(item)) {
    const to = item.lent.to;
    return html`
      <div class="cl-section">借穿</div>
      <div class="cl-loan">
        <span>${to === closet.ME ? '已借给我' : `已借给${ownerName(to)}`} · ${dayOf(item.lent.at)}</span>
        <${Button} size="sm" variant="ghost" onClick=${() => { closet.giveBack(item.id); toast(mine ? '已收回' : '已归还', 'ok'); }}>
          ${mine ? '收回' : '归还'}<//>
      </div>
      <div class="settings-foot">借出期间，这件东西今天穿不穿算在借的人身上，角色知道这件东西在谁手上。</div>`;
  }
  return html`
    <div class="cl-section">借穿</div>
    <div class="cl-row-btn">
      ${mine
        ? html`<${Button} size="sm" variant="ghost" icon="send" disabled=${!chars.length}
            onClick=${() => setPicking(true)}>借给角色<//>`
        : html`<${Button} size="sm" variant="ghost" icon="hanger"
            onClick=${() => { closet.lend(item.id, closet.ME); toast('已借来，可在「今天穿的」中选择', 'ok'); }}>借来穿<//>`}
    </div>
    ${picking ? html`
      <${Sheet} open=${true} onClose=${() => setPicking(false)} title="借给谁">
        <div class="chip-row">
          ${chars.map(c => html`
            <button key=${c.id} class="chip press" onClick=${() => {
              closet.lend(item.id, c.id);
              setPicking(false);
              toast(`已借给${phone.remark.nameOf(c)}`, 'ok');
            }}>${phone.remark.nameOf(c)}</button>`)}
        </div>
        <div class="settings-foot">借出后，可在该角色的衣帽间里替它勾选今天穿着。</div>
      <//>` : null}`;
}

/** 这件东西上记下的回忆 */
export function MemoryPart({ item }) {
  const list = closet.memoriesOf(item);
  const add = async () => {
    const v = await prompt({ title: '记下一条回忆', placeholder: '例如 第一次去海边时穿着', multiline: true });
    if (v == null || !v.trim()) return;
    closet.addMemory(item.id, { text: v });
  };
  const drop = async m => {
    if (!await confirm({ title: '删除这条回忆', message: m.text, danger: true, okText: '删除' })) return;
    closet.dropMemory(item.id, m.id);
  };
  return html`
    <div class="cl-section">回忆</div>
    ${list.length ? html`
      <div class="cl-mems">
        ${list.map(m => html`
          <div key=${m.id} class="cl-mem">
            <div class="cl-mem-head">
              <span>${dayOf(m.at)}</span>
              ${m.chatId ? html`<button class="nav-text press"
                onClick=${() => intent.open('chat', { route: `/chat/${m.chatId}`, back: true })}>查看对话</button>` : null}
              <button class="nav-text press" onClick=${() => drop(m)}>删除</button>
            </div>
            <p>${m.text}</p>
          </div>`)}
      </div>` : null}
    <div class="cl-row-btn"><${Button} size="sm" variant="ghost" icon="plus" onClick=${add}>记下一条<//></div>
    <div class="settings-foot">
      穿着或带着这件东西的那天，角色会读到最近几条（条数在「设置 - 用量与上限」中修改）。
      也可以在会话中长按一条消息，选择「记到衣帽间」。
    </div>`;
}

/** 在会话里用一下：挑一段会话、一个动作，落一张动作卡片 */
export function UseSheet({ item, open, onClose }) {
  const [chatId, setChatId] = useState('');
  const [act, setAct] = useState('');
  if (!open) return null;
  const targets = closet.useTargets(item);
  const cur = chatId || targets[0]?.id || '';
  const presets = closet.actionsFor(item);
  const send = () => {
    try {
      closet.useInChat(item.id, cur, act);
      toast('已发送到会话', 'ok');
      setAct('');
      onClose();
    } catch (err) { toast(String(err.message || err), 'error'); }
  };
  const nameOf = c => phone.remark.nameOf(db.characters.get(c.characterIds[0])) || '会话';
  return html`
    <${Sheet} open=${true} onClose=${onClose} title=${`在会话中使用「${item.name}」`} height="80%">
      ${targets.length ? html`
        <${Field} label="发到">
          <div class="chip-row">
            ${targets.map(c => html`
              <button key=${c.id} class=${`chip${cur === c.id ? ' is-active' : ''}`} onClick=${() => setChatId(c.id)}>${nameOf(c)}</button>`)}
          </div>
        <//>
        <${Field} label="动作" desc="可选择一个，也可以自己写。发出后是一条动作卡片，不调用接口，角色在下一次回复时读到。">
          <div class="chip-row">
            ${presets.map(p => html`
              <button key=${p} class=${`chip${act === p ? ' is-active' : ''}`} onClick=${() => setAct(p)}>${p}</button>`)}
          </div>
          <${Input} value=${act} onInput=${setAct} placeholder="例如 帮你喷在手腕上"/>
        <//>
        <div class="sheet-acts">
          <${Button} variant="ghost" onClick=${onClose}>取消<//>
          <${Button} disabled=${!act.trim()} onClick=${send}>发送<//>
        </div>`
      : html`<div class="settings-foot">还没有一对一的会话。</div>`}
    <//>`;
}

/**
 * 从会话里长按一条消息「记到衣帽间」进来：挑一件东西，把那句话记成它的回忆。
 * 列的是我自己的和这段会话里那位角色的
 */
export function RememberPage({ msgId }) {
  useStore(db.closet.store);
  const [q, setQ] = useState('');
  const msg = db.messages.get(msgId);
  if (!msg) return html`<${Page} title="记到衣帽间" onBack=${nav.pop}><${EmptyState} title="这条消息已不在了"/><//>`;
  const charId = (db.chats.get(msg.chatId)?.characterIds || [])[0] || '';
  const text = String(msg.content || '').trim();
  const t = q.trim().toLowerCase();
  const rows = [closet.ME, charId].filter(Boolean).flatMap(o => closet.itemsOf(o)
    .filter(r => !closet.isOutfit(r) && closet.live(r) && r.group)
    .filter(r => !t || `${r.name} ${r.sub}`.toLowerCase().includes(t)));
  const pick = r => {
    closet.addMemory(r.id, { text, at: msg.createdAt, chatId: msg.chatId, msgId });
    toast(`已记到「${r.name}」`, 'ok');
    nav.replace(`/item/${r.id}`);
  };
  return html`
    <${Page} title="记到衣帽间" onBack=${nav.pop}>
      <div class="msg-menu-quote">${text || '（空）'}</div>
      <div class="pad-x cl-search"><${Input} value=${q} onInput=${setQ} placeholder="搜索名称或小类"/></div>
      ${rows.length ? html`
        <div class="cl-gen">
          ${rows.map(r => html`
            <button key=${r.id} class="cl-gen-row is-on cl-pick-row press" onClick=${() => pick(r)}>
              <div class="cl-pick-thumb"><${Thumb} item=${r}/></div>
              <div class="cl-gen-body">
                <b>${r.name}</b>
                <span>${[r.owner === closet.ME ? '我的' : `${ownerName(r.owner)}的`, closet.kinds.groupOf(r.group)?.label, r.sub].filter(Boolean).join(' · ')}</span>
              </div>
            </button>`)}
        </div>`
      : html`<${EmptyState} icon="hanger" title="没有可选的东西" desc="衣帽间里分好类的东西才会列在这里。"/>`}
    <//>`;
}
