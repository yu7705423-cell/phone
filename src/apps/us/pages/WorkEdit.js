import { html, useRef } from '../../../lib.js';
import { phone, useStore, useImage } from '../../../sdk/index.js';
import { Page, EmptyState, Field, Textarea, List, ListItem, Button, toast } from '../../../ui/index.js';
import { WorkFields, WorkSwitches, TonePick } from './Bits.js';

const { db, nav, work } = phone;

/**
 * 封面。气泡版式下顶上那张方形卡用它（见 ARCHITECTURE 4.118）。
 * 没有图时那张卡用标题的头一个字排，所以这里不是必填的。
 */
function CoverPick({ w }) {
  const fileRef = useRef(null);
  const url = useImage(w.cover);
  const choose = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const id = await db.images.put(file, 640);
      const old = w.cover;
      work.update(w.id, { cover: id });
      if (old) db.images.remove(old);
    } catch (err) { toast('图片处理失败：' + (err.message || err), 'error'); }
  };
  return html`
    <div class="pad-x pad-t">
      <${Field} label="封面" desc="气泡版式下显示在正文上方。留空时用标题的第一个字排一张。">
        <div class="wk-cover-row">
          <button class="wk-cover press" onClick=${() => fileRef.current?.click()}
            aria-label="更换封面">
            ${url ? html`<img src=${url} alt=""/>` : html`<span>选择图片</span>`}
          <//>
          ${w.cover ? html`
            <${Button} size="sm" variant="ghost"
              onClick=${() => { const old = w.cover; work.update(w.id, { cover: null }); if (old) db.images.remove(old); }}>
              移除
            <//>` : null}
        </div>
      <//>
      <input type="file" accept="image/*" ref=${fileRef} onChange=${choose} style="display:none"/>
    </div>`;
}

// 这一部的设定。**只有这一个入口**（第 5 条）—— 改它的时候人正在这一部里。
export function WorkEdit({ workId }) {
  useStore(db.works.store);
  useStore(db.settings.store);

  const w = work.get(workId);
  if (!w) {
    return html`<${Page} title="设定" onBack=${nav.pop}>
      <${EmptyState} title="这一部已经不在了"/><//>`;
  }

  const v = {
    title: w.title || '', premise: w.premise || '',
    charName: w.charAs?.name || '', charPersona: w.charAs?.persona || '',
    meName: w.meAs?.name || '', mePersona: w.meAs?.persona || '',
    carry: w.carry === true, solo: w.solo === true, opening: w.opening || 'char',
  };
  const set = patch => {
    const next = {};
    if ('title' in patch) next.title = patch.title;
    if ('premise' in patch) next.premise = patch.premise;
    if ('carry' in patch) next.carry = patch.carry;
    if ('solo' in patch) next.solo = patch.solo;
    if ('opening' in patch) next.opening = patch.opening;
    if ('charName' in patch || 'charPersona' in patch) {
      next.charAs = { name: patch.charName ?? v.charName, persona: patch.charPersona ?? v.charPersona };
    }
    if ('meName' in patch || 'mePersona' in patch) {
      next.meAs = { name: patch.meName ?? v.meName, persona: patch.mePersona ?? v.mePersona };
    }
    work.update(workId, next);
  };

  return html`
    <${Page} title="这一部" onBack=${nav.pop}>
      <div class="pad">
        <${WorkFields} v=${v} set=${set} kind=${w.kind}
          onGenerate=${who => phone.ai.novel.identity(w, { who })}/>
      </div>
      <${CoverPick} w=${w}/>
      <${WorkSwitches} v=${v} set=${set} kind=${w.kind}/>
      <${TonePick} value=${phone.tone.idsOf(w)} text=${w.toneText}
        onChange=${patch => work.update(workId, patch)}/>
      <${List}>
        <${ListItem} title="外观" multiline
          subtitle="纸色、字号、版式与首字下沉。和线下共用一套，在那边改。"
          arrow onClick=${() => phone.intent.open('chat', { route: '/stage/settings', back: true })}/>
      <//>
    <//>`;
}

/** 一篇自己的设定：题目、地点、时刻、情境、摘要。 */
export function ChapterEdit({ chapterId }) {
  useStore(db.chapters.store);
  const row = work.getChapter(chapterId);
  const w = work.workOfChapter(chapterId);
  if (!row || !w) {
    return html`<${Page} title="这一篇" onBack=${nav.pop}>
      <${EmptyState} title="这一篇已经不在了"/><//>`;
  }
  const set = patch => work.updateChapter(chapterId, patch);
  return html`
    <${Page} title="这一篇" onBack=${nav.pop}>
      <div class="pad">
        <${Field} label="题目">
          <${Textarea} rows=${1} value=${row.title || ''} onInput=${v => set({ title: v })}/>
        <//>
        <${Field} label="地点">
          <${Textarea} rows=${1} value=${row.place || ''} onInput=${v => set({ place: v })}/>
        <//>
        <${Field} label="时刻" desc="例如 2026-01-01 周三 14:30。留空表示不写。">
          <${Textarea} rows=${1} value=${row.at || ''} onInput=${v => set({ at: v })}/>
        <//>
        <${Field} label="情境" desc="这一篇开始时的处境。是事实，不是指令。">
          <${Textarea} rows=${3} value=${row.note || ''} onInput=${v => set({ note: v })}/>
        <//>
        ${row.summary ? html`
          <${Field} label="摘要" desc="收篇时生成。后面几篇的设定区里带的就是它。">
            <${Textarea} rows=${5} value=${row.summary} onInput=${v => set({ summary: v })}/>
          <//>` : null}
      </div>
    <//>`;
}
