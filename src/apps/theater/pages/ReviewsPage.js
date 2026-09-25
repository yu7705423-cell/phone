import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Icon, Button, Sheet, Spinner,
         EmptyState, toast, confirm } from '../../../ui/index.js';

const { db, nav, review, book, ai } = phone;

const when = ts => {
  const d = new Date(ts || 0);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};

// 一部片、一本书写过的所有评。**每写一篇留一篇**，不覆盖 ——
// 重看一遍本来就会有不一样的看法，把上一篇冲掉等于假装没看过。
export function ReviewsPage({ kind, subjectId }) {
  useStore(db.reviews.store);
  useStore(db.characters.store);
  useStore(db.videos.store);
  useStore(db.ebooks.store);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);

  const isBook = kind === review.BOOK;
  const row = isBook ? db.ebooks.get(subjectId) : db.videos.get(subjectId);
  const word = isBook ? '书评' : '影评';
  if (!row) {
    return html`<${Page} title=${word} onBack=${nav.pop}>
      <${EmptyState} title=${isBook ? '这本书已经不在了' : '这部片子已经不在了'}/><//>`;
  }
  const list = review.listFor(kind, subjectId);

  const make = async charId => {
    setPicking(false);
    setBusy(true);
    try {
      const at = isBook ? (row.at || 0) : 0;
      await review.write({ kind, subjectId, charId, at });
      toast('写好了', 'ok');
    } catch (err) { toast(String(err.message || err), 'error', 5000); }
    finally { setBusy(false); }
  };

  const drop = async r => {
    setOpen(null);
    if (!await confirm({ title: `删除这一篇${word}`, danger: true,
      message: '只删这一篇，同一部的其他几篇不受影响。' })) return;
    review.remove(r.id);
  };

  return html`
    <${Page} title=${`${row.title} · ${word}`} onBack=${nav.pop}
      right=${html`<button class="nav-text press"
        onClick=${() => !busy && setPicking(true)}>${busy ? '写着' : '写一篇'}</button>`}>
      ${busy ? html`
        <${List}><${ListItem} title="正在写" multiline
          subtitle=${`${isBook ? '按你读到的位置' : '按看过的那一段'}写，稍等`}
          left=${html`<${Spinner} size=${16}/>`}/><//>` : null}

      ${list.length ? html`
        <${List} title=${`共 ${list.length} 篇`}>
          ${list.map(r => {
            const c = db.characters.get(r.charId);
            const first = String(r.text || '').split('\n').find(l => l.trim()) || '';
            return html`
              <${ListItem} key=${r.id} multiline arrow
                title=${c?.name || '某个角色'}
                subtitle=${`${when(r.createdAt)} · ${first.slice(0, 40)}${first.length > 40 ? '…' : ''}`}
                left=${html`<${Icon} name=${isBook ? 'book' : 'film'} size=${18}/>`}
                onClick=${() => setOpen(r)}/>`;
          })}
        <//>`
      : html`
        <${EmptyState} icon="notes" title=${`还没有${word}`}
          desc=${`让一个角色按${isBook ? '读到' : '看到'}的内容写一篇。每写一篇都留着，`
            + '以后重看再写不会把旧的冲掉。'}
          action=${html`<${Button} size="sm" icon="edit"
            onClick=${() => setPicking(true)}>写一篇<//>`}/>`}

      <div class="settings-foot">
        写一篇调用一次模型接口。在「一起看与一起读」的设置中可以开启收场时自动写，
        默认关闭。
      </div>

      <${Sheet} open=${picking} onClose=${() => setPicking(false)} title="谁来写" height="70%">
        <${List} inset=${false}>
          ${db.characters.all().filter(c => !c.parentId).map(c => html`
            <${ListItem} key=${c.id} title=${phone.remark.nameOf(c)} arrow
              subtitle=${c.signature || ''} onClick=${() => make(c.id)}/>`)}
          ${db.characters.count() ? null : html`
            <${ListItem} title="还没有角色" multiline subtitle="先在「联系」里建一个"/>`}
        <//>
      <//>

      <${Sheet} open=${!!open} onClose=${() => setOpen(null)}
        title=${open ? (db.characters.get(open.charId)?.name || '某个角色') : ''} height="82%">
        ${open ? html`
          <div class="pad-x">
            <div class="rv-when">${when(open.createdAt)}${isBook && open.at
              ? ` · 读到 ${book.percentOf({ ...row, at: open.at })}%` : ''}</div>
            ${String(open.text).split('\n').filter(l => l.trim()).map((p, i) => html`
              <p key=${i} class="rv-p">${p}</p>`)}
          </div>
          <div class="pad">
            <${Button} full variant="danger" onClick=${() => drop(open)}>删除这一篇<//>
          </div>` : null}
      <//>
    <//>`;
}
