import { html, useState } from '../../../lib.js';
import { phone, useStore } from '../../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, Segmented, Switch, NumberInput, Button,
         Spinner, Sheet, toast, IdentityFields } from '../../../ui/index.js';
import { ChatPick, CastPick, WorkSwitches, TonePick } from './Bits.js';

const { db, nav, work, ai, novel, toolbox, tone } = phone;

// 长篇向导（ARCHITECTURE 4.263）。一页从上往下：标题、人物、体裁标签、篇幅、世界观、灵感与简介、大纲、写法。
// 调接口的只有两处，各自按钮下写明次数：「生成简介」一次；「生成大纲」章数少时一次，多时总纲卷纲一次、各卷章纲写到时再要。
// 每一步都能跳过：什么都不生成也能建。

const blank = () => ({
  title: '', from: 'chat', chatId: '', castIds: [], carry: false, solo: false, opening: 'char',
  genres: [], lengthId: 'mid', chapters: 24, perChapter: 3500, lorebookIds: [],
  inspiration: '', premise: '', secret: '', outlineMode: novel.NONE, made: null, tones: [], toneText: '',
  // 这个世界里的身份（4.283）。留空沿用角色卡与账号资料
  charName: '', charPersona: '', meName: '', mePersona: '',
});

// 自己加的标签存在 settings.novelTags：{ 类: [标签] }
const customOf = () => db.settings.get().novelTags || {};

/** 表单先当成一部作品用：生成简介、大纲的那几次请求读的就是作品上的字段 */
export function draftOf(v, id = 'draft') {
  return {
    id, kind: work.SAGA, title: v.title, premise: v.premise, secret: v.secret, inspiration: v.inspiration,
    chatId: v.from === 'cast' ? '' : v.chatId,
    castIds: v.from === 'cast' ? v.castIds : (db.chats.get(v.chatId)?.characterIds || []),
    charAs: null, meAs: null, solo: v.solo, genres: v.genres,
    length: { chapters: v.chapters, perChapter: v.perChapter }, lorebookIds: v.lorebookIds,
    outline: v.made ? { ...novel.blankOutline(v.outlineMode), master: v.made.master, volumes: v.made.volumes } : null,
  };
}

export function TagPick({ value, onChange }) {
  useStore(db.settings.store);
  const [adding, setAdding] = useState({});
  const custom = customOf();
  const on = t => value.includes(t);
  const flip = t => onChange(on(t) ? value.filter(x => x !== t) : [...value, t]);
  const add = cat => {
    const t = String(adding[cat] || '').trim();
    if (!t) return;
    const cur = customOf();
    if (!(cur[cat] || []).includes(t)) db.settings.set({ novelTags: { ...cur, [cat]: [...(cur[cat] || []), t] } });
    if (!on(t)) onChange([...value, t]);
    setAdding(a => ({ ...a, [cat]: '' }));
  };
  return html`
    ${novel.NOVEL_TAGS.map(c => html`
      <${Field} key=${c.id} label=${c.label}>
        <div class="chip-row">
          ${[...c.tags, ...((custom[c.id] || []).filter(t => !c.tags.includes(t)))].map(t => html`
            <button key=${t} class=${`chip press${on(t) ? ' is-active' : ''}`} onClick=${() => flip(t)}>${t}</button>`)}
        </div>
        <div class="nv-add">
          <${Input} value=${adding[c.id] || ''} placeholder="添加标签" onInput=${x => setAdding(a => ({ ...a, [c.id]: x }))}/>
          <${Button} size="sm" variant="ghost" onClick=${() => add(c.id)}>添加<//>
        </div>
      <//>`)}`;
}

export function LengthPick({ v, set }) {
  return html`
    <${Field} label="篇幅" desc="选档只是填入默认值，章数与每章字数都可以改。填 0 表示不固定。">
      <${Segmented} value=${v.lengthId} items=${novel.LENGTHS.map(l => ({ value: l.id, label: l.label }))}
        onChange=${id => { const l = novel.LENGTHS.find(x => x.id === id); set({ lengthId: id, chapters: l.chapters, perChapter: l.perChapter }); }}/>
    <//>
    <div class="nv-two">
      <${Field} label="预计章数"><${NumberInput} unit="章" value=${v.chapters} placeholder="不固定" onChange=${x => set({ chapters: x })}/><//>
      <${Field} label="每章字数"><${NumberInput} unit="字" value=${v.perChapter} placeholder="不固定" onChange=${x => set({ perChapter: x })}/><//>
    </div>`;
}

export function BookPick({ value, onChange }) {
  useStore(db.lorebooks.store);
  useStore(db.toolRuns.store);
  const [picking, setPicking] = useState(false);
  const books = db.lorebooks.all().filter(b => (b.entries || []).some(e => e.type !== 'card'));
  const flip = id => onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
  // 世界观生成器生成过的那几份（4.265）：挑一份就成一本书挂上；同一份只建一本
  const runs = toolbox.runsOf('world').filter(novel.usable);
  const fromRun = run => {
    try {
      const id = novel.bookFromWorld({ name: run.input?.name || run.title, modules: run.output?.modules, runId: run.id });
      if (!value.includes(id)) onChange([...value, id]);
      toast('已挂上这份世界观', 'ok');
    } catch (e) { toast(String(e.message || e), 'error'); }
    setPicking(false);
  };
  return html`
    <${List} title="世界观">
      ${books.map(b => html`
        <${ListItem} key=${b.id} title=${b.name} subtitle=${`${(b.entries || []).length} 个条目`}
          right=${html`<${Switch} checked=${value.includes(b.id)} onChange=${() => flip(b.id)}/>`} onClick=${() => flip(b.id)}/>`)}
      ${books.length ? null : html`<${ListItem} title="还没有世界书" subtitle="可在工具箱的世界观生成器中生成后存为世界书" multiline/>`}
      <${ListItem} title="从世界观生成器导入" subtitle=${runs.length ? `${runs.length} 份可选` : '还没有生成过世界观'} arrow multiline onClick=${() => setPicking(true)}/>
    <//>
    <${Sheet} open=${picking} onClose=${() => setPicking(false)} title="选一份世界观" height="70%">
      <${List} inset=${false}>
        ${runs.map(r => html`
          <${ListItem} key=${r.id} title=${r.input?.name || r.title || '未命名世界观'} arrow multiline
            subtitle=${`${Object.values(r.output?.modules || {}).filter(t => String(t || '').trim()).length} 个模块${r.bookId && db.lorebooks.has(r.bookId) ? ' · 已有对应的世界书' : ''}`}
            onClick=${() => fromRun(r)}/>`)}
        ${runs.length ? null : html`<${ListItem} title="还没有生成过世界观" subtitle="先在工具箱的世界观生成器里生成一份" multiline/>`}
      <//>
    <//>`;
}

/** 大纲那一节：选档、生成、看结果。向导与作品页共用 */
export function OutlineMade({ made, mode, hideLines = false }) {
  if (!made) return null;
  const lines = novel.masterLines(made.master);
  const vols = made.volumes || [];
  if (mode === novel.HIDDEN && hideLines) {
    return html`<div class="hint-box">大纲已生成：${vols.length} 卷。按设置不显示内容，写作时使用。</div>`;
  }
  return html`
    <${List} title="总纲">
      ${lines.map((l, i) => html`<${ListItem} key=${i} title=${l} multiline/>`)}
    <//>
    <${List} title=${`卷 · ${vols.length}`}>
      ${vols.map(vv => html`
        <${ListItem} key=${vv.no} title=${`第 ${vv.no} 卷${vv.title ? `　${vv.title}` : ''}`} multiline
          subtitle=${`第 ${vv.from} 到 ${vv.to} 章 · ${vv.goal}${vv.reveal ? ` · 揭晓：${vv.reveal}` : ''}`}/>`)}
    <//>`;
}

export function NewSaga({ chatId = '', bookId = '' }) {
  useStore(db.settings.store);
  // 带着世界书进来（世界观生成器「用它开一部长篇」）：书先挂上，人物直接选
  const [v, setV] = useState({ ...blank(), chatId, from: bookId ? 'cast' : 'chat', tones: tone.asTones(db.settings.get().workToneLast),
    lorebookIds: bookId && db.lorebooks.has(bookId) ? [bookId] : [] });
  const [busy, setBusy] = useState('');
  const set = patch => setV(x => ({ ...x, ...patch }));
  const alone = v.from === 'cast';
  const hasCast = alone ? v.castIds.length > 0 : !!v.chatId;
  const ready = ai.isConfigured();

  const run = async (what, fn) => {
    if (!hasCast) { toast('请先选择人物', 'error'); return; }
    if (!ready) { toast('尚未配置接口', 'error'); return; }
    setBusy(what);
    try { await fn(); } catch (e) { toast(String(e.message || e), 'error', 5000); } finally { setBusy(''); }
  };
  const makeSynopsis = () => run('synopsis', async () => {
    const r = await ai.novel.synopsis(draftOf(v), { hidden: v.outlineMode === novel.HIDDEN });
    set({ premise: r.synopsis || v.premise, title: v.title || r.title, secret: r.secret || v.secret });
    toast('简介已生成，可以修改', 'ok');
  });
  const makeOutline = () => run('outline', async () => {
    if (!v.premise.trim()) throw new Error('请先写一段简介，或先生成简介');
    const made = await ai.novel.outline(draftOf(v));
    set({ made });
    toast('大纲已生成', 'ok');
  });
  const outlineCalls = v.chapters > 0 && v.chapters <= novel.ONE_SHOT_CHAPTERS ? '调用一次接口'
    : '调用一次接口生成总纲与卷纲；各卷的章纲在写到那一卷时再生成，每卷调用一次';

  const create = () => {
    if (!hasCast) { toast(alone ? '请先选择人物' : '请先选择和谁', 'error'); return; }
    let row;
    try {
      row = work.create({
        chatId: alone ? '' : v.chatId, castIds: alone ? v.castIds : [], kind: work.SAGA,
        title: v.title, premise: v.premise, carry: alone ? false : v.carry, solo: v.solo, opening: v.opening,
        tones: v.tones, toneText: v.toneText,
        charAs: v.charName || v.charPersona ? { name: v.charName, persona: v.charPersona } : null,
        meAs: v.meName || v.mePersona ? { name: v.meName, persona: v.mePersona } : null,
        genres: v.genres, length: { chapters: v.chapters, perChapter: v.perChapter }, lorebookIds: v.lorebookIds,
        inspiration: v.inspiration, secret: v.secret,
        outline: v.outlineMode === novel.NONE ? novel.blankOutline(novel.NONE) : null,
      });
      if (v.made && v.outlineMode !== novel.NONE) {
        novel.setOutline(row.id, { mode: v.outlineMode });
        novel.applyOutline(row.id, v.made);
      } else if (v.outlineMode !== novel.NONE) novel.setOutline(row.id, { mode: v.outlineMode });
    } catch (e) { toast(String(e.message || e), 'error'); return; }
    nav.replace ? nav.replace(`/work/${row.id}`) : nav.push(`/work/${row.id}`);
  };

  return html`
    <${Page} title="新建长篇" onBack=${nav.pop}
      right=${html`<${Button} size="sm" onClick=${create}>建立<//>`}>
      <div class="pad">
        <${Field} label="标题"><${Input} value=${v.title} placeholder="可以先空着，生成简介时一并给出" onInput=${x => set({ title: x })}/><//>
        ${chatId ? null : html`
          <${Field} label="人物来源"
            desc=${alone ? '直接从联系里选人物，不挂在任何会话上，因此没有「带上原来的记忆」。' : '挂在一段会话上，可以带上那段关系的记忆。'}>
            <${Segmented} value=${v.from} onChange=${x => set({ from: x })}
              items=${[{ value: 'chat', label: '一段会话' }, { value: 'cast', label: '直接选人物' }]}/>
          <//>`}
      </div>
      ${chatId ? null : (alone
        ? html`<${CastPick} value=${v.castIds} onChange=${x => set({ castIds: x })}/>`
        : html`<${ChatPick} value=${v.chatId} onChange=${x => set({ chatId: x })}/>`)}

      <${List} title="体裁与标签"/>
      <div class="pad-x pad-b">
        <${TagPick} value=${v.genres} onChange=${x => set({ genres: x })}/>
        <${LengthPick} v=${v} set=${set}/>
      </div>

      <${BookPick} value=${v.lorebookIds} onChange=${x => set({ lorebookIds: x })}/>

      <${List} title="灵感与简介"/>
      <div class="pad-x pad-b">
        <${Field} label="灵感" desc="想写什么都可以记在这里：一个场景、一句话、一个关系。生成简介与大纲时会参考。">
          <${Textarea} rows=${3} value=${v.inspiration} onInput=${x => set({ inspiration: x })}/>
        <//>
        <${Field} label="简介" desc="读者看到的那一段：世界、人物、开局与悬念。每一章都会带上它。">
          <${Textarea} rows=${6} value=${v.premise} onInput=${x => set({ premise: x })}/>
        <//>
        <${Button} full variant="ghost" disabled=${!!busy} onClick=${makeSynopsis}>
          ${busy === 'synopsis' ? html`<${Spinner} size=${14}/>` : '生成简介'}
        <//>
        <div class="field-desc pad-t">按人设、世界观、体裁、篇幅与灵感生成标题与简介，调用一次接口。生成后可以修改。${v.outlineMode === novel.HIDDEN ? '大纲设为隐藏时，一并生成一份含谜底的作者私纲，不显示。' : ''}</div>
      </div>

      <${List} title="大纲"/>
      <div class="pad-x pad-b">
        <${Field} label="大纲" desc=${(novel.MODES.find(m => m.id === v.outlineMode) || {}).desc || ''}>
          <${Segmented} value=${v.outlineMode} onChange=${x => set({ outlineMode: x })}
            items=${novel.MODES.map(m => ({ value: m.id, label: m.label }))}/>
        <//>
        ${v.outlineMode === novel.NONE ? null : html`
          <${Button} full variant="ghost" disabled=${!!busy} onClick=${makeOutline}>
            ${busy === 'outline' ? html`<${Spinner} size=${14}/>` : (v.made ? '重新生成大纲' : '生成大纲')}
          <//>
          <div class="field-desc pad-t">${outlineCalls}。也可以先建立，之后在作品页生成。</div>`}
      </div>
      ${v.outlineMode === novel.NONE ? null : html`<${OutlineMade} made=${v.made} mode=${v.outlineMode} hideLines=${true}/>`}

      <${List} title="这个世界里的身份"/>
      <div class="pad-x pad-b">
        <div class="field-desc pad-b">古代、异世界一类的设定里，角色卡上的职业、出身、物件多半对不上。可以按这个世界改写一份，只在这部作品里生效。</div>
        <${IdentityFields} who="char" name=${v.charName} persona=${v.charPersona}
          onChange=${p => set({ ...(p.name !== undefined ? { charName: p.name } : {}), ...(p.persona !== undefined ? { charPersona: p.persona } : {}) })}
          canGenerate=${hasCast && ready}
          onGenerate=${() => ai.novel.identity(draftOf(v), { who: 'char' })}/>
        <${IdentityFields} who="me" name=${v.meName} persona=${v.mePersona}
          onChange=${p => set({ ...(p.name !== undefined ? { meName: p.name } : {}), ...(p.persona !== undefined ? { mePersona: p.persona } : {}) })}
          canGenerate=${hasCast && ready}
          onGenerate=${() => ai.novel.identity(draftOf(v), { who: 'me' })}/>
      </div>

      <${WorkSwitches} v=${v} set=${set} kind=${work.SAGA} alone=${alone}/>
      <${TonePick} value=${tone.idsOf(v)} text=${v.toneText} onChange=${patch => set(patch)}/>
      <div class="settings-foot">建立后仍可在作品页修改简介、大纲与写法。</div>
    <//>`;
}
