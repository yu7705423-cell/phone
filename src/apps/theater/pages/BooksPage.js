import { html, useState, useRef } from '../../../lib.js';
import { phone, useStore, useThumb } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Button, Icon, Sheet, Spinner,
         EmptyState, toast, confirm } from '../../../ui/index.js';

const { db, nav, book } = phone;

const ACCEPT = '.txt,.epub,text/plain,application/epub+zip';

function Cover({ row, size = 44 }) {
  const url = useThumb(row.cover);
  const st = `width:${size}px;height:${Math.round(size * 1.4)}px`;
  return url
    ? html`<div class="bk-cover has-image" style=${`${st};background-image:url(${url})`}></div>`
    : html`<div class="bk-cover" style=${st}><${Icon} name="book" size=${Math.round(size / 2.4)}/></div>`;
}

// 先读出来给你看一眼，确认了再入库。一本长篇解析要几秒，
// 中途什么都不显示会以为卡死了。
function AddSheet({ open, onClose }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [got, setGot] = useState(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');

  const pick = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true); setGot(null);
    try {
      const parsed = await book.parse(file);
      setGot(parsed); setTitle(parsed.title); setAuthor(parsed.author);
    } catch (err) { toast(String(err.message || err), 'error', 5000); }
    finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true);
    try {
      const row = await book.add({ ...got, title, author });
      toast(`已导入《${row.title}》`, 'ok');
      setGot(null); onClose();
      nav.push(`/book/${row.id}`);
    } catch (err) { toast(String(err.message || err), 'error', 5000); }
    finally { setBusy(false); }
  };

  if (!open) return null;
  return html`
    <${Sheet} open=${true} onClose=${() => { setGot(null); onClose(); }} title="导入书籍" height="80%">
      ${got ? html`
        <div class="pad-x">
          <${Field} label="书名"><${Input} value=${title} onInput=${v => setTitle(v)}/><//>
          <${Field} label="作者"><${Input} value=${author} placeholder="可留空"
            onInput=${v => setAuthor(v)}/><//>
        </div>
        <${List} title="读出来的内容">
          <${ListItem} title="正文" subtitle=${`${got.text.length.toLocaleString()} 字`} multiline/>
          <${ListItem} title="章节" subtitle=${`${got.chapters.length} 章`} multiline/>
          <${ListItem} title="格式" subtitle=${got.kind === 'epub' ? 'epub' : '纯文本'} multiline/>
          ${got.coverBlob ? html`<${ListItem} title="封面" subtitle="书里自带，一并存下"/>` : null}
        <//>
        <div class="pad-x">
          <div class="hint-box">${got.text.slice(0, 160)}…</div>
        </div>
        <div class="pad batch-acts">
          <${Button} disabled=${busy} onClick=${save}>${busy ? '正在存' : '存入书库'}<//>
          <${Button} variant="ghost" onClick=${() => setGot(null)}>换一本<//>
        </div>
      ` : html`
        <div class="pad-x pad-t">
          <${Field} label="选一个文件"
            desc="支持 txt 与 epub。txt 会自动判断编码，GBK 与 UTF-8 均可读取。">
            <${Button} full variant="ghost" icon="upload" disabled=${busy}
              onClick=${() => fileRef.current?.click()}>
              ${busy ? html`<${Spinner} size=${15}/> 正在读` : '选文件'}
            <//>
          <//>
        </div>
        <div class="settings-foot">
          正文只存在这台设备上，不会上传。章节按「第 N 章」一类的行自动划分，
          epub 按它自己的目录划分。
        </div>
      `}
      <input type="file" accept=${ACCEPT} ref=${fileRef} onChange=${pick} style="display:none"/>
    <//>`;
}

export function BooksPage() {
  useStore(db.ebooks.store);
  const [adding, setAdding] = useState(false);
  const rows = book.all();

  const drop = async row => {
    if (!await confirm({ title: `删除《${row.title}》`, danger: true,
      message: '正文与封面一并删除。阅读进度也会丢失。' })) return;
    book.remove(row.id);
  };

  return html`
    <${Page} title="书库" onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${() => setAdding(true)}>导入</button>`}>
      ${rows.length ? html`
        <${List}>
          ${rows.map(r => html`
            <${ListItem} key=${r.id} multiline arrow
              left=${html`<${Cover} row=${r}/>`}
              title=${r.title}
              subtitle=${`${r.author ? r.author + ' · ' : ''}${(r.chars || 0).toLocaleString()} 字`
                + ` · ${(r.chapters || []).length} 章`
                + `${r.at ? ` · 读到 ${book.percentOf(r)}%` : ''}`}
              onClick=${() => nav.push(`/book/${r.id}`)}
              right=${html`<button class="nav-text press"
                onClick=${e => { e.stopPropagation(); drop(r); }}>删除</button>`}/>`)}
        <//>`
      : html`
        <${EmptyState} icon="book" title="书库是空的"
          desc="导入一本 txt 或 epub。导入之后可以自己读，也可以与角色一起读。"
          action=${html`<${Button} size="sm" icon="upload"
            onClick=${() => setAdding(true)}>导入书籍<//>`}/>`}

      <${AddSheet} open=${adding} onClose=${() => setAdding(false)}/>
    <//>`;
}
