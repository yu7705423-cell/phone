import { html, useState, useRef } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Button, Icon, Sheet,
         EmptyState, Spinner, toast, confirm, prompt } from '../../../ui/index.js';
import { StickerImg } from './StickerBits.js';

const { db, nav, stickers: api } = phone;

function Review({ rows, blobs, onDone, onCancel }) {
  const [group, setGroup] = useState(api.DEFAULT_GROUP);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const total = rows.length + blobs.length;

  const save = async () => {
    setBusy(true);
    let n = 0;
    for (const r of rows) { api.addFromUrl({ ...r, group }); setDone(++n); }
    for (const b of blobs) { await api.addFromBlob({ ...b, group }); setDone(++n); }
    setBusy(false);
    onDone(total);
  };

  return html`
    <${Sheet} open=${true} onClose=${busy ? () => {} : onCancel} title="确认导入" height="82%">
      <div class="hint-box">
        解析出 ${rows.length} 条带链接的，${blobs.length} 张内嵌图片。
        链接类的先按原样存，之后可以一键缓存到本地。
      </div>

      <${Field} label="放进哪个分组">
        <${Input} value=${group} onInput=${setGroup} placeholder="分组名"/>
        <div class="chip-row">
          ${api.groups().map(g => html`
            <button key=${g} class=${`chip${g === group ? ' is-active' : ''}`}
              onClick=${() => setGroup(g)}>${g}</button>`)}
        </div>
      <//>

      <div class="stk-preview">
        ${rows.slice(0, 24).map((r, i) => html`
          <div key=${i} class="stk-prev-item">
            <img class="stk-img" src=${r.url} alt="" loading="lazy"/>
            <span class="ellipsis">${r.name}</span>
          </div>`)}
        ${blobs.slice(0, 12).map((b, i) => html`
          <div key=${'b' + i} class="stk-prev-item">
            <div class="stk-miss">图</div>
            <span class="ellipsis">${b.name}</span>
          </div>`)}
      </div>
      ${total > 36 ? html`<div class="field-desc">只预览前 36 个，导入时全部处理。</div>` : null}

      <div class="sheet-acts">
        <${Button} variant="ghost" disabled=${busy} onClick=${onCancel}>取消<//>
        <${Button} disabled=${busy || !total} onClick=${save}>
          ${busy ? `导入中 ${done}/${total}` : `导入 ${total} 个`}<//>
      </div>
    <//>`;
}

export function StickerManager() {
  useStore(db.stickers.store);
  const [pending, setPending] = useState(null);
  const [editing, setEditing] = useState(null);
  const [caching, setCaching] = useState(null);
  const imgRef = useRef(null);
  const fileRef = useRef(null);

  const groups = api.groups();
  const remote = db.stickers.where(s => s.url && !s.imageId);

  // 批量选图
  const pickImages = async e => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    setPending({
      rows: [],
      blobs: files.map(f => ({ name: f.name.replace(/\.\w+$/, ''), blob: f })),
    });
  };

  // txt / docx
  const pickFile = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      if (/\.docx$/i.test(file.name)) {
        const { rows, blobs } = await api.parseDocx(file);
        if (!rows.length && !blobs.length) { toast('这个 docx 里没找到链接或图片', 'error'); return; }
        setPending({ rows, blobs });
      } else {
        const rows = api.parseText(await file.text());
        if (!rows.length) { toast('没解析出任何一行，每行需要包含一个图片链接', 'error', 4000); return; }
        setPending({ rows, blobs: [] });
      }
    } catch (err) {
      toast('读取失败：' + err.message, 'error', 5000);
    }
  };

  const cacheAll = async () => {
    if (!remote.length) { toast('没有需要缓存的'); return; }
    setCaching({ done: 0, total: remote.length });
    const r = await api.cacheRemote(remote, (done, total) => setCaching({ done, total }));
    setCaching(null);
    toast(`已缓存 ${r.ok} 个${r.fail ? `，${r.fail} 个取不回来（多半是跨域）` : ''}`,
      r.fail ? 'error' : 'ok', 4000);
  };

  const wipeGroup = async g => {
    const list = api.inGroup(g);
    if (!await confirm({ title: `删除分组「${g}」`, message: `其中 ${list.length} 个表情会一起删除。`, danger: true })) return;
    list.forEach(s => { if (s.imageId) db.images.remove(s.imageId); db.stickers.remove(s.id); });
  };

  return html`
    <${Page} title="表情包" onBack=${nav.pop}>
      <${List} title="导入">
        <${ListItem} title="批量选图片" subtitle="一次选多张，文件名当名称" arrow
          left=${html`<${Icon} name="image" size=${18}/>`}
          onClick=${() => imgRef.current?.click()}/>
        <${ListItem} title="从 txt 导入" multiline
          subtitle="每行一个：名称|链接，或名称 链接，或只有链接。以 # 开头的行跳过。" arrow
          left=${html`<${Icon} name="notes" size=${18}/>`}
          onClick=${() => fileRef.current?.click()}/>
        <${ListItem} title="从 docx 导入" multiline
          subtitle="读取正文里的链接、文档超链接，以及内嵌的图片。" arrow
          left=${html`<${Icon} name="book" size=${18}/>`}
          onClick=${() => fileRef.current?.click()}/>
      <//>
      <input type="file" accept="image/*" multiple ref=${imgRef} onChange=${pickImages} style="display:none"/>
      <input type="file" accept=".txt,.docx,text/plain" ref=${fileRef} onChange=${pickFile} style="display:none"/>

      ${remote.length ? html`
        <div class="pad-x">
          <div class="hint-box">
            有 ${remote.length} 个还是远程链接。缓存到本地后离线也能用，
            但部分站点跨域会取不回来。
          </div>
          <${Button} full variant="ghost" icon="download" disabled=${!!caching}
            onClick=${cacheAll}>
            ${caching ? `缓存中 ${caching.done}/${caching.total}` : '全部缓存到本地'}<//>
        </div>` : null}

      ${db.stickers.count() ? groups.map(g => {
        const list = api.inGroup(g);
        return html`
          <div key=${g} class="list-wrap">
            <div class="list-title stk-group-head">
              <span>${g} · ${list.length}</span>
              <button class="press" onClick=${() => wipeGroup(g)}>
                <${Icon} name="trash" size=${14}/></button>
            </div>
            <div class="stk-grid stk-manage">
              ${list.map(s => html`
                <button key=${s.id} class="stk-cell press" onClick=${() => setEditing(s)} title=${s.name}>
                  <${StickerImg} sticker=${s}/>
                </button>`)}
            </div>
          </div>`;
      }) : html`<${EmptyState} icon="heart" title="还没有表情包"
        desc="用上面三种方式之一导入。导入前会让你确认并选分组。"/>`}

      ${pending ? html`
        <${Review} rows=${pending.rows} blobs=${pending.blobs}
          onCancel=${() => setPending(null)}
          onDone=${n => { setPending(null); toast(`导入了 ${n} 个`); }}/>` : null}

      ${editing ? html`
        <${Sheet} open=${true} onClose=${() => setEditing(null)} title=${editing.name || '表情'}>
          <div class="stk-edit-preview"><${StickerImg} sticker=${editing} size=${96}/></div>
          <${Field} label="名称">
            <${Input} value=${editing.name}
              onInput=${v => { db.stickers.update(editing.id, { name: v }); setEditing({ ...editing, name: v }); }}/>
          <//>
          <${Field} label="关键词" desc="逗号分隔。在输入框里打这些词会推荐这个表情。">
            <${Input} value=${(editing.keywords || []).join('，')}
              onInput=${v => {
                const kws = api.splitKeywords(v);
                db.stickers.update(editing.id, { keywords: kws });
                setEditing({ ...editing, keywords: kws });
              }}/>
          <//>
          <${Field} label="分组">
            <div class="chip-row">
              ${groups.map(g => html`
                <button key=${g} class=${`chip${editing.group === g ? ' is-active' : ''}`}
                  onClick=${() => { db.stickers.update(editing.id, { group: g }); setEditing({ ...editing, group: g }); }}>${g}</button>`)}
              <button class="chip" onClick=${async () => {
                const name = await prompt({ title: '新建分组' });
                if (!name) return;
                db.stickers.update(editing.id, { group: name.trim() });
                setEditing({ ...editing, group: name.trim() });
              }}>新建</button>
            </div>
          <//>
          <div class="sheet-acts">
            <${Button} variant="ghost" onClick=${async () => {
              if (!await confirm({ title: '删除这个表情', danger: true })) return;
              if (editing.imageId) db.images.remove(editing.imageId);
              db.stickers.remove(editing.id);
              setEditing(null);
            }}>删除<//>
            <${Button} onClick=${() => setEditing(null)}>完成<//>
          </div>
        <//>` : null}
    <//>`;
}
