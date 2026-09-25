import { html, useState } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Button, Field, Input, Switch, Segmented, NumberInput,
         EmptyState, toast } from '../../ui/index.js';

const { db, nav, lorefile } = phone;

// 世界书的批量导入与导出（system/lorefile.js）。见 ARCHITECTURE 4.235
//
// 导入：选中的 txt、docx、zip 先读成草稿，放在这一页上逐本确认 —— 名称、用途、全局、
// 启用、常驻、位置，这一本要不要 —— 全部定好之后一并保存。确定之前一条都不入库。
// 这一页可以看到每本的开头几句：这是「先看一眼再决定存不存」的确认页。

const PURPOSES = [
  { value: 'chat', label: '对话' },
  { value: 'image', label: '生图' },
  { value: 'voice', label: '语音' },
];
const PARTS = [
  { value: 'before', label: '角色前' },
  { value: 'after', label: '角色后' },
];

// 读出来的草稿放在模块里：选文件在列表页，确认在这一页，中间隔着一次导航
let pending = { drafts: [], failed: [] };
export const setPending = p => { pending = p; };

function settingsOf(d) {
  return {
    include: true, name: d.name, purpose: d.purpose || 'chat', global: !!d.global,
    keepOwn: !!d.own, enabled: true,
    // 没有关键词的条目只有常驻才会注入。整篇读成一条的那种没有关键词，默认常驻
    constant: !(d.entries || []).some(e => (e.keys || []).length),
    part: 'before', depth: 0,
  };
}

function DraftCard({ d, s, onChange }) {
  const set = patch => onChange({ ...s, ...patch });
  const n = (d.entries || []).length;
  const first = String(d.entries?.[0]?.content || '').replace(/\s+/g, ' ').slice(0, 80);
  const bare = s.purpose !== 'chat';
  return html`
    <div class=${`lb-draft${s.include ? '' : ' is-off'}`}>
      <${List} title=${d.source}>
        <${ListItem} title="导入这一本" subtitle=${`${n} 个条目${first ? `。${first}` : ''}`} multiline
          right=${html`<${Switch} checked=${s.include} onChange=${v => set({ include: v })}/>`}/>
      <//>
      ${s.include ? html`
        <div class="pad-x">
          <${Field} label="名称">
            <${Input} value=${s.name} onInput=${v => set({ name: v })}/>
          <//>
          <${Field} label="用途">
            <${Segmented} value=${s.purpose} items=${PURPOSES} onChange=${v => set({ purpose: v })}/>
          <//>
        </div>
        <${List}>
          <${ListItem} title="全局生效" subtitle="对所有角色注入，无需单独关联"
            right=${html`<${Switch} checked=${s.global} onChange=${v => set({ global: v })}/>`}/>
          ${d.own ? html`
            <${ListItem} title="保留文件里每一条的设置" multiline
              subtitle="文件里写明了每一条的关键词、常驻、位置与深度。关闭后整本按下面的设置统一处理"
              right=${html`<${Switch} checked=${s.keepOwn} onChange=${v => set({ keepOwn: v })}/>`}/>` : null}
          ${d.own && s.keepOwn ? null : html`
            <${ListItem} title="启用"
              right=${html`<${Switch} checked=${s.enabled} onChange=${v => set({ enabled: v })}/>`}/>
            <${ListItem} title="常驻" multiline
              subtitle="开启后每一轮都注入。关闭时，条目需有关键词、在对话中提到才注入；从文件读入的条目多半没有关键词"
              right=${html`<${Switch} checked=${s.constant} onChange=${v => set({ constant: v })}/>`}/>`}
        <//>
        ${d.own && s.keepOwn || bare ? null : html`
          <div class="pad-x pad-b">
            <${Field} label="所属部分">
              <${Segmented} value=${s.part} items=${PARTS} onChange=${v => set({ part: v })}/>
            <//>
            <${Field} label="注入深度" desc="0 表示放在设定区；大于 0 表示插在对话中倒数第几条之前。">
              <${NumberInput} value=${s.depth} min=${0} onChange=${v => set({ depth: v || 0 })}/>
            <//>
          </div>`}` : null}
    </div>`;
}

export function ImportPage() {
  const { drafts, failed } = pending;
  const [sets, setSets] = useState(() => Object.fromEntries(drafts.map(d => [d.key, settingsOf(d)])));
  const chosen = drafts.filter(d => sets[d.key]?.include);

  const saveAll = () => {
    chosen.forEach(d => lorefile.save(d, sets[d.key]));
    toast(`已导入 ${chosen.length} 本世界书`, 'ok');
    pending = { drafts: [], failed: [] };
    nav.pop();
  };

  if (!drafts.length) {
    return html`<${Page} title="导入世界书" onBack=${nav.pop}>
      <${EmptyState} icon="book" title="没有读到可导入的内容"
        desc=${failed.length ? failed.join('\n') : '支持 txt、docx，以及装有它们的 zip。'}/>
    <//>`;
  }

  return html`
    <${Page} title="导入世界书" onBack=${nav.pop}>
      <div class="settings-foot">
        每个文件导入为一本世界书。逐本确认设置，全部确定后点底部的保存；保存之前不会写入。
        ${failed.length ? `以下文件未能读取：${failed.join('；')}` : ''}
      </div>
      ${drafts.map(d => html`
        <${DraftCard} key=${d.key} d=${d} s=${sets[d.key]}
          onChange=${s => setSets({ ...sets, [d.key]: s })}/>`)}
      <div class="pad">
        <${Button} full disabled=${!chosen.length} onClick=${saveAll}>
          ${chosen.length ? `保存 ${chosen.length} 本` : '未选择任何一本'}
        <//>
      </div>
    <//>`;
}

export function ExportPage() {
  useStore(db.lorebooks.store);
  const books = db.lorebooks.all().sort((a, b) => b.updatedAt - a.updatedAt);
  const [picked, setPicked] = useState(() => new Set(books.map(b => b.id)));
  const [format, setFormat] = useState('txt');
  const [packed, setPacked] = useState('zip');
  const [busy, setBusy] = useState(false);
  const all = picked.size === books.length;
  const toggle = id => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  };

  const run = async () => {
    setBusy(true);
    try {
      const n = await lorefile.exportBooks(books.filter(b => picked.has(b.id)), { format, packed: packed === 'zip' });
      toast(packed === 'zip' ? `已导出 ${picked.size} 本，打包为一个 zip` : `已导出 ${n} 个文件`, 'ok');
    } catch (err) { toast(String(err.message || err), 'error'); }
    finally { setBusy(false); }
  };

  if (!books.length) {
    return html`<${Page} title="导出世界书" onBack=${nav.pop}><${EmptyState} icon="book" title="暂无世界书"/><//>`;
  }

  return html`
    <${Page} title="导出世界书" onBack=${nav.pop}>
      <div class="pad-x pad-t">
        <${Field} label="格式">
          <${Segmented} value=${format} onChange=${setFormat}
            items=${[{ value: 'txt', label: 'txt' }, { value: 'docx', label: 'docx' }]}/>
        <//>
        <${Field} label="保存方式"
          desc=${packed === 'zip' ? '全部装进一个 zip 文件。' : '每本单独保存为一个文件。数量较多时浏览器可能询问是否允许下载多个文件。'}>
          <${Segmented} value=${packed} onChange=${setPacked}
            items=${[{ value: 'zip', label: '一个 zip' }, { value: 'each', label: '单独文件' }]}/>
        <//>
      </div>
      <${List} title=${`已选 ${picked.size} / ${books.length} 本`}>
        <${ListItem} title="全选"
          right=${html`<${Switch} checked=${all}
            onChange=${v => setPicked(v ? new Set(books.map(b => b.id)) : new Set())}/>`}/>
        ${books.map(b => html`
          <${ListItem} key=${b.id} title=${b.name} subtitle=${`${(b.entries || []).length} 个条目`}
            right=${html`<${Switch} checked=${picked.has(b.id)} onChange=${() => toggle(b.id)}/>`}/>`)}
      <//>
      <div class="settings-foot">
        导出的文件可再次导入，每一条的关键词、常驻、位置与深度会原样还原。
      </div>
      <div class="pad">
        <${Button} full disabled=${!picked.size || busy} onClick=${run}>${busy ? '正在导出' : '导出'}<//>
      </div>
    <//>`;
}
