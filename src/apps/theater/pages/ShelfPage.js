import { html, useState } from '../../../lib.js';
import { phone, useStore, useThumb } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Button, Icon, Sheet, Spinner,
         EmptyState, toast, confirm } from '../../../ui/index.js';

const { db, nav, shelf, booksearch } = phone;

// 书架上那一格。接上了真书就能点开去读，没接上就只是个封面。
function Shelf({ item, onTap }) {
  const local = useThumb(item.cover);
  const src = local || item.coverUrl || '';
  return html`
    <button class=${`shelf-item press${item.real ? '' : ' is-ghost'}`} onClick=${() => onTap(item)}>
      <div class=${`shelf-cover${src ? ' has-image' : ''}`}
        style=${src ? `background-image:url(${src})` : ''}>
        ${src ? null : html`<${Icon} name="book" size=${20}/>`}
      </div>
      <div class="shelf-name ellipsis">${item.title}</div>
      <div class="shelf-sub ellipsis">
        ${item.real ? `已导入 · ${item.percent}%` : (item.author || '未导入')}
      </div>
    </button>`;
}

// 查一本书，把书名作者封面填好。查不到也能手填。
function AddSheet({ open, charId, onClose }) {
  const [q, setQ] = useState('');
  const [author, setAuthor] = useState('');
  const [cover, setCover] = useState('');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);

  const min = booksearch.providerOf().minQ || 1;
  const tooShort = q.trim().length > 0 && q.trim().length < min;

  const go = async () => {
    if (!q.trim() || tooShort) return;
    setBusy(true); setRows(null);
    try { setRows(await booksearch.search(q)); }
    catch (err) { toast(String(err.message || err), 'error', 5000); setRows([]); }
    finally { setBusy(false); }
  };

  const take = it => {
    try {
      shelf.add(charId, { title: it.title, author: it.author, coverUrl: it.coverUrl });
      toast(`已放上《${it.title}》`, 'ok');
      setQ(''); setAuthor(''); setCover(''); setRows(null); onClose();
    } catch (err) { toast(String(err.message || err), 'error'); }
  };

  if (!open) return null;
  return html`
    <${Sheet} open=${true} onClose=${() => { setRows(null); onClose(); }}
      title="往书架上放一本" height="86%">
      <div class="pad-x">
        <${Field} label="书名"
          desc=${!booksearch.ready()
            ? '尚未选择书目接口。自己填也一样，下面两栏都可以留空。'
            : tooShort
              ? `${booksearch.providerOf().name} 不接受短于 ${min} 个字符的查询，`
                + '书名很短时请直接自己填，下面两栏都可以留空。'
              : '查到之后连封面一起放上。查不到也可以自己填，下面两栏都可以留空。'}>
          <${Input} value=${q} placeholder="输入书名" onInput=${v => setQ(v)}/>
        <//>
        ${booksearch.ready() ? html`
          <div class="batch-acts">
            <${Button} disabled=${busy || !q.trim() || tooShort} onClick=${go}>
              ${busy ? html`<${Spinner} size=${15}/> 正在查`
                : tooShort ? `至少 ${min} 个字` : '查一下'}<//>
          </div>` : null}
        <${Field} label="作者"><${Input} value=${author} placeholder="可留空"
          onInput=${v => setAuthor(v)}/><//>
        <${Field} label="封面地址"
          desc="任意一张图片的网址。书目接口查不到、或者不使用接口时，粘一个进来也一样有封面。">
          <${Input} value=${cover} placeholder="https://… 可留空"
            onInput=${v => setCover(v.trim())}/>
        <//>
        <div class="pad-b">
          <${Button} full variant="ghost" disabled=${!q.trim()}
            onClick=${() => take({ title: q.trim(), author, coverUrl: cover })}>放上书架<//>
        </div>
      </div>

      ${rows ? (rows.length ? html`
        <${List} title=${`查到 ${rows.length} 本`}>
          ${rows.map((b, i) => html`
            <${ListItem} key=${i} title=${b.title} arrow multiline
              subtitle=${[b.author, b.year].filter(Boolean).join(' · ') || '没有作者信息'}
              left=${b.coverUrl
                ? html`<div class="shelf-cover mini has-image"
                    style=${`background-image:url(${b.coverUrl})`}></div>`
                : html`<div class="shelf-cover mini"><${Icon} name="book" size=${14}/></div>`}
              onClick=${() => take(b)}/>`)}
        <//>`
      : html`<div class="settings-foot">没有查到。可以直接添加，那一格就只有书名。</div>`) : null}
    <//>`;
}

export function ShelfPage({ charId }) {
  useStore(db.characters.store);
  useStore(db.ebooks.store);
  const char = db.characters.get(charId);
  const [adding, setAdding] = useState(false);
  const [held, setHeld] = useState(null);
  const [linking, setLinking] = useState(false);

  if (!char) {
    return html`<${Page} title="书架" onBack=${nav.pop}>
      <${EmptyState} title="这个角色已经不在了"/><//>`;
  }
  const items = shelf.listOf(charId);

  const drop = async it => {
    setHeld(null);
    if (!await confirm({ title: `从书架上拿掉《${it.title}》`, danger: true,
      message: it.real ? '书库里那一本不受影响，只是不再摆在这个书架上。' : '这一格只是个占位。' })) return;
    shelf.remove(charId, it.id);
  };

  return html`
    <${Page} title=${`${char.name} 的书架`} onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${() => setAdding(true)}>添加</button>`}>
      ${items.length ? html`
        <div class="shelf-grid">
          ${items.map(it => html`<${Shelf} key=${it.id} item=${it} onTap=${setHeld}/>`)}
        </div>`
      : html`
        <${EmptyState} icon="book" title="书架是空的"
          desc="放上几本这个角色读过的书。书架上的书默认只是封面，你导入同名的书之后才能读。"
          action=${html`<${Button} size="sm" icon="plus"
            onClick=${() => setAdding(true)}>添加书籍<//>`}/>`}

      ${items.length ? html`
        <div class="settings-foot">
          浅色的那几本还没有导入，点开只会看到简介。在书库中导入同名的书之后，
          它们会自动接上，可以阅读，也可以与该角色一起读。
        </div>` : null}

      <${AddSheet} open=${adding} charId=${charId} onClose=${() => setAdding(false)}/>

      <${Sheet} open=${!!held} onClose=${() => setHeld(null)} title=${held?.title || ''}>
        ${held ? html`
          <${List} inset=${false}>
            ${held.author ? html`<${ListItem} title="作者" subtitle=${held.author} multiline/>` : null}
            ${held.real ? html`
              <${ListItem} title="阅读" arrow
                left=${html`<${Icon} name="book" size=${18}/>`}
                onClick=${() => { const b = held.bookId; setHeld(null); nav.push(`/book/${b}`); }}/>`
            : html`
              <${ListItem} title="尚未导入" multiline
                subtitle="这一格只有书名与封面。在书库中导入同名的书之后即可阅读"
                left=${html`<${Icon} name="book" size=${18}/>`}/>
              <${ListItem} title="接上书库里的一本" arrow multiline
                subtitle="书名不同也可以手动接上"
                left=${html`<${Icon} name="layers" size=${18}/>`}
                onClick=${() => setLinking(true)}/>`}
            <${ListItem} title="从书架上拿掉" danger arrow
              left=${html`<${Icon} name="trash" size=${18}/>`}
              onClick=${() => drop(held)}/>
          <//>` : null}
      <//>

      <${Sheet} open=${linking} onClose=${() => setLinking(false)} title="接上哪一本" height="70%">
        <${List} inset=${false}>
          ${db.ebooks.all().map(b => html`
            <${ListItem} key=${b.id} title=${b.title} arrow
              subtitle=${b.author || `${(b.chars || 0).toLocaleString()} 字`}
              onClick=${() => {
                shelf.link(charId, held.id, b.id);
                setLinking(false); setHeld(null);
                toast('已接上', 'ok');
              }}/>`)}
          ${db.ebooks.count() ? null : html`<${ListItem} title="书库是空的" multiline
            subtitle="先在书库里导入一本，再回来接上"/>`}
        <//>
      <//>
    <//>`;
}
