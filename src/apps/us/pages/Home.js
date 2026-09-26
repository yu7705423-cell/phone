import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, EmptyState, Button, IconButton,
         FullSheet, toast } from '../../../ui/index.js';
import { WorkFields, WorkSwitches, ChatPick, CastPick, KindPick, dateOf } from './Bits.js';
import { Segmented, Field } from '../../../ui/index.js';

const { db, nav, work, tone } = phone;

const blank = () => ({
  chatId: '', from: 'chat', castIds: [], kind: work.EXTRA, title: '', premise: '',
  charName: '', charPersona: '', meName: '', mePersona: '',
  carry: false, solo: false, opening: 'char',
});

function Row({ w }) {
  const names = work.castOf(w).map(c => phone.remark.nameOf(c)).join('、');
  const st = work.statsOf(w.id);
  const meta = [names, st.chapters
    ? `${st.chapters} ${w.kind === work.SAGA ? '章' : '则'} · ${st.chars} 字`
    : '还没有正文', dateOf(w.updatedAt || w.createdAt)].filter(Boolean).join(' · ');
  return html`
    <${ListItem} title=${w.title || '未命名'} subtitle=${meta} arrow multiline
      onClick=${() => nav.push(`/work/${w.id}`)}/>`;
}

/**
 * 首页。`chatId` 有值时只看这一段关系下的作品 —— 从会话菜单进来的那条路。
 * 那时它是栈上的第二层，所以要给一个返回。
 */
export function Home({ chatId = '' }) {
  useStore(db.works.store);
  useStore(db.chapters.store);
  useStore(db.beats.store);
  useStore(db.chats.store);
  useStore(db.characters.store);
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ ...blank(), chatId });
  const set = patch => setV(x => ({ ...x, ...patch }));

  const scope = chatId ? work.ofChat(chatId) : work.all();
  const sagas = scope.filter(w => w.kind === work.SAGA);
  const extras = scope.filter(w => w.kind === work.EXTRA);
  const who = chatId
    ? (db.chats.get(chatId)?.characterIds || []).map(id => db.characters.get(id)?.name)
      .filter(Boolean).join('、')
    : '';

  const start = () => {
    // 长篇可以不挂会话，直接选人物（4.262）；番外一定挂在会话上
    const alone = v.kind === work.SAGA && !chatId && v.from === 'cast';
    if (alone ? !v.castIds.length : !v.chatId) { toast(alone ? '请先选择人物' : '请先选择和谁'); return; }
    let row;
    try {
      row = work.create({
      chatId: alone ? '' : v.chatId, castIds: alone ? v.castIds : [], kind: v.kind, title: v.title, premise: v.premise,
      charAs: { name: v.charName, persona: v.charPersona },
      meAs: { name: v.meName, persona: v.mePersona },
      carry: alone ? false : v.carry, solo: v.solo, opening: v.opening,
      tones: tone.asTones(db.settings.get().workToneLast),
      });
    } catch (e) { toast(String(e.message || e), 'error'); return; }
    // 番外只有一则，建完直接开写；长篇先进目录，第一章由用户自己起
    const first = v.kind === work.EXTRA ? work.addChapter(row.id) : null;
    setOpen(false);
    setV({ ...blank(), chatId });
    nav.push(first ? `/read/${first.id}` : `/work/${row.id}`);
  };

  const empty = !sagas.length && !extras.length;

  return html`
    <${Page} title=${chatId ? (who || '我们') : '我们'}
      onBack=${chatId ? nav.pop : null}
      right=${html`<${IconButton} name="plus" onClick=${() => setOpen(true)} label="新建"/>`}>

      ${empty ? html`
        <${EmptyState} icon="book" title="还没有作品"
          desc=${chatId
    ? '这段关系下还没有作品。长篇有一条主线，一章一章往下写；番外是一则小剧场。'
    : '长篇有一条主线，一章一章往下写，可以换一套身份重新开始。'
      + '番外是一则小剧场，沿用现在的身份与记忆。两种都以成段的文字推进。'}
          action=${html`<${Button} onClick=${() => setOpen(true)}>新建一部<//>`}/>` : null}

      ${sagas.length ? html`
        <${List} title=${`长篇 · ${sagas.length}`}>
          ${sagas.map(w => html`<${Row} key=${w.id} w=${w}/>`)}
        <//>` : null}

      ${extras.length ? html`
        <${List} title=${`番外 · ${extras.length}`}>
          ${extras.map(w => html`<${Row} key=${w.id} w=${w}/>`)}
        <//>` : null}
    <//>

    ${open ? html`
      <${FullSheet} open=${open} onClose=${() => setOpen(false)} title="新建"
        right=${html`<${Button} size="sm" onClick=${start}>建立<//>`}>
        <div class="pad">
          <${KindPick} value=${v.kind} onChange=${x => set({ kind: x })}/>
          ${v.kind === work.SAGA ? html`
            <${Button} full variant="ghost" onClick=${() => { setOpen(false); nav.push(chatId ? `/new/${chatId}` : '/new'); }}>使用长篇向导<//>
            <div class="field-desc pad-t pad-b">向导里可以选体裁标签与篇幅、挂世界观、生成简介与分层大纲。下面是快速新建。</div>` : null}
          <${WorkFields} v=${v} set=${set} kind=${v.kind}/>
        </div>
        ${chatId ? null : html`
          ${v.kind === work.SAGA ? html`
            <div class="pad-x">
              <${Field} label="人物来源"
                desc=${v.from === 'cast' ? '直接从联系里选人物，不挂在任何会话上，因此没有「带上原来的记忆」。' : '挂在一段会话上，可以带上那段关系的记忆。'}>
                <${Segmented} value=${v.from} onChange=${x => set({ from: x })}
                  items=${[{ value: 'chat', label: '一段会话' }, { value: 'cast', label: '直接选人物' }]}/>
              <//>
            </div>` : null}
          ${v.kind === work.SAGA && v.from === 'cast'
            ? html`<${CastPick} value=${v.castIds} onChange=${x => set({ castIds: x })}/>`
            : html`<${ChatPick} value=${v.chatId} onChange=${x => set({ chatId: x })}/>`}`}
        <${WorkSwitches} v=${v} set=${set} kind=${v.kind} alone=${v.kind === work.SAGA && !chatId && v.from === 'cast'}/>
      <//>` : null}`;
}
