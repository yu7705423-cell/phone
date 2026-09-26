import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Sheet, List, ListItem, NumberInput, Field, Button, Spinner, toast, confirm } from '../../../ui/index.js';

const { db, nav, work, ai, novel } = phone;

// 章末分支（ARCHITECTURE 4.264）。一章写完，下一章三选一：自己写、让它接着写、给我几个走向再挑。
// 「给我几个走向」一次请求，候选数由用户填（settings.novelBranchCount，默认 3）。
// 选了偏离大纲的走向，作品上记一笔 drift，作品页多一条「重排后续大纲」（不自动）。

const countOf = () => Math.max(1, Math.round(Number(db.settings.get().novelBranchCount) || 3));

/** 开下一章。落在没章纲的卷上先问一声；有章纲就把题目带上（走向选了的以走向为准） */
export async function startChapter(w, { title = '', plan = '', opening = '' } = {}) {
  const next = work.chaptersOf(w.id).reduce((n, c) => Math.max(n, c.no || 0), 0) + 1;
  if (novel.hasOutline(w)) {
    const miss = novel.volumeMissing(w, next);
    if (miss && ai.isConfigured()) {
      const go = await confirm({ title: `第 ${miss.no} 卷的章纲还没有生成`, message: '先生成这一卷的章纲（调用一次接口），还是直接开始写这一章。', okText: '先生成', cancelText: '直接写' });
      if (go) {
        try { novel.applyVolume(w.id, miss.no, await ai.novel.volume(work.get(w.id), miss)); }
        catch (e) { toast(String(e.message || e), 'error', 5000); }
      }
    }
  }
  const line = novel.lineOf(work.get(w.id), next);
  const row = work.addChapter(w.id, { title: title || line?.title || '', plan, opening });
  if (row) nav.push(`/read/${row.id}`);
  return row;
}

export function NextChapterSheet({ w, chapter, open, onClose }) {
  useStore(db.settings.store);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState(null);
  const close = () => { setOptions(null); onClose(); };
  const go = async extra => { close(); await startChapter(w, extra); };
  const ask = async () => {
    if (!ai.isConfigured()) { toast('尚未配置接口', 'error'); return; }
    setBusy(true);
    try { setOptions(await ai.novel.branches(work.get(w.id), chapter, { count: countOf() })); }
    catch (e) { toast(String(e.message || e), 'error', 5000); }
    finally { setBusy(false); }
  };
  const pick = async opt => {
    if (!opt.follows && novel.hasOutline(w)) novel.setOutline(w.id, { drift: true });
    await go({ title: opt.title, plan: opt.line });
  };
  const next = work.chaptersOf(w.id).reduce((n, c) => Math.max(n, c.no || 0), 0) + 1;
  const planned = novel.lineOf(w, next);
  return html`
    <${Sheet} open=${open} onClose=${close} title=${`第 ${next} 章`} height="70%">
      ${options ? html`
        <${List} title="选一个走向">
          ${options.map((o, i) => html`
            <${ListItem} key=${i} title=${o.title || `走向 ${i + 1}`} subtitle=${o.line} multiline arrow
              right=${html`<span class="nv-tag">${o.follows ? '沿大纲' : '偏离大纲'}</span>`} onClick=${() => pick(o)}/>`)}
        <//>
        <div class="settings-foot">选择偏离大纲的走向后，作品页会提示「按现在的走向重排后续大纲」，不会自动重排。</div>
        <div class="pad"><${Button} full variant="ghost" disabled=${busy} onClick=${ask}>${busy ? html`<${Spinner} size=${14}/>` : '换一批'}<//></div>` : html`
        <${List}>
          ${planned && novel.visibleChapters(w) !== 0 ? html`<${ListItem} title="大纲里这一章" subtitle=${`${planned.title ? `${planned.title}　` : ''}${planned.line}`} multiline/>` : null}
          <${ListItem} title="自己写下一章" subtitle="新建一章，由我先写" multiline arrow onClick=${() => go({ opening: 'me' })}/>
          <${ListItem} title="让它接着写" subtitle="新建一章，立即生成第一段，调用一次接口" multiline arrow onClick=${() => go({ opening: 'char' })}/>
          <${ListItem} title=${busy ? '正在想' : '给我几个走向'} subtitle="列出几个可能的走向再挑，调用一次接口；选定后再开写" multiline arrow onClick=${busy ? null : ask}/>
        <//>
        <div class="pad-x">
          <${Field} label="给几个走向" desc="每次请求返回这么多个候选。">
            <${NumberInput} unit="个" min=${1} value=${countOf()} onChange=${v => db.settings.set({ novelBranchCount: Math.max(1, v || 1) })}/>
          <//>
        </div>`}
    <//>`;
}
