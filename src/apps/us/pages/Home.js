import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, EmptyState, Button, IconButton,
         FullSheet, toast } from '../../../ui/index.js';
import { WorkFields, WorkSwitches, ChatPick, KindPick, dateOf } from './Bits.js';

const { db, nav, work } = phone;

const blank = () => ({
  chatId: '', kind: work.EXTRA, title: '', premise: '',
  charName: '', charPersona: '', meName: '', mePersona: '',
  carry: false, solo: false, opening: 'char',
});

function Row({ w }) {
  const names = work.castOf(w).map(c => c.name).join('、');
  const st = work.statsOf(w.id);
  const meta = [names, st.chapters
    ? `${st.chapters} ${w.kind === work.SAGA ? '章' : '则'} · ${st.chars} 字`
    : '还没有正文', dateOf(w.updatedAt || w.createdAt)].filter(Boolean).join(' · ');
  return html`
    <${ListItem} title=${w.title || '未命名'} subtitle=${meta} arrow multiline
      onClick=${() => nav.push(`/work/${w.id}`)}/>`;
}

export function Home() {
  useStore(db.works.store);
  useStore(db.chapters.store);
  useStore(db.beats.store);
  useStore(db.chats.store);
  useStore(db.characters.store);
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(blank());
  const set = patch => setV(x => ({ ...x, ...patch }));

  const sagas = work.ofKind(work.SAGA);
  const extras = work.ofKind(work.EXTRA);

  const start = () => {
    if (!v.chatId) { toast('请先选择和谁'); return; }
    const row = work.create({
      chatId: v.chatId, kind: v.kind, title: v.title, premise: v.premise,
      charAs: { name: v.charName, persona: v.charPersona },
      meAs: { name: v.meName, persona: v.mePersona },
      carry: v.carry, solo: v.solo, opening: v.opening,
      tone: db.settings.get().workToneLast || '',
    });
    // 番外只有一则，建完直接开写；长篇先进目录，第一章由用户自己起
    const first = v.kind === work.EXTRA ? work.addChapter(row.id) : null;
    setOpen(false);
    setV(blank());
    nav.push(first ? `/read/${first.id}` : `/work/${row.id}`);
  };

  const empty = !sagas.length && !extras.length;

  return html`
    <${Page} title="我们"
      right=${html`<${IconButton} name="plus" onClick=${() => setOpen(true)} label="新建"/>`}>

      ${empty ? html`
        <${EmptyState} icon="book" title="还没有作品"
          desc="长篇有一条主线，一章一章往下写，可以换一套身份重新开始。
            番外是一则小剧场，沿用现在的身份与记忆。两种都以成段的文字推进。"
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
          <${WorkFields} v=${v} set=${set} kind=${v.kind}/>
        </div>
        <${ChatPick} value=${v.chatId} onChange=${x => set({ chatId: x })}/>
        <${WorkSwitches} v=${v} set=${set} kind=${v.kind}/>
      <//>` : null}`;
}
