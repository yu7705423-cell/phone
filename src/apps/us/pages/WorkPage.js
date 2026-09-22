import { html } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, EmptyState, Button, IconButton, Icon,
         toast, confirm } from '../../../ui/index.js';
import { Hero, chapterTitle, dateOf } from './Bits.js';

const { db, nav, work, scene } = phone;

// 一部作品的目录。番外只有一则，进来就直接看正文，所以这一页只有长篇会走到
// —— 除非番外想再加一则。
export function WorkPage({ workId }) {
  useStore(db.works.store);
  useStore(db.chapters.store);
  useStore(db.beats.store);
  useStore(db.characters.store);

  const w = work.get(workId);
  if (!w) {
    return html`<${Page} title="我们" onBack=${nav.pop}>
      <${EmptyState} title="这一部已经不在了"/><//>`;
  }

  const list = work.chaptersOf(workId);
  const saga = w.kind === work.SAGA;
  const unit = saga ? '章' : '则';

  const add = () => {
    const row = work.addChapter(workId);
    if (row) nav.push(`/read/${row.id}`);
  };

  const removeOne = async row => {
    const ok = await confirm({
      title: `删除${chapterTitle(w, row)}`,
      message: '这一篇的全部正文将一并删除，无法恢复。',
      okText: '删除', danger: true,
    });
    if (ok) { work.removeChapter(row.id); toast('已删除', 'ok'); }
  };

  const removeWork = async () => {
    const st = work.statsOf(workId);
    const ok = await confirm({
      title: `删除「${w.title || '未命名'}」`,
      message: `将删除这一部与它的 ${st.chapters} ${unit}、共 ${st.chars} 字正文。此操作无法撤销。`,
      okText: '删除', danger: true,
    });
    if (!ok) return;
    work.remove(workId);
    nav.pop();
  };

  return html`
    <${Page} title=${w.title || '未命名'} onBack=${nav.pop}
      right=${html`<${IconButton} name="plus" onClick=${add} label=${`新的一${unit}`}/>`}>

      <${Hero} w=${w}/>


      ${w.premise ? html`
        <${List} title=${saga ? '主线' : '设定'}>
          <${ListItem} title=${w.premise} multiline/>
        <//>` : null}

      ${list.length ? html`
        <${List} title=${`目录 · ${list.length} ${unit}`}>
          ${list.map((row, i) => {
    const n = db.beats.byIndex(row.id).filter(b => b.role !== 'director').length;
    const chars = scene.beatsOf(row.id)
      .reduce((x, b) => x + (b.role === 'director' ? 0 : String(b.text || '').length), 0);
    const meta = [row.place, n ? `${n} 段 · ${chars} 字` : '还没有正文',
      row.summary ? '已收篇' : '', dateOf(row.updatedAt || row.createdAt)]
      .filter(Boolean).join(' · ');
    return html`
              <${ListItem} key=${row.id} title=${chapterTitle(w, row)} subtitle=${meta}
                arrow multiline onClick=${() => nav.push(`/read/${row.id}`)}
                right=${html`
                  <span class="wk-ops">
                    ${saga && i > 0 ? html`<button class="wk-op press" aria-label="上移"
                      onClick=${e => { e.stopPropagation(); work.moveChapter(row.id, -1); }}>
                      <${Icon} name="chevronUp" size=${15}/></button>` : null}
                    ${saga && i < list.length - 1 ? html`<button class="wk-op press" aria-label="下移"
                      onClick=${e => { e.stopPropagation(); work.moveChapter(row.id, 1); }}>
                      <${Icon} name="chevronDown" size=${15}/></button>` : null}
                    <button class="wk-op press" aria-label="删除"
                      onClick=${e => { e.stopPropagation(); removeOne(row); }}>
                      <${Icon} name="trash" size=${15}/></button>
                  </span>`}/>`;
  })}
        <//>`
    : html`<${EmptyState} icon="book" title=${`还没有第一${unit}`}
        desc="新的一篇建立之后即可开始写。"
        action=${html`<${Button} onClick=${add}>新的一${unit}<//>`}/>`}

      <${List}>
        <${ListItem} title="这一部的设定" arrow multiline
          subtitle=${['标题、封面、主线、身份、文风',
    w.carry ? '' : '当前不带原来的记忆',
    w.solo ? '当前整篇由它写' : ''].filter(Boolean).join('。')}
          onClick=${() => nav.push(`/work/${workId}/edit`)}/>
        <${ListItem} title="删除这一部" danger
          subtitle=${`连同它的 ${list.length} ${unit}正文一并删除`} multiline
          onClick=${removeWork}/>
      <//>
    <//>`;
}
