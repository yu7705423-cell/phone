import { html, useState, useRef } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, NumberInput, Segmented, Button, Icon,
         Sheet, Spinner, EmptyState, toast, confirm, prompt } from '../../../ui/index.js';
import { BookCover } from './Cover.js';

const { db, nav, shelf, booksearch, review, ai } = phone;
const gen = ai.shelfBatch;
const impression = ai.impression;

// 书架上那一格。接上了真书就能点开去读，没接上就只是个封面。
function Shelf({ item, onTap }) {
  return html`
    <button class=${`shelf-item press${item.real ? '' : ' is-ghost'}`} onClick=${() => onTap(item)}>
      <${BookCover} title=${item.title} author=${item.author}
        cover=${item.cover} coverUrl=${item.coverUrl} bookCover=${item.book?.cover}/>
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
              left=${html`<${BookCover} mini title=${b.title} coverUrl=${b.coverUrl}/>`}
              onClick=${() => take(b)}/>`)}
        <//>`
      : html`<div class="settings-foot">没有查到。可以直接添加，那一格就只有书名。</div>`) : null}
    <//>`;
}

// 按角色设定生成一批书目。一次调用一批，和聊天无关。
function GenSheet({ open, char, onClose, onDone }) {
  const [count, setCount] = useState(8);
  const [kind, setKind] = useState(gen.REAL);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!ai.isConfigured()) { toast('尚未配置聊天接口', 'error', 4000); return; }
    setBusy(true);
    try {
      const rows = await gen.generate(char.id, { count, kind });
      if (!rows.length) { toast('模型给出的书目与书架上已有的重复，已全部排除', 'plain', 4000); return; }
      onDone(rows);
    } catch (err) { toast(String(err.message || err), 'error', 6000); }
    finally { setBusy(false); }
  };

  if (!open) return null;
  return html`
    <${Sheet} open=${true} onClose=${onClose} title="按角色设定生成">
      <div class="pad-x">
        <div class="hint-box">
          读取该角色的人设，列出这个角色读过的书。生成的是书名、作者与一句备注，
          放上书架后仍是占位，导入同名的书之后才能阅读。
          每次生成调用一次接口，与聊天互不相干。
        </div>
        <${Field} label="这一批生成几本"
          desc="不设上限。填得越多，这一次调用消耗越多。与书架上已有的重复的会自动排除。">
          <${NumberInput} value=${count} placeholder="8" onChange=${v => setCount(v)}/>
        <//>
        <${Field} label="书目范围"
          desc=${kind === gen.REAL
            ? '只列现实中存在的书。'
            : '现实中存在的书与该角色所在世界里才有的书都可以列出，由角色设定决定。'}>
          <${Segmented} value=${kind} onChange=${setKind}
            items=${gen.KINDS.map(k => ({ value: k.id, label: k.label }))}/>
        <//>
        <div class="pad-b">
          <${Button} full disabled=${busy || !count} onClick=${run}>
            ${busy ? html`<${Spinner} size=${15}/> 正在生成` : `生成 ${count || 0} 本`}<//>
        </div>
      </div>
    <//>`;
}

// 书架上某一本的读后感。角色在遇到你之前就读过它，这是它留下的印象。
// 和一起读完写的书评不是一回事：那本书多半只是个占位，模型手里没有正文。
function ImpressionSheet({ open, charId, item, charName, onClose }) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);

  const run = async () => {
    if (!ai.isConfigured()) { toast('尚未配置聊天接口', 'error', 4000); return; }
    setBusy(true);
    try { setDraft(await impression.generate(charId, item.id)); }
    catch (err) { toast(String(err.message || err), 'error', 6000); }
    finally { setBusy(false); }
  };

  const keep = () => {
    impression.save(charId, item.id, draft);
    setDraft(null); toast('已记下', 'ok'); onClose();
  };

  const drop = async () => {
    if (!await confirm({ title: '删除这一篇读后感', danger: true })) return;
    impression.clear(charId, item.id);
    onClose();
  };

  if (!open || !item) return null;
  const saved = item.impression || '';

  return html`
    <${Sheet} open=${true} onClose=${() => { setDraft(null); onClose(); }}
      title=${`《${item.title}》的读后感`} height="78%">
      <div class="pad-x">
        ${draft ? html`
          <div class="hint-box">这是刚生成的一篇。保存之后会覆盖原有的那一篇。</div>
          ${draft.split('\n').filter(l => l.trim()).map((l, i) => html`
            <p key=${i} class="rv-p">${l}</p>`)}
          <div class="batch-acts pad-b">
            <${Button} onClick=${keep}>保存<//>
            <${Button} variant="ghost" disabled=${busy} onClick=${run}>再写一篇<//>
            <${Button} variant="ghost" onClick=${() => setDraft(null)}>不要<//>
          </div>`
        : saved ? html`
          ${saved.split('\n').filter(l => l.trim()).map((l, i) => html`
            <p key=${i} class="rv-p">${l}</p>`)}
          <div class="batch-acts pad-b">
            <${Button} variant="ghost" disabled=${busy} onClick=${run}>
              ${busy ? html`<${Spinner} size=${15}/> 正在写` : '重新生成'}<//>
            <${Button} variant="ghost" danger onClick=${drop}>删除<//>
          </div>`
        : html`
          <div class="hint-box">
            读取${charName}的人设，写下这本书留给它的印象。
            书架上的书多半只是占位，模型手里没有正文，所以只写印象，不复述内容。
            生成一次调用一次接口。
          </div>
          <div class="pad-b">
            <${Button} full disabled=${busy} onClick=${run}>
              ${busy ? html`<${Spinner} size=${15}/> 正在写` : '生成读后感'}<//>
          </div>`}
      </div>
    <//>`;
}

export function ShelfPage({ charId }) {
  useStore(db.characters.store);
  useStore(db.ebooks.store);
  useStore(db.reviews.store);
  const char = db.characters.get(charId);
  const [adding, setAdding] = useState(false);
  const [held, setHeld] = useState(null);
  const [linking, setLinking] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [impressing, setImpressing] = useState(null);
  const [rows, setRows] = useState(null);
  const [off, setOff] = useState(new Set());
  const coverRef = useRef(null);

  if (!char) {
    return html`<${Page} title="书架" onBack=${nav.pop}>
      <${EmptyState} title="这个角色已经不在了"/><//>`;
  }
  const items = shelf.listOf(charId);
  const wrote = review.listByChar(charId);

  const save = () => {
    const keep = rows.filter((_, i) => !off.has(i));
    if (!keep.length) { toast('尚未勾选任何书目'); return; }
    const made = gen.keep(charId, keep);
    toast(`已放上 ${made.length} 本`, 'ok');
    setRows(null); setOff(new Set());
  };

  if (rows) {
    const kept = rows.length - off.size;
    return html`
      <${Page} title="确认放上书架" onBack=${() => { setRows(null); setOff(new Set()); }}
        right=${html`<button class="nav-text press" onClick=${save}>保存 ${kept}</button>`}>
        <div class="pad-x pad-t">
          <div class="hint-box">
            已排除与书架上重复的书目。取消勾选的不会放上书架。
            放上之后仍然是占位，导入同名的书之后才能阅读。
          </div>
        </div>
        <${List}>
          ${rows.map((b, i) => html`
            <${ListItem} key=${i} title=${b.title} multiline
              subtitle=${[b.author, b.note].filter(Boolean).join(' · ') || '没有作者信息'}
              left=${html`
                <span class=${`pick-dot${off.has(i) ? '' : ' is-on'}`}>
                  ${off.has(i) ? null : html`<${Icon} name="check" size=${11}/>`}
                </span>`}
              onClick=${() => setOff(prev => {
                const next = new Set(prev);
                if (next.has(i)) next.delete(i); else next.add(i);
                return next;
              })}/>`)}
        <//>
        <div class="pad">
          <${Button} full onClick=${save}>放上勾选的 ${kept} 本<//>
        </div>
      <//>`;
  }

  const pickCover = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !held) return;
    try {
      const id = await db.images.put(file, 512);
      if (held.cover) db.images.remove(held.cover);
      shelf.setEntry(charId, held.id, { cover: id, coverUrl: '' });
      setHeld(null);
      toast('已更换封面', 'ok');
    } catch (err) { toast('图片处理失败：' + (err.message || err), 'error', 4000); }
  };

  const pasteCover = async () => {
    const url = await prompt({ title: '封面地址', placeholder: 'https://…' });
    if (!url) return;
    if (held.cover) db.images.remove(held.cover);
    shelf.setEntry(charId, held.id, { coverUrl: String(url).trim(), cover: null });
    setHeld(null);
  };

  const clearCover = () => {
    if (held.cover) db.images.remove(held.cover);
    shelf.setEntry(charId, held.id, { cover: null, coverUrl: '' });
    setHeld(null);
  };

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

      <${List} title="补充书架">
        <${ListItem} title="按角色设定生成" arrow multiline
          subtitle="读取该角色的人设，列出这个角色读过的书。生成一次调用一次接口，结果确认后才放上书架"
          left=${html`<${Icon} name="sparkle" size=${18}/>`}
          onClick=${() => setGenerating(true)}/>
      <//>

      ${wrote.length ? html`
        <${List} title=${`${char.name} 写过的 · ${wrote.length} 篇`}>
          ${wrote.slice(0, 6).map(r => html`
            <${ListItem} key=${r.id} title=${r.title} arrow multiline
              subtitle=${String(r.text || '').split('\n').find(l => l.trim())?.slice(0, 40) || ''}
              left=${html`<${Icon} name=${r.kind === review.BOOK ? 'book' : 'film'} size=${18}/>`}
              onClick=${() => nav.push(`/reviews/${r.kind}/${r.subjectId}`)}/>`)}
        <//>` : null}

      ${items.length ? html`
        <div class="settings-foot">
          浅色的那几本还没有导入，点开只会看到简介。在书库中导入同名的书之后，
          它们会自动接上，可以阅读，也可以与该角色一起读。<br/>
          封面按这个顺序取：自己选的图片，填写的图片地址，
          已接上那本书自带的封面，以上都没有时按书名生成一张。
        </div>` : null}

      <${AddSheet} open=${adding} charId=${charId} onClose=${() => setAdding(false)}/>
      <${ImpressionSheet} open=${!!impressing} charId=${charId} item=${impressing}
        charName=${char.name} onClose=${() => setImpressing(null)}/>
      <${GenSheet} open=${generating} char=${char}
        onClose=${() => setGenerating(false)}
        onDone=${r => { setGenerating(false); setOff(new Set()); setRows(r); }}/>
      <input type="file" accept="image/*" ref=${coverRef} onChange=${pickCover} style="display:none"/>

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
            <${ListItem} title="读后感" arrow multiline
              subtitle=${held.impression
                ? held.impression.split('\n').find(l => l.trim())?.slice(0, 30) + '…'
                : '让角色写下这本书留给它的印象。生成一次调用一次接口'}
              left=${html`<${Icon} name="notes" size=${18}/>`}
              onClick=${() => { const it = held; setHeld(null); setImpressing(it); }}/>
            <${ListItem} title="换封面" arrow multiline
              subtitle="从相册选一张。不换也有封面，按书名生成"
              left=${html`<${Icon} name="image" size=${18}/>`}
              onClick=${() => coverRef.current?.click()}/>
            <${ListItem} title="粘一个封面地址" arrow multiline
              subtitle=${held.coverUrl || '任意图片的网址'}
              left=${html`<${Icon} name="layers" size=${18}/>`}
              onClick=${pasteCover}/>
            ${held.cover || held.coverUrl ? html`
              <${ListItem} title="去掉封面" arrow multiline
                subtitle="改回按书名生成的那一张"
                left=${html`<${Icon} name="close" size=${18}/>`}
                onClick=${clearCover}/>` : null}
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
