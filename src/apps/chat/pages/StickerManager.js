import { html, useState, useRef } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, Button, Icon, Sheet,
         EmptyState, toast, confirm, prompt } from '../../../ui/index.js';
import { StickerImg } from './StickerBits.js';

const { db, nav, stickers: api } = phone;

// 粘贴进来的那一份。
//
// 前面三条路都要**先有一个文件**：选图、txt、docx。可手上常常只有
// 剪贴板里的东西 —— 从聊天软件里复制的一张图，或者别处抄来的一串链接。
// 为此专门存一个文件再导入是多绕一圈，所以这里直接收剪贴板。
//
// 两样都收：贴进来的图片当场收下，贴进来的文字按 txt 那套规则逐行解析。
function PastePane({ onParsed, onCancel }) {
  const [text, setText] = useState('');
  const [blobs, setBlobs] = useState([]);

  const onPaste = e => {
    const files = [...(e.clipboardData?.files || [])].filter(f => /^image\//.test(f.type));
    if (!files.length) return;
    e.preventDefault();
    setBlobs(list => [...list, ...files.map((f, i) => ({
      name: (f.name || '').replace(/\.\w+$/, '') || `粘贴的图片 ${list.length + i + 1}`,
      blob: f,
    }))]);
  };

  const go = () => {
    const rows = api.parseText(text);
    if (!rows.length && !blobs.length) {
      toast('没有解析出内容。请粘贴图片，或每行粘贴一个图片链接', 'error', 4000);
      return;
    }
    onParsed({ rows, blobs });
  };

  return html`
    <${Sheet} open=${true} onClose=${onCancel} title="粘贴导入" height="70%">
      <div class="hint-box">
        直接粘贴图片即可收下；粘贴文字时每行一条，格式与 txt 导入相同：
        名称|链接、名称 链接，或仅链接。
      </div>
      <${Field} label="粘贴处">
        <${Textarea} rows=${6} value=${text} onPaste=${onPaste}
          onInput=${setText} placeholder="在此粘贴图片或链接"/>
      <//>
      ${blobs.length ? html`
        <div class="pad-x">
          <div class="field-desc">已收下 ${blobs.length} 张图片。</div>
        </div>` : null}
      <div class="sheet-acts">
        <${Button} variant="ghost" onClick=${onCancel}>取消<//>
        <${Button} onClick=${go}>下一步<//>
      </div>
    <//>`;
}

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
  useStore(db.settings.store);
  const [pending, setPending] = useState(null);
  const [pasting, setPasting] = useState(false);
  const [editing, setEditing] = useState(null);
  const [caching, setCaching] = useState(null);
  const imgRef = useRef(null);
  const fileRef = useRef(null);
  const oneRef = useRef(null);
  // 「逐条添加」要传进哪个分组。按下哪个组的加号就是哪个
  const intoRef = useRef(api.DEFAULT_GROUP);

  const groups = api.groups();
  const remote = db.stickers.where(s => s.url && !s.imageId);

  // 一次一张。传完当场打开那一条的编辑面板 —— 一条一条传的意思正是
  // 每一条都要单独取名、单独配关键词，传完还要回列表里找一遍是多绕一圈
  const pickOne = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const row = await api.addFromBlob({
        name: (file.name || '').replace(/\.\w+$/, ''),
        blob: file,
        group: intoRef.current || api.DEFAULT_GROUP,
      });
      setEditing(row);
    } catch (err) {
      toast('这张没有存下来：' + (err.message || err), 'error', 5000);
    }
  };

  const addOneTo = g => { intoRef.current = g; oneRef.current?.click(); };

  const newGroup = async () => {
    const name = await prompt({ title: '新建分组', placeholder: '分组名' });
    const g = api.addGroup(name);
    if (!g) return;
    toast(`已新建分组「${g}」`, 'ok');
  };

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
        if (!rows.length && !blobs.length) { toast('该 docx 中未找到链接或图片', 'error'); return; }
        setPending({ rows, blobs });
      } else {
        const rows = api.parseText(await file.text());
        if (!rows.length) { toast('未解析出有效内容，每行需包含一个图片链接', 'error', 4000); return; }
        setPending({ rows, blobs: [] });
      }
    } catch (err) {
      toast('读取失败：' + err.message, 'error', 5000);
    }
  };

  const cacheAll = async () => {
    if (!remote.length) { toast('没有需要缓存的表情'); return; }
    setCaching({ done: 0, total: remote.length });
    const r = await api.cacheRemote(remote, (done, total) => setCaching({ done, total }));
    setCaching(null);
    toast(`已缓存 ${r.ok} 个${r.fail ? `，${r.fail} 个获取失败（通常为跨域限制）` : ''}`,
      r.fail ? 'error' : 'ok', 4000);
  };

  const wipeGroup = async g => {
    const list = api.inGroup(g);
    if (!await confirm({
      title: `删除分组「${g}」`,
      message: list.length ? `该分组下的 ${list.length} 个表情将一并删除。` : '该分组下没有表情。',
      danger: true,
    })) return;
    list.forEach(s => { if (s.imageId) db.images.remove(s.imageId); db.stickers.remove(s.id); });
    api.removeGroup(g);
  };

  const renameGroup = async g => {
    const name = await prompt({ title: '重命名分组', value: g, placeholder: '分组名' });
    if (!name || name.trim() === g) return;
    api.renameGroup(g, name);
  };

  return html`
    <${Page} title="表情包" onBack=${nav.pop}>
      <${List} title="导入">
        <${ListItem} title="逐条添加" multiline
          subtitle="一次一张，存下之后立即填写名称、关键词与分组。" arrow
          left=${html`<${Icon} name="plus" size=${18}/>`}
          onClick=${() => addOneTo(api.DEFAULT_GROUP)}/>
        <${ListItem} title="粘贴导入" multiline
          subtitle="直接粘贴图片，或粘贴每行一条的图片链接，不必先存成文件。" arrow
          left=${html`<${Icon} name="copy" size=${18}/>`}
          onClick=${() => setPasting(true)}/>
        <${ListItem} title="批量选择图片" subtitle="可一次选择多张，文件名作为表情名称" arrow
          left=${html`<${Icon} name="image" size=${18}/>`}
          onClick=${() => imgRef.current?.click()}/>
        <${ListItem} title="从 txt 导入" multiline
          subtitle="每行一条：名称|链接、名称 链接，或仅链接。以 # 开头的行将被忽略。" arrow
          left=${html`<${Icon} name="notes" size=${18}/>`}
          onClick=${() => fileRef.current?.click()}/>
        <${ListItem} title="从 docx 导入" multiline
          subtitle="读取正文中的链接、文档超链接以及内嵌图片。" arrow
          left=${html`<${Icon} name="book" size=${18}/>`}
          onClick=${() => fileRef.current?.click()}/>
      <//>
      <${List} title="分组">
        <${ListItem} title="新建分组" multiline
          subtitle="先建一个空分组，再把表情放进去。分组名也可以在导入时直接填写。" arrow
          left=${html`<${Icon} name="folder" size=${18}/>`}
          onClick=${newGroup}/>
      <//>

      <input type="file" accept="image/*" ref=${oneRef} onChange=${pickOne} style="display:none"/>
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

      ${groups.length ? groups.map(g => {
        const list = api.inGroup(g);
        return html`
          <div key=${g} class="list-wrap">
            <div class="list-title stk-group-head">
              <span>${g} · ${list.length}</span>
              <span class="stk-group-acts">
                <button class="press" aria-label=${`往「${g}」里添加`}
                  onClick=${() => addOneTo(g)}><${Icon} name="plus" size=${14}/></button>
                <button class="press" aria-label=${`重命名「${g}」`}
                  onClick=${() => renameGroup(g)}><${Icon} name="edit" size=${14}/></button>
                <button class="press" aria-label=${`删除「${g}」`}
                  onClick=${() => wipeGroup(g)}><${Icon} name="trash" size=${14}/></button>
              </span>
            </div>
            ${list.length ? html`
              <div class="stk-grid stk-manage">
                ${list.map(s => html`
                  <button key=${s.id} class="stk-cell press" onClick=${() => setEditing(s)} title=${s.name}>
                    <${StickerImg} sticker=${s}/>
                  </button>`)}
              </div>`
            : html`<div class="settings-foot">这个分组还是空的。按上面的加号逐条添加。</div>`}
          </div>`;
      }) : html`<${EmptyState} icon="heart" title="暂无表情包"
        desc="可逐条添加、粘贴导入，或批量选择图片。导入前需确认内容并指定分组。"/>`}

      ${pasting ? html`
        <${PastePane} onCancel=${() => setPasting(false)}
          onParsed=${p => { setPasting(false); setPending(p); }}/>` : null}

      ${pending ? html`
        <${Review} rows=${pending.rows} blobs=${pending.blobs}
          onCancel=${() => setPending(null)}
          onDone=${n => { setPending(null); toast(`已导入 ${n} 个`); }}/>` : null}

      ${editing ? html`
        <${Sheet} open=${true} onClose=${() => setEditing(null)} title=${editing.name || '表情'}>
          <div class="stk-edit-preview"><${StickerImg} sticker=${editing} size=${96}/></div>
          <${Field} label="名称">
            <${Input} value=${editing.name}
              onInput=${v => { db.stickers.update(editing.id, { name: v }); setEditing({ ...editing, name: v }); }}/>
          <//>
          <${Field} label="关键词" desc="以逗号分隔。输入框中出现这些词时会推荐该表情。">
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
                const g = api.addGroup(await prompt({ title: '新建分组' }));
                if (!g) return;
                db.stickers.update(editing.id, { group: g });
                setEditing({ ...editing, group: g });
              }}>新建</button>
            </div>
          <//>
          <div class="sheet-acts">
            <${Button} variant="ghost" onClick=${async () => {
              if (!await confirm({ title: '删除该表情', danger: true })) return;
              if (editing.imageId) db.images.remove(editing.imageId);
              db.stickers.remove(editing.id);
              setEditing(null);
            }}>删除<//>
            <${Button} onClick=${() => setEditing(null)}>完成<//>
          </div>
        <//>` : null}
    <//>`;
}
