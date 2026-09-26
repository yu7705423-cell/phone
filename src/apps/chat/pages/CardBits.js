import { html, useState, useEffect } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { CardFrame, FullSheet, Icon, List, ListItem, Field, Input, Textarea, Button,
         EmptyState, toast } from '../../../ui/index.js';

// HTML 卡片那一条气泡（ARCHITECTURE 4.250）。
//
// 卡片本身在盒子里（ui/cardframe.js），手指按在盒子里时外面收不到触摸 —— 长按菜单、点开全屏都够不着。
// 所以上面留一条细栏：写着「卡片 · 名字」，长按它照常弹消息菜单，右边一个「展开」。
// 这条栏同时表明「这是一张卡片，不是应用自己的界面」：卡片能画得和应用一模一样。
const { db, htmlcard } = phone;


/** 卡片渲染成整页。头像要先缩成 data: 地址，所以是异步的 */
export function useCardDoc(entry, values, char, persona) {
  const [doc, setDoc] = useState('');
  const key = entry ? JSON.stringify([entry.card, values, char?.name, char?.avatar, persona?.name, persona?.avatar]) : '';
  useEffect(() => {
    if (!entry) { setDoc(''); return undefined; }
    let alive = true;
    htmlcard.sysOf({ char, persona }).then(sys => {
      if (alive) setDoc(htmlcard.docOf(entry.card, values, sys));
    }).catch(() => {});
    return () => { alive = false; };
  }, [key]);
  return doc;
}

// 模板找不到了（那一条删了、改了名字）：把角色填的值原样列出来，话还在
function Plain({ values }) {
  const rows = Object.entries(values || {}).filter(([, v]) => v != null && v !== '');
  return html`
    <div class="hc-plain">
      ${rows.map(([k, v]) => html`
        <div key=${k} class="hc-plain-row">
          <span class="hc-plain-key">${k}</span>
          <span>${Array.isArray(v) ? v.map(x => (x && typeof x === 'object' ? Object.values(x).join('｜') : x)).join('\n') : String(v)}</span>
        </div>`)}
    </div>`;
}

export function CardBubble({ msg, char, chat, mine }) {
  useStore(db.lorebooks.store);
  const ref = msg.card || {};
  const name = ref.name || '卡片';
  const entry = htmlcard.resolve(ref, char);
  const persona = phone.accounts.get(chat?.personaId) || phone.accounts.current();
  const doc = useCardDoc(entry, ref.values || {}, char, persona);
  const [open, setOpen] = useState(false);
  const { w, h } = htmlcard.sizeOf(entry?.card);
  const full = entry?.card?.width === 'full';

  return html`
    <div class=${`hc-card ph-card${mine ? ' is-mine' : ''}${full ? ' is-full' : ''}`} style=${`--hc-w:${w}px`}>
      <div class="hc-bar">
        <${Icon} name="layers" size=${12}/>
        <span class="hc-bar-name">卡片 · ${name}</span>
        ${entry ? html`<button class="hc-bar-open press" onClick=${() => setOpen(true)}>展开</button>` : null}
      </div>
      ${entry ? html`<${CardFrame} doc=${doc} w=${w} h=${h} title=${name}/>`
        : html`<div class="hc-gone">模板已不存在，以下为原始内容</div><${Plain} values=${ref.values}/>`}
      <${FullSheet} open=${open} onClose=${() => setOpen(false)} title=${name}>
        <div class="hc-full"><${CardFrame} doc=${doc} w=${w} h=${h} fluid title=${name}/></div>
      <//>
    </div>`;
}

// ---- 用户自己发卡片（ARCHITECTURE 4.253）----
//
// 面板「卡片」里选一张（这个角色能用的：挂着的书、全局的书、内置卡片），逐个字段填，预览，发出去。
// 「帮我填」可选：写一句想发什么，点一下调一次接口把字段填好，发之前还能改。
// 发出去的是一条 kind: 'card' 的消息，正文是角色那种写法，角色读到的就是它。

// 表单里一个字段一段文字；列表一行一项、子字段用｜隔开。转成角色那种写法再交给 parseValues 读
const toBlock = (fields, form) => fields.map(f => {
  const v = String(form[f.name] || '').trim();
  if (!v) return '';
  return f.list ? v.split('\n').map(x => x.trim()).filter(Boolean).map(x => `${f.name}：${x}`).join('\n') : `${f.name}：${v}`;
}).filter(Boolean).join('\n');

const toForm = (fields, values) => Object.fromEntries(fields.map(f => {
  const v = values[f.name];
  if (v == null) return [f.name, ''];
  if (Array.isArray(v)) return [f.name, v.map(x => (x && typeof x === 'object' ? f.sub.map(s => x[s] ?? '').join('｜') : x)).join('\n')];
  return [f.name, String(v)];
}));

export function CardSendSheet({ open, onClose, char, chat }) {
  useStore(db.lorebooks.store);
  useStore(db.settings.store);
  const [pick, setPick] = useState(null);
  const [form, setForm] = useState({});
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const persona = phone.accounts.get(chat?.personaId) || phone.accounts.current();
  const cards = char ? htmlcard.cardsFor(char) : [];
  const entry = pick ? cards.find(e => e.id === pick) || null : null;
  const fields = entry ? htmlcard.fieldsOf(entry.card?.html, entry.card?.fields) : [];
  const values = entry ? htmlcard.parseValues(toBlock(fields, form), fields) : {};
  const doc = useCardDoc(entry, values, char, persona);
  const { w, h } = htmlcard.sizeOf(entry?.card);

  const close = () => { setPick(null); setForm({}); setIdea(''); onClose(); };
  const choose = e => { setPick(e.id); setForm({}); };

  const fill = async () => {
    if (!phone.ai.isConfigured()) { toast('尚未配置接口', 'error'); return; }
    setBusy(true);
    try {
      const recent = db.messagesOf(chat.id).slice(-12)
        .map(m => `${m.role === 'user' ? (persona?.name || 'user') : (char.name || 'char')}: ${String(m.content || '').slice(0, 200)}`).join('\n');
      const block = await phone.ai.tools.cardFill({
        card: htmlcard.promptList([entry]), name: entry.comment, idea,
        charName: char.name, userName: persona?.name, recent,
      });
      setForm(toForm(fields, htmlcard.parseValues(block, fields)));
    } catch (e) { toast(String(e.message || e), 'error'); }
    finally { setBusy(false); }
  };

  const send = () => {
    if (!Object.keys(values).length) { toast('请至少填写一个字段', 'error'); return; }
    db.messages.create({
      chatId: chat.id, role: 'user', authorId: 'me', kind: 'card', status: 'done',
      content: htmlcard.blockOf(entry.comment, values, fields),
      card: { name: entry.comment, bookId: entry.bookId || '', entryId: entry.id, values },
    });
    db.chats.update(chat.id, { lastMessageAt: Date.now() });
    close();
  };

  return html`
    <${FullSheet} open=${open} onClose=${entry ? () => setPick(null) : close} title=${entry ? entry.comment : '发送卡片'}>
      ${!entry ? html`
        ${cards.length ? html`
          <${List} title="这个角色可用的卡片">
            ${cards.map(e => html`
              <${ListItem} key=${`${e.bookId}-${e.id}`} title=${e.comment} arrow
                subtitle=${e.bookId === htmlcard.BUILTIN_BOOK_ID ? '内置卡片' : (db.lorebooks.get(e.bookId)?.name || '')}
                left=${html`<${Icon} name="layers" size=${18}/>`}
                onClick=${() => choose(e)}/>`)}
          <//>`
        : html`<${EmptyState} icon="layers" title="暂无可用的卡片"
            desc="卡片放在世界书里。在世界书中新建 HTML 卡片，或开启「内置卡片」，并在角色资料中关联后即可使用。"
            action=${html`<${Button} size="sm" onClick=${() => { close(); phone.intent.open('lorebook', { route: '/' }); }}>前往世界书<//>`}/>`}`
      : html`
        <div class="pad hc-preview">
          <div class="hc-card" style=${`--hc-w:${w}px`}>
            <div class="hc-bar"><span class="hc-bar-name">卡片 · ${entry.comment}</span></div>
            <${CardFrame} doc=${doc} w=${w} h=${h} title=${entry.comment}/>
          </div>
        </div>
        <div class="pad cg-sec">
          <${Field} label="帮我填" desc="写下想发什么，点「帮我填」由模型填写全部字段，发送前可以修改。点一次调用一次接口。">
            <${Input} value=${idea} placeholder="例如：分享一条关于流浪猫的微博" onInput=${setIdea}/>
          <//>
          <${Button} size="sm" variant="ghost" icon="sparkle" disabled=${busy} onClick=${fill}>${busy ? '正在填写' : '帮我填'}<//>
          ${fields.map(f => {
            const cfg = (entry.card?.fields || {})[f.name] || {};
            const label = f.list ? `${f.name}（一行一项${f.sub.length ? `，各部分用｜分隔：${f.sub.join('｜')}` : ''}）` : f.name;
            return html`
              <${Field} key=${f.name} label=${label} desc=${[cfg.max ? `上限 ${cfg.max} 字` : '', cfg.desc || ''].filter(Boolean).join(' · ')}>
                ${f.list || cfg.long
                  ? html`<${Textarea} rows=${f.list ? 3 : 4} value=${form[f.name] || ''} onInput=${v => setForm(x => ({ ...x, [f.name]: v }))}/>`
                  : html`<${Input} value=${form[f.name] || ''} onInput=${v => setForm(x => ({ ...x, [f.name]: v }))}/>`}
              <//>`;
          })}
        </div>
        <div class="pad">
          <${Button} full onClick=${send}>发送<//>
        </div>`}
    <//>`;
}
