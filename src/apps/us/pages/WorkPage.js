import { html } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, EmptyState, Button, IconButton, Icon,
         toast, confirm } from '../../../ui/index.js';
import { Hero, chapterTitle, dateOf } from './Bits.js';
import { OutlineMade } from './NewSaga.js';
import { html as h2, useState } from '../../../lib.js';

const { db, nav, work, scene, novel, ai } = phone;

// 大纲那一节（4.263）。可见：总纲、各卷、章纲（缺的卷可以补）；隐藏：只说有几卷、写到哪，可揭晓；无：可以生成。
// 剧情偏离大纲之后（4.264）多一条「重排后续大纲」
function OutlinePanel({ w }) {
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(0);
  const o = novel.outlineOf(w);
  const p = novel.progressOf(w);
  const run = async (what, fn) => {
    if (!ai.isConfigured()) { toast('尚未配置接口', 'error'); return; }
    setBusy(what);
    try { await fn(); } catch (e) { toast(String(e.message || e), 'error', 5000); } finally { setBusy(''); }
  };
  const make = mode => run('outline', async () => {
    if (!String(w.premise || '').trim()) throw new Error('请先在「这一部的设定」里写一段简介');
    novel.setOutline(w.id, { mode });
    novel.applyOutline(w.id, await ai.novel.outline(work.get(w.id)));
    toast('大纲已生成', 'ok');
  });
  const fill = vol => run(`vol${vol.no}`, async () => {
    novel.applyVolume(w.id, vol.no, await ai.novel.volume(work.get(w.id), vol));
    toast(`第 ${vol.no} 卷的章纲已生成`, 'ok');
  });
  const replan = () => run('replan', async () => {
    const from = p.started + 1;
    const made = await ai.novel.replan(work.get(w.id), from);
    const kept = o.volumes.filter(v => v.to < from);
    const keptCh = {};
    kept.forEach(v => { if (o.chapters[v.no]) keptCh[v.no] = o.chapters[v.no]; });
    const fresh = (made.volumes || []).map((v, i) => ({ ...v, no: kept.length + i + 1 }));
    const chs = { ...keptCh };
    fresh.forEach(v => { if (Array.isArray(v.chapters) && v.chapters.length) chs[v.no] = v.chapters; });
    novel.setOutline(w.id, { master: made.master || o.master, volumes: [...kept, ...fresh.map(({ chapters: _c, ...v }) => v)], chapters: chs, drift: false, madeAt: Date.now() });
    toast('后续大纲已重排', 'ok');
  });
  const calls = (w.length?.chapters || 0) > 0 && w.length.chapters <= novel.ONE_SHOT_CHAPTERS ? '调用一次接口' : '调用一次接口生成总纲与卷纲，各卷章纲写到时再生成';

  if (o.mode === novel.NONE || !o.master) {
    return h2`
      <${List} title="大纲">
        <${ListItem} title=${o.mode === novel.NONE ? '无大纲，自由创作' : '大纲尚未生成'} multiline
          subtitle=${`每章只带前情与简介。${calls}。`}/>
        <${ListItem} title=${busy === 'outline' ? '正在生成' : '生成大纲（可见）'} arrow onClick=${busy ? null : () => make(novel.VISIBLE)}/>
        <${ListItem} title="生成大纲（隐藏）" subtitle="生成后不显示内容，写作时使用；可随时揭晓" multiline arrow onClick=${busy ? null : () => make(novel.HIDDEN)}/>
      <//>`;
  }
  const limit = novel.visibleChapters(w);     // null 不限；数字 = 只露到第几章
  const hidden = o.mode === novel.HIDDEN;
  const show = !hidden || o.revealed !== 'none';
  return h2`
    <${List} title="大纲">
      <${ListItem} title=${hidden ? '大纲已隐藏' : '大纲'} multiline
        subtitle=${`${o.volumes.length} 卷 · 已写 ${p.started} 章${p.total ? ` / 预计 ${p.total} 章` : ''}${o.drift ? ' · 剧情已偏离大纲' : ''}`}/>
      ${hidden ? h2`
        <${ListItem} title=${o.revealed === 'written' ? '已揭晓到目前为止' : '揭晓到目前为止'} subtitle="只显示已经写到的章" multiline
          onClick=${() => novel.setOutline(w.id, { revealed: o.revealed === 'written' ? 'none' : 'written' })}/>
        <${ListItem} title=${o.revealed === 'all' ? '重新隐藏' : '全部揭晓'} onClick=${() => novel.setOutline(w.id, { revealed: o.revealed === 'all' ? 'none' : 'all' })}/>` : null}
      ${o.drift ? h2`<${ListItem} title=${busy === 'replan' ? '正在重排' : '按现在的走向重排后续大纲'} subtitle="从下一章起重排，已写的章不动。调用一次接口" multiline arrow onClick=${busy ? null : replan}/>` : null}
      <${ListItem} title=${busy === 'outline' ? '正在生成' : '重新生成大纲'} subtitle=${calls} multiline onClick=${busy ? null : () => make(o.mode)}/>
    <//>
    ${show ? h2`
      ${limit === null || limit > 0 ? h2`<${OutlineMade} made=${{ master: o.master, volumes: limit === null ? o.volumes : o.volumes.filter(v => v.from <= limit) }} mode=${novel.VISIBLE}/>` : h2`<div class="hint-box">还没有写到任何一章，没有可揭晓的内容。</div>`}
      ${o.volumes.filter(v => limit === null || v.from <= limit).map(v => h2`
        <${List} key=${v.no} title=${`第 ${v.no} 卷的章纲`}>
          ${(o.chapters[v.no] || []).length
            ? (o.chapters[v.no] || []).filter(c => limit === null || c.no <= limit).map(c => h2`
                <${ListItem} key=${c.no} title=${`第 ${c.no} 章${c.title ? `　${c.title}` : ''}`} subtitle=${c.line} multiline/>`)
            : h2`<${ListItem} title=${busy === `vol${v.no}` ? '正在生成' : '生成这一卷的章纲'} subtitle="每章一行。调用一次接口" multiline arrow onClick=${busy ? null : () => fill(v)}/>`}
        <//>`)}` : null}`;
}

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

  const add = async () => {
    // 长篇：下一章落在还没生成章纲的那一卷时先问一声（4.263）；有章纲就把题目带上
    const next = list.reduce((n, c) => Math.max(n, c.no || 0), 0) + 1;
    if (saga && novel.hasOutline(w)) {
      const miss = novel.volumeMissing(w, next);
      if (miss && ai.isConfigured()) {
        const go = await confirm({ title: `第 ${miss.no} 卷的章纲还没有生成`, message: '先生成这一卷的章纲（调用一次接口），还是直接开始写这一章。', okText: '先生成', cancelText: '直接写' });
        if (go) {
          try { novel.applyVolume(w.id, miss.no, await ai.novel.volume(work.get(w.id), miss)); }
          catch (e) { toast(String(e.message || e), 'error', 5000); }
        }
      }
    }
    const line = saga ? novel.lineOf(work.get(w.id), next) : null;
    const row = work.addChapter(workId, line ? { title: line.title } : {});
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
        <${List} title=${saga ? '简介' : '设定'}>
          <${ListItem} title=${w.premise} multiline/>
        <//>` : null}
      ${saga && (w.genres || []).length ? html`
        <div class="pad-x"><div class="chip-row">${w.genres.map(t => html`<span key=${t} class="chip">${t}</span>`)}</div></div>` : null}
      ${saga ? html`<${OutlinePanel} w=${w}/>` : null}

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
