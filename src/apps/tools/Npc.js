import { html, useState, useRef, useEffect } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, Button, Icon, Spinner, Segmented,
         NumberInput, EmptyState, toast, confirm, prompt } from '../../ui/index.js';
import { CharPicker, BookPicker, CallNote, copyText, charText, bookText, useToolState,
         loadToolState, PromptPreview, fmtTime } from './common.js';
import { GROUPS, GENERAL, WORLDS, NEGATIVES, FIELDS, FIELD_DEFAULT, GENDERS, DETAIL_GENDERS,
         LENGTHS, FORMATS } from './npcdata.js';

const { db, nav, ai, toolbox } = phone;
const T = ai.tools;

// NPC 生成器。见 ARCHITECTURE 4.247
//
// 「联系」里「关联角色」页那一键生成是简单版（只填个数）；这里是完整的一版，
// 那一页的「更多设置」跳到这里并带上那个角色（/npc/char/<id>）。两边存进去的是同一种行：
// 选了主角就经 card.commitNpcs 连上关系网，没选就各自存成 NPC。
//
// 一次生成就是一次请求。锁定的几个留着，重新生成时告诉模型「这些已经有了」。

const DEF = {
  mainId: '', mainText: '', castIds: [], bookIds: [],
  world: 'custom', customWorlds: [], customTags: {}, tags: {},
  negSel: [], negCustom: [], fields: FIELD_DEFAULT, fieldCustom: [],
  mode: 'simple', count: 3, gender: 'any', genderCustom: '', detail: [],
  length: 'auto', lengthCustom: 400, format: 'natural', note: '',
  result: [], runId: null,
};

const uid = () => Math.random().toString(36).slice(2, 10);

function worldTags(f) {
  const w = [...WORLDS, ...(f.customWorlds || [])].find(x => x.id === f.world) || WORLDS[0];
  return w.tags || GENERAL;
}

const lengthOf = f => (f.length === 'custom' ? Number(f.lengthCustom) || 0
  : LENGTHS.find(x => x.value === f.length)?.n || 0);

/** 一个人的各项拼成人设正文（存进联系人时用） */
export const personaOf = n => Object.entries(n.fields || {})
  .map(([k, v]) => `${k}：${v}`).join('\n');

// ---- 导出成三种格式（本地转换，不调接口）----
const xmlEsc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function asText(n, fmt) {
  const base = [['姓名', n.name], ['性别', n.gender], ['年龄', n.age], ['生日', n.birthday],
    ['签名', n.signature], ['关系', n.relation]].filter(([, v]) => v);
  const all = [...base, ...Object.entries(n.fields || {})];
  if (fmt === 'xml') return `<npc>\n${all.map(([k, v]) => `  <${k}>${xmlEsc(v)}</${k}>`).join('\n')}\n</npc>`;
  if (fmt === 'yaml') return all.map(([k, v], i) => `${i ? '  ' : '- '}${k}: ${JSON.stringify(String(v))}`).join('\n');
  return `【${n.name}】\n${all.slice(1).map(([k, v]) => `${k}：${v}`).join('\n')}`;
}
const joinAll = (list, fmt) => (fmt === 'xml' ? list.map(n => asText(n, 'xml')).join('\n')
  : fmt === 'yaml' ? list.map(n => asText(n, 'yaml')).join('\n')
    : list.map(n => asText(n, 'natural')).join('\n\n---\n\n'));

// 标签一组。自己加的带一个 ×
function TagGroup({ label, tags, custom = [], picked = [], onToggle, onAdd, onRemove, neg }) {
  const [draft, setDraft] = useState('');
  const add = () => { const v = draft.trim(); if (!v) return; onAdd(v); setDraft(''); };
  return html`
    <${Field} label=${label}>
      <div class="chip-row">
        ${[...tags, ...custom.filter(t => !tags.includes(t))].map(t => html`
          <button key=${t} class=${`chip${picked.includes(t) ? ' is-active' : ''}${neg ? ' is-neg' : ''}`}
            onClick=${e => { e.preventDefault(); onToggle(t); }}>
            ${t}
            ${custom.includes(t) ? html`<span class="tb-chip-x" onClick=${e => { e.preventDefault(); e.stopPropagation(); onRemove(t); }}>
              <${Icon} name="close" size=${11}/></span>` : null}
          </button>`)}
      </div>
      <div class="tb-add-row">
        <${Input} value=${draft} placeholder="自定义" onInput=${setDraft}
          onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}/>
        <${Button} size="sm" variant="ghost" onClick=${e => { e?.preventDefault?.(); add(); }}>添加<//>
      </div>
    <//>`;
}

export function NpcPage({ charId = '' }) {
  useStore(db.characters.store);
  useStore(db.lorebooks.store);
  const [f, set, fRef] = useToolState('npc', DEF);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState('');
  const [preview, setPreview] = useState(false);
  const keyRef = useRef('');

  // 从「联系」跳过来：带上那个角色
  useEffect(() => { if (charId && db.characters.get(charId) && f.mainId !== charId) set({ mainId: charId }); }, [charId]);
  useEffect(() => () => { if (keyRef.current) ai.queue.cancel(keyRef.current); }, []);

  const main = db.characters.get(f.mainId);
  const cast = f.castIds.map(id => db.characters.get(id)).filter(Boolean);
  const books = f.bookIds.map(id => db.lorebooks.get(id)).filter(Boolean);
  const wt = worldTags(f);
  const worlds = [...WORLDS, ...(f.customWorlds || [])];
  const world = worlds.find(w => w.id === f.world) || WORLDS[0];
  const fieldsAll = [...FIELDS, ...f.fieldCustom.filter(x => !FIELDS.includes(x))];
  const negAll = [...NEGATIVES, ...f.negCustom.filter(x => !NEGATIVES.includes(x))];
  const result = f.result || [];
  const locked = result.filter(n => n.locked);

  const pickIn = (list, v) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  // ---- 本次提示词 ----
  function input() {
    const req = [];
    if (f.world !== 'custom') req.push(`World type: ${world.name}`);
    if (f.mode === 'simple') {
      GROUPS.forEach(g => {
        const t = f.tags[g.id] || [];
        if (t.length) req.push(`${g.en}: ${t.join('、')}`);
      });
      const gd = GENDERS.find(x => x.value === f.gender);
      if (f.gender === 'custom') { if (f.genderCustom.trim()) req.push(`Gender mix: ${f.genderCustom.trim()}`); }
      else if (gd?.en) req.push(gd.en);
    } else {
      f.detail.forEach((d, i) => {
        const bits = [d.tags.length ? `tags: ${d.tags.join('、')}` : '',
          d.gender && d.gender !== '不指定' ? `gender: ${d.gender}` : '',
          d.note.trim() ? `required: ${d.note.trim()}` : ''].filter(Boolean);
        req.push(`Person ${i + 1}: ${bits.join('; ') || 'free'}`);
      });
    }
    if (f.note.trim()) req.push(`Further notes from the user: ${f.note.trim()}`);
    const existing = [
      ...(main ? ai.card.relationsOf(main.id).map(r => `${db.characters.get(r.charId)?.name || ''} (${r.label})`) : []),
      ...locked.map(n => `${n.name}${n.relation ? ` (${n.relation})` : ''}`),
    ].filter(Boolean).join('\n');
    const castText = cast.map(c => {
      const rel = main ? ai.card.relationsOf(main.id).find(r => r.charId === c.id) : null;
      return `${charText(c)}${rel ? `\nTo the main character: ${rel.label}` : ''}`;
    }).join('\n\n');
    return {
      main: main ? charText(main) : f.mainText,
      cast: castText,
      world: books.map(bookText).join('\n\n'),
      existing,
      requirements: req.map(x => `- ${x}`).join('\n'),
      banned: f.negSel.map(x => `- ${x}`).join('\n'),
      fields: f.fields,
      length: lengthOf(f),
      count: f.mode === 'detail' ? Math.max(1, f.detail.length) : f.count,
    };
  }

  const gen = async () => {
    if (!ai.isConfigured()) { toast('尚未配置聊天接口', 'error', 4000); return; }
    if (f.fields.length < 2) { toast('请至少选择 2 个字段'); return; }
    if (f.mode === 'detail' && !f.detail.length) { toast('请先添加至少一个 NPC 配置'); return; }
    setBusy(true);
    keyRef.current = `tool-npc:${Date.now()}`;
    try {
      const rows = await T.npcGenerate(input(), { key: keyRef.current });
      const fresh = rows.map(n => ({ ...n, id: uid(), locked: false, off: false, saved: '' }));
      const next = [...fRef.current.result.filter(n => n.locked), ...fresh];
      const run = toolbox.addRun('npc', {
        title: `${main ? phone.remark.nameOf(main) : '未绑定主角'} · ${next.length} 个`,
        input: { mainId: f.mainId, world: world.name },
        output: { npcs: next, mainId: f.mainId, format: f.format },
      });
      set({ result: next, runId: run.id });
      toast(`已生成 ${fresh.length} 个`, 'ok');
    } catch (e) {
      if (!ai.queue.isAbort(e)) toast(String(e.message || e), 'error', 6000);
    } finally { setBusy(false); }
  };

  const patchRow = (id, patch) => set(s => ({ result: s.result.map(n => (n.id === id ? { ...n, ...patch } : n)) }));

  const save = () => {
    const keep = result.filter(n => !n.off && !n.saved);
    if (!keep.length) { toast('没有待存入的 NPC'); return; }
    const rows = keep.map(n => ({ ...n, persona: personaOf(n) }));
    let made;
    if (main) made = ai.card.commitNpcs(main.id, rows);
    else made = rows.map(n => toolbox.saveCharacter(n, { npc: true }));
    const ids = new Map(keep.map((n, i) => [n.id, made[i]?.id || '1']));
    set(s => ({ result: s.result.map(n => (ids.has(n.id) ? { ...n, saved: ids.get(n.id) } : n)) }));
    toast(`已存入联系人 ${made.length} 个${main ? `，并关联到 ${phone.remark.nameOf(main)}` : ''}`, 'ok', 3500);
  };

  const clearResult = async () => {
    if (!await confirm({ title: '清空结果', message: '锁定的也一并清空。历史记录中仍保留。', okText: '清空' })) return;
    set({ result: [], runId: null });
  };

  const addWorld = async () => {
    const name = await prompt({ title: '新增世界观类型', placeholder: '例如：科幻、悬疑推理、无限流' });
    if (!name || !name.trim()) return;
    const w = { id: `w${uid()}`, name: name.trim(), tags: JSON.parse(JSON.stringify(GENERAL)) };
    set(s => ({ customWorlds: [...s.customWorlds, w], world: w.id, tags: {} }));
    toast('已新增。标签沿用通用标签，可在下方继续添加', 'ok', 3500);
  };
  const delWorld = async () => {
    if (!await confirm({ title: `删除「${world.name}」`, okText: '删除', danger: true })) return;
    set(s => ({ customWorlds: s.customWorlds.filter(w => w.id !== s.world), world: 'custom', tags: {} }));
  };

  const addDetail = () => set(s => ({ detail: [...s.detail, { id: uid(), tags: [], gender: '不指定', note: '' }] }));
  const patchDetail = (id, patch) => set(s => ({ detail: s.detail.map(d => (d.id === id ? { ...d, ...patch } : d)) }));

  const exportTxt = async () => {
    try { toast(`已导出 ${await toolbox.exportText(`${main?.name || 'NPC'}-NPC合集`, joinAll(result, f.format), 'txt')}`, 'ok'); }
    catch (e) { toast(String(e.message || e), 'error'); }
  };
  const exportZip = async () => {
    try {
      const ext = f.format === 'xml' ? 'xml' : f.format === 'yaml' ? 'yaml' : 'txt';
      toast(`已导出 ${await toolbox.exportZip(`${main?.name || 'NPC'}-NPC`, result.map(n => ({ name: `${n.name}.${ext}`, text: asText(n, f.format) })))}`, 'ok');
    } catch (e) { toast(String(e.message || e), 'error'); }
  };

  const allTags = GROUPS.flatMap(g => [...(wt[g.id] || []), ...(f.customTags[g.id] || [])]);
  const runs = toolbox.runsOf('npc');

  return html`
    <${Page} title="NPC 生成器" onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${() => nav.push('/runs/npc')}>历史</button>`}>
      <${List} title="角色">
        <${ListItem} title="主角" arrow multiline left=${html`<${Icon} name="user" size=${18}/>`}
          subtitle=${main ? `${phone.remark.nameOf(main)}。生成的 NPC 存入时自动与该角色建立关系` : '可选。选定后，NPC 围绕该角色生成，存入时自动关联'}
          onClick=${() => setPicking('main')}/>
        ${main ? html`<${ListItem} title="不绑定主角" left=${html`<${Icon} name="close" size=${18}/>`}
          onClick=${() => set({ mainId: '' })}/>` : null}
        <${ListItem} title="在场角色" arrow multiline left=${html`<${Icon} name="users" size=${18}/>`}
          subtitle=${cast.length ? cast.map(c => phone.remark.nameOf(c)).join('、') : '可选。生成的 NPC 会参考这些角色的背景与关系'}
          onClick=${() => setPicking('cast')}/>
        <${ListItem} title="世界背景" arrow multiline left=${html`<${Icon} name="book" size=${18}/>`}
          subtitle=${books.length ? books.map(b => b.name).join('、') : '可选。选择世界书作为背景设定'}
          onClick=${() => setPicking('books')}/>
      <//>
      ${!main ? html`
        <div class="pad-x">
          <${Field} label="主角设定" desc="未选择主角时，可在此粘贴一段主角设定。可留空。">
            <${Textarea} rows=${4} value=${f.mainText} onInput=${v => set({ mainText: v })}/>
          <//>
        </div>` : null}

      <div class="pad-x">
        <${Field} label="世界观类型" desc="选择一个大类，下方标签切换为该类常用的关系与设定。">
          <div class="chip-row">
            ${worlds.map(w => html`
              <button key=${w.id} class=${`chip${f.world === w.id ? ' is-active' : ''}`}
                onClick=${e => { e.preventDefault(); set({ world: w.id, tags: {} }); }}>${w.name}</button>`)}
            <button class="chip" onClick=${e => { e.preventDefault(); addWorld(); }}>
              <${Icon} name="plus" size=${12}/> 新增类型
            </button>
          </div>
          ${f.customWorlds.some(w => w.id === f.world) ? html`
            <div class="pad-t"><${Button} size="sm" variant="ghost" icon="trash" onClick=${delWorld}>删除该类型<//></div>` : null}
        <//>

        <${Field} label="生成模式">
          <${Segmented} value=${f.mode} onChange=${v => set({ mode: v })}
            items=${[{ value: 'simple', label: '简略：统一选标签' }, { value: 'detail', label: '详细：逐个配置' }]}/>
        <//>
      </div>

      ${f.mode === 'simple' ? html`
        <div class="pad-x">
          ${GROUPS.map(g => html`
            <${TagGroup} key=${g.id} label=${g.label} tags=${wt[g.id] || []}
              custom=${f.customTags[g.id] || []} picked=${f.tags[g.id] || []}
              onToggle=${t => set(s => ({ tags: { ...s.tags, [g.id]: pickIn(s.tags[g.id] || [], t) } }))}
              onAdd=${t => set(s => ({
                customTags: { ...s.customTags, [g.id]: [...new Set([...(s.customTags[g.id] || []), t])] },
                tags: { ...s.tags, [g.id]: [...new Set([...(s.tags[g.id] || []), t])] },
              }))}
              onRemove=${t => set(s => ({
                customTags: { ...s.customTags, [g.id]: (s.customTags[g.id] || []).filter(x => x !== t) },
                tags: { ...s.tags, [g.id]: (s.tags[g.id] || []).filter(x => x !== t) },
              }))}/>`)}
          <${Field} label="生成数量" desc="没有上限。数量越多，这一次请求越长。">
            <${NumberInput} unit="个" min=${1} value=${f.count} onChange=${v => set({ count: v })}/>
          <//>
          <${Field} label="性别配置">
            <div class="chip-row">
              ${GENDERS.map(g => html`
                <button key=${g.value} class=${`chip${f.gender === g.value ? ' is-active' : ''}`}
                  onClick=${e => { e.preventDefault(); set({ gender: g.value }); }}>${g.label}</button>`)}
            </div>
            ${f.gender === 'custom' ? html`
              <div class="pad-t"><${Input} value=${f.genderCustom} placeholder="例如：2 男 1 女"
                onInput=${v => set({ genderCustom: v })}/></div>` : null}
          <//>
        </div>`
      : html`
        <div class="pad-x">
          ${f.detail.map((d, i) => html`
            <div key=${d.id} class="tb-detail">
              <div class="tb-detail-head">
                <span>NPC ${i + 1}</span>
                <button class="press li-cut" onClick=${() => set(s => ({ detail: s.detail.filter(x => x.id !== d.id) }))}>
                  <${Icon} name="close" size=${15}/>
                </button>
              </div>
              <div class="chip-row">
                ${allTags.filter((t, j) => allTags.indexOf(t) === j).map(t => html`
                  <button key=${t} class=${`chip${d.tags.includes(t) ? ' is-active' : ''}`}
                    onClick=${e => { e.preventDefault(); patchDetail(d.id, { tags: pickIn(d.tags, t) }); }}>${t}</button>`)}
              </div>
              <div class="chip-row">
                ${DETAIL_GENDERS.map(g => html`
                  <button key=${g} class=${`chip${d.gender === g ? ' is-active' : ''}`}
                    onClick=${e => { e.preventDefault(); patchDetail(d.id, { gender: g }); }}>${g}</button>`)}
              </div>
              <div class="pad-t">
                <${Input} value=${d.note} placeholder="补充说明，例如：主角的老师，严肃但内心柔软"
                  onInput=${v => patchDetail(d.id, { note: v })}/>
              </div>
            </div>`)}
          <${Button} full variant="ghost" icon="plus" onClick=${addDetail}>添加一个 NPC 配置<//>
        </div>`}

      <div class="pad-x pad-t">
        <${TagGroup} neg label="禁止项" tags=${NEGATIVES} custom=${f.negCustom} picked=${f.negSel}
          onToggle=${t => set(s => ({ negSel: pickIn(s.negSel, t) }))}
          onAdd=${t => set(s => ({ negCustom: [...new Set([...s.negCustom, t])], negSel: [...new Set([...s.negSel, t])] }))}
          onRemove=${t => set(s => ({ negCustom: s.negCustom.filter(x => x !== t), negSel: s.negSel.filter(x => x !== t) }))}/>
        <div class="field-desc tb-neg-desc">勾选的内容不会出现在任何一个 NPC 中。默认不勾选任何一项。</div>

        <${TagGroup} label="包含字段（至少 2 个）" tags=${FIELDS} custom=${f.fieldCustom} picked=${f.fields}
          onToggle=${t => set(s => ({ fields: pickIn(s.fields, t) }))}
          onAdd=${t => set(s => ({ fieldCustom: [...new Set([...s.fieldCustom, t])], fields: [...new Set([...s.fields, t])] }))}
          onRemove=${t => set(s => ({ fieldCustom: s.fieldCustom.filter(x => x !== t), fields: s.fields.filter(x => x !== t) }))}/>
        <div class="field-desc tb-neg-desc">姓名、性别、年龄、生日、一句话签名与关系始终包含。</div>

        <${Field} label="单个 NPC 的篇幅">
          <${Segmented} value=${f.length} onChange=${v => set({ length: v })}
            items=${LENGTHS.map(x => ({ value: x.value, label: x.label }))}/>
          ${f.length === 'custom' ? html`
            <div class="pad-t"><${NumberInput} unit="字" min=${1} value=${f.lengthCustom} onChange=${v => set({ lengthCustom: v })}/></div>` : null}
        <//>
        <${Field} label="补充要求" desc="可留空。">
          <${Textarea} rows=${3} value=${f.note} onInput=${v => set({ note: v })}/>
        <//>
      </div>

      <div class="pad">
        ${busy ? html`
          <${Button} full variant="ghost" onClick=${() => ai.queue.cancel(keyRef.current)}><${Spinner} size=${15}/> 正在生成，点此停止<//>`
          : html`<${Button} full onClick=${gen}>${locked.length ? `重新生成（保留锁定的 ${locked.length} 个）` : '生成'}<//>`}
        <${CallNote}/>
        <div class="pad-t"><${Button} full size="sm" variant="outline" onClick=${() => setPreview(true)}>查看本次提示词<//></div>
      </div>

      ${result.length ? html`
        <${List} title=${`结果 · ${result.length} 个`}><//>
        ${result.map(n => html`
          <div key=${n.id} class=${`tb-npc${n.off ? ' is-off' : ''}`}>
            <div class="tb-npc-head">
              <div class="tb-npc-name">${n.name}${n.relation ? html`<span class="tb-npc-rel">${n.relation}</span>` : null}</div>
              <button class=${`tb-npc-btn press${n.locked ? ' is-active' : ''}`} aria-label="锁定"
                onClick=${() => patchRow(n.id, { locked: !n.locked })}><${Icon} name="lock" size=${14}/></button>
              <button class="tb-npc-btn press" aria-label="复制" onClick=${() => copyText(asText(n, f.format))}>
                <${Icon} name="copy" size=${14}/></button>
              <button class=${`tb-npc-btn press${!n.off ? ' is-active' : ''}`} aria-label="存入"
                onClick=${() => patchRow(n.id, { off: !n.off })}><${Icon} name=${n.off ? 'close' : 'check'} size=${14}/></button>
            </div>
            <div class="tb-npc-meta">${[n.gender, n.age, n.birthday].filter(Boolean).join(' · ')}${n.saved ? ' · 已存入联系人' : ''}</div>
            ${n.signature ? html`<div class="tb-npc-meta">${n.signature}</div>` : null}
            <div class="tb-npc-body">${personaOf(n)}</div>
          </div>`)}
        <div class="pad">
          <div class="hint-box">锁定的 NPC 在重新生成时保留，并告知模型不要重复。取消勾选的不会存入。</div>
          <${Button} full onClick=${save}>存入联系人（${result.filter(n => !n.off && !n.saved).length} 个）<//>
          <${Field} label="导出格式">
            <${Segmented} value=${f.format} onChange=${v => set({ format: v })} items=${FORMATS}/>
          <//>
          <div class="btn-row">
            <${Button} variant="ghost" onClick=${() => copyText(joinAll(result, f.format))}>合并复制<//>
            <${Button} variant="ghost" onClick=${exportTxt}>合并 TXT<//>
            <${Button} variant="ghost" onClick=${exportZip}>ZIP 拆分包<//>
          </div>
          <div class="pad-t"><${Button} full size="sm" variant="outline" onClick=${clearResult}>清空结果<//></div>
        </div>` : null}

      ${runs.length ? html`
        <${List}>
          <${ListItem} title="历史记录" right=${String(runs.length)} arrow
            left=${html`<${Icon} name="clock" size=${18}/>`} onClick=${() => nav.push('/runs/npc')}/>
        <//>` : null}

      <${CharPicker} open=${picking === 'main'} title="选择主角" exclude=${f.castIds}
        onClose=${() => setPicking('')} onPick=${c => set({ mainId: c.id })}/>
      <${CharPicker} multi open=${picking === 'cast'} title="在场角色" picked=${f.castIds} exclude=${f.mainId ? [f.mainId] : []}
        onClose=${() => setPicking('')} onPick=${ids => set({ castIds: ids })}/>
      <${BookPicker} multi open=${picking === 'books'} title="世界背景" picked=${f.bookIds}
        onClose=${() => setPicking('')} onPick=${ids => set({ bookIds: ids })}/>
      <${PromptPreview} open=${preview} onClose=${() => setPreview(false)}
        text=${preview ? T.npcSystem(input()) : ''} templateId="task.npc-tool"/>
    <//>`;
}

// 历史里的一批
export function NpcRunView({ id }) {
  useStore(db.toolRuns.store);
  const r = toolbox.getRun(id);
  if (!r) return html`<${Page} title="历史记录" onBack=${nav.pop}><${EmptyState} icon="clock" title="该记录已被删除"/><//>`;
  const list = r.output?.npcs || [];
  const fmt = r.output?.format || 'natural';
  const load = () => {
    loadToolState('npc', { ...DEF, ...toolbox.stateOf('npc'), result: list, runId: r.id, mainId: r.output?.mainId || '' });
    nav.popToRoot(); nav.push('/npc');
  };
  const del = async () => {
    if (!await confirm({ title: '删除这条记录', okText: '删除', danger: true })) return;
    toolbox.removeRun(r.id); nav.pop();
  };
  return html`
    <${Page} title=${r.title || 'NPC'} onBack=${nav.pop}>
      <div class="pad"><div class="tb-call">${fmtTime(r.createdAt)}</div></div>
      ${list.map(n => html`
        <div key=${n.id || n.name} class="tb-npc">
          <div class="tb-npc-head"><div class="tb-npc-name">${n.name}${n.relation ? html`<span class="tb-npc-rel">${n.relation}</span>` : null}</div></div>
          <div class="tb-npc-meta">${[n.gender, n.age, n.birthday].filter(Boolean).join(' · ')}</div>
          <div class="tb-npc-body">${personaOf(n)}</div>
        </div>`)}
      <${List}>
        <${ListItem} title="载入到 NPC 生成器" subtitle="载入后可继续锁定、重新生成或存入联系人" multiline arrow
          left=${html`<${Icon} name="undo" size=${18}/>`} onClick=${load}/>
        <${ListItem} title="合并复制" left=${html`<${Icon} name="copy" size=${18}/>`} onClick=${() => copyText(joinAll(list, fmt))}/>
        <${ListItem} title="删除这条记录" danger left=${html`<${Icon} name="trash" size=${18}/>`} onClick=${del}/>
      <//>
    <//>`;
}
