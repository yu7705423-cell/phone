import { html, useState, useRef, useEffect } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, Button, Icon, Spinner, Switch,
         Segmented, NumberInput, Sheet, toast, confirm, prompt } from '../../ui/index.js';
import { CharPicker, BookPicker, CallNote, copyText, charText, bookText, useToolState,
         loadToolState } from './common.js';
import { WORLD_TAGS } from './worlddata.js';

const { db, nav, ai, toolbox, lorefile } = phone;
const T = ai.tools;

// 世界观生成器。九个模块，写完存成一本世界书。见 ARCHITECTURE 4.247
//
// 拆法来自用户：世界观 = 这个世界是什么样 + 为什么会这样 + 人在里面怎么生活。
// 每一条都要能回答「这个设定会怎样改变人物今天的行为？」—— 这句写进了任务模板。
//
// 两种写法：一次写完（一次请求），逐个模块写（勾了几块就几次，每块都能看到前面写好的）。
// 按钮下面写明这一下调几次。

const DESC = {
  basis: '时代、地理、社会形态、科技或魔法水平、超自然规则，以及与现实世界的差异。',
  history: '影响当前世界的重要历史事件，以及它们留下的制度、冲突和社会影响。只写会影响现在的部分。',
  society: '政治、法律、经济、教育、医疗、交通、媒体、职业与日常生活。普通人每天如何生活。',
  culture: '价值观、礼仪、家庭观念、爱情观、宗教、节日、禁忌、审美、语言习惯。',
  power: '政府、组织、阶层、利益集团，以及资源与权力如何分配。',
  resources: '稀缺且重要的资源，以及谁掌握、谁需要、谁因此获利、谁因此受限。',
  rules: '超自然、科技或其他特殊机制的运行方式、限制、代价与边界。',
  people: '主要人物的社会身份、生活环境、资源条件，以及与这个世界的关系。',
  texture: '不推动主线、却让人觉得此处确实有人生活的细节。',
};

const ALL = T.WORLD_MODULES.map(m => m.id);
const DEF = {
  name: '', premise: '', notes: '', on: ALL, notesBy: {}, tags: {}, peopleIds: [], bookIds: [],
  length: 0, mode: 'all', result: null, runId: null,
};

// 每个模块下的标签（用户要求：每一类都要很多标签、自己选、能批量生成）。
// 默认的一批在 worlddata.js；自己加的与生成的存 'world-tags'：{ custom: { 模块: { 小类: [标签] } } }。
// 单独一份设置，理由同番外的语义词典：批量生成的面板开着时，表单那一份还在随手存
const poolState = () => ({ custom: {}, ...toolbox.stateOf('world-tags') });
const customOf = (mod, grp) => poolState().custom?.[mod]?.[grp] || [];
function addToPool(mod, grp, list) {
  const cur = poolState();
  const m = { ...(cur.custom[mod] || {}) };
  m[grp] = [...new Set([...(m[grp] || []), ...list])];
  toolbox.setState('world-tags', { ...cur, custom: { ...cur.custom, [mod]: m } });
}
function dropFromPool(mod, grp, tag) {
  const cur = poolState();
  const m = { ...(cur.custom[mod] || {}) };
  m[grp] = (m[grp] || []).filter(x => x !== tag);
  toolbox.setState('world-tags', { ...cur, custom: { ...cur.custom, [mod]: m } });
}

/** 一个模块选中的标签，写成交给模型的几行：「小类：甲、乙」 */
function picksOf(f, mod) {
  return (WORLD_TAGS[mod] || []).map(g => {
    const t = f.tags?.[mod]?.[g.id] || [];
    return t.length ? `${g.label}：${t.join('、')}` : '';
  }).filter(Boolean).join('\n');
}
const pickCount = (f, mod) => Object.values(f.tags?.[mod] || {}).reduce((n, l) => n + (l || []).length, 0);

const titleOf = id => T.WORLD_MODULES.find(m => m.id === id)?.title || id;

/** 写好的几块拼成一整篇，按模块顺序 */
function joinWorld(name, modules) {
  const body = ALL.filter(id => String(modules?.[id] || '').trim())
    .map(id => `## ${titleOf(id)}\n${modules[id].trim()}`).join('\n\n');
  return name ? `# ${name}\n\n${body}` : body;
}

export function WorldPage() {
  useStore(db.characters.store);
  useStore(db.lorebooks.store);
  const [f, set, fRef] = useToolState('world', DEF);
  const [busy, setBusy] = useState('');       // '' | 'all' | 模块 id
  useStore(db.tools.store);
  const [openMod, setOpenMod] = useState('');  // 展开的是哪一块
  const [adding, setAdding] = useState({});    // 每个小类的自定义输入
  const [gen, setGen] = useState(null);        // 批量生成标签：{ mod, grp, theme, count, rows, off, pick }
  const [editOf, setEditOf] = useState('');   // 正在改哪一块的结果
  const [editText, setEditText] = useState('');
  const [picking, setPicking] = useState('');  // 'people' | 'books'
  const keyRef = useRef('');
  const stopRef = useRef(false);
  useEffect(() => () => { if (keyRef.current) ai.queue.cancel(keyRef.current); }, []);

  const on = ALL.filter(id => f.on.includes(id));
  const calls = f.mode === 'each' ? on.length : 1;
  const modules = f.result?.modules || {};
  const hasResult = ALL.some(id => String(modules[id] || '').trim());

  const people = f.peopleIds.map(id => db.characters.get(id)).filter(Boolean);
  const books = f.bookIds.map(id => db.lorebooks.get(id)).filter(Boolean);

  const input = () => ({
    premise: f.premise, notes: f.notes, length: f.length,
    existing: books.map(bookText).join('\n\n'),
    people: people.map(charText).join('\n\n'),
  });

  // 结果写回，同时存进历史（同一次生成只占一条，后面的改动改这一条）
  const commit = (mods, patch = {}) => {
    const cur = fRef.current;
    const text = joinWorld(cur.name, mods);
    let runId = cur.runId;
    const out = { text, modules: mods };
    if (runId && toolbox.getRun(runId)) toolbox.updateRun(runId, { output: out, title: cur.name || cur.premise.slice(0, 24) });
    else runId = toolbox.addRun('world', { title: cur.name || cur.premise.slice(0, 24) || '未命名世界观', input: { ...cur, result: null, runId: null, loadNo: undefined }, output: out }).id;
    set({ result: { modules: mods }, runId, ...patch });
  };

  const run = async () => {
    if (!ai.isConfigured()) { toast('尚未配置聊天接口', 'error', 4000); return; }
    if (!on.length) { toast('尚未勾选任何模块'); return; }
    if (!f.premise.trim() && !f.notes.trim() && !on.some(id => (f.notesBy[id] || '').trim() || pickCount(f, id))) {
      toast('请至少填写核心设定，或在某个模块中选择标签、填写想法'); return;
    }
    if (hasResult && !await confirm({ title: '重新生成', message: '当前的结果将被新结果替换。之前的结果仍保存在历史记录中。', okText: '生成' })) return;
    stopRef.current = false;
    set({ runId: null });
    fRef.current = { ...fRef.current, runId: null };
    if (f.mode === 'each') {
      const done = {};
      for (const id of on) {
        if (stopRef.current) break;
        setBusy(id);
        keyRef.current = `tool-world-${id}:${Date.now()}`;
        try {
          const context = [input().existing, f.premise ? `Core premise: ${f.premise}` : '', f.notes, joinWorld('', done)]
            .filter(Boolean).join('\n\n');
          const ideas = [(f.notesBy[id] || '').trim(), id === 'people' ? input().people : ''].filter(Boolean).join('\n\n');
          done[id] = await T.worldModule({ id, worldText: context, instruction: ideas, picks: picksOf(f, id), length: f.length }, { key: keyRef.current });
          commit({ ...done });
        } catch (e) {
          if (!ai.queue.isAbort(e)) toast(`「${titleOf(id)}」生成失败：${e.message || e}`, 'error', 6000);
          break;
        }
      }
      setBusy('');
      return;
    }
    setBusy('all');
    keyRef.current = `tool-world:${Date.now()}`;
    try {
      const got = await T.worldBuild({ ...input(), modules: on.map(id => ({ id, note: f.notesBy[id] || '', picks: picksOf(f, id) })) }, { key: keyRef.current });
      commit(got);
      const miss = on.filter(id => !got[id]);
      if (miss.length) toast(`以下模块未写出：${miss.map(titleOf).join('、')}。可单独重写`, 'plain', 5000);
    } catch (e) {
      if (!ai.queue.isAbort(e)) toast(String(e.message || e), 'error', 6000);
    } finally { setBusy(''); }
  };

  const stop = () => { stopRef.current = true; ai.queue.cancel(keyRef.current); };

  const rewrite = async id => {
    if (!ai.isConfigured()) { toast('尚未配置聊天接口', 'error', 4000); return; }
    const ask = await prompt({ title: `重写「${titleOf(id)}」`, multiline: true, okText: '重写',
      message: '可填写这一次的要求，留空则按原有设定重写。调用一次接口。' });
    if (ask === null) return;
    setBusy(id);
    keyRef.current = `tool-world-${id}:${Date.now()}`;
    try {
      const others = { ...modules };
      const worldText = [f.premise ? `Core premise: ${f.premise}` : '', joinWorld(f.name, others)].filter(Boolean).join('\n\n');
      const text = await T.worldModule({ id, worldText, instruction: [ask, f.notesBy[id]].filter(s => String(s || '').trim()).join('\n\n'), picks: picksOf(f, id), length: f.length }, { key: keyRef.current });
      commit({ ...modules, [id]: text });
      toast('已重写', 'ok');
    } catch (e) {
      if (!ai.queue.isAbort(e)) toast(String(e.message || e), 'error', 6000);
    } finally { setBusy(''); }
  };

  const saveBook = () => {
    const text = joinWorld(f.name || '未命名世界观', modules);
    lorefile.setPending({ drafts: [lorefile.draftFromText(text, f.name || '未命名世界观', '世界观生成器')] });
    phone.intent.open('lorebook', { route: '/import', back: true });
  };

  // 用这份世界观开一部长篇（4.265）：先成一本书（同一份只建一本），带着书跳进长篇向导
  const startSaga = () => {
    try {
      const id = phone.novel.bookFromWorld({ name: f.name || '未命名世界观', modules, runId: f.runId || '' });
      phone.intent.open('us', { route: `/new/book/${id}`, back: true });
    } catch (e) { toast(String(e.message || e), 'error'); }
  };

  const exportAs = async fmt => {
    try { toast(`已导出 ${await toolbox.exportText(`世界观-${f.name || '未命名'}`, joinWorld(f.name, modules), fmt)}`, 'ok'); }
    catch (e) { toast(String(e.message || e), 'error'); }
  };

  const toggle = id => set(s => ({ on: s.on.includes(id) ? s.on.filter(x => x !== id) : ALL.filter(x => x === id || s.on.includes(x)) }));

  // ---- 标签 ----
  const picked = (mod, grp) => f.tags?.[mod]?.[grp] || [];
  const setPicked = (mod, grp, list) => set(s => ({ tags: { ...s.tags, [mod]: { ...(s.tags?.[mod] || {}), [grp]: list } } }));
  const toggleTag = (mod, grp, t) => {
    const cur = picked(mod, grp);
    setPicked(mod, grp, cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t]);
  };
  const addTag = (mod, grp) => {
    const k = `${mod}.${grp}`;
    const t = String(adding[k] || '').trim();
    if (!t) return;
    addToPool(mod, grp, [t]);
    setPicked(mod, grp, [...new Set([...picked(mod, grp), t])]);
    setAdding(a => ({ ...a, [k]: '' }));
  };
  const dropTag = (mod, grp, t) => {
    dropFromPool(mod, grp, t);
    setPicked(mod, grp, picked(mod, grp).filter(x => x !== t));
  };
  const clearPicks = mod => set(s => ({ tags: { ...s.tags, [mod]: {} } }));

  const genTags = async () => {
    if (!ai.isConfigured()) { toast('尚未配置聊天接口', 'error', 4000); return; }
    const g = gen;
    const grp = (WORLD_TAGS[g.mod] || []).find(x => x.id === g.grp);
    setBusy('tags');
    keyRef.current = `tool-world-tags:${Date.now()}`;
    try {
      const existing = [...(grp?.tags || []), ...customOf(g.mod, g.grp)];
      const rows = await T.worldTags({ id: g.mod, group: grp?.label, premise: [f.premise, f.notes].filter(Boolean).join('\n'),
        existing, theme: g.theme, count: g.count }, { key: keyRef.current });
      if (!rows.length) toast('模型没有给出新的标签');
      setGen(x => (x ? { ...x, rows, off: rows.map(() => false) } : x));
    } catch (e) {
      if (!ai.queue.isAbort(e)) toast(String(e.message || e), 'error', 6000);
    } finally { setBusy(''); }
  };
  const takeTags = () => {
    const g = gen;
    const keep = g.rows.filter((_, i) => !g.off[i]);
    addToPool(g.mod, g.grp, keep);
    if (g.pick) setPicked(g.mod, g.grp, [...new Set([...picked(g.mod, g.grp), ...keep])]);
    toast(`已加入 ${keep.length} 个标签`, 'ok');
    setGen(null);
  };

  const runs = toolbox.runsOf('world');

  return html`
    <${Page} title="世界观生成器" onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${() => nav.push('/runs/world')}>历史</button>`}>
      <div class="pad">
        <div class="hint-box">
          世界观由三部分组成：这个世界是什么样，为什么会这样，人在其中如何生活。
          每一条设定都应能回答一个问题：这个设定会怎样改变人物今天的行为？
          无法回答的设定只是资料，对写作没有帮助。
        </div>
        <${Field} label="名称" desc="存为世界书时的书名。">
          <${Input} value=${f.name} placeholder="例如：梦境读取时代" onInput=${v => set({ name: v })}/>
        <//>
        <${Field} label="核心设定"
          desc="用一句话确定世界的基本形态。例如：与现实世界高度相似的现代社会，唯一的重大差异是人类在二十年前发现了能够读取梦境的技术。">
          <${Textarea} rows=${3} value=${f.premise} onInput=${v => set({ premise: v })}/>
        <//>
        <${Field} label="补充要求" desc="题材、基调、必须包含的设定等。可留空。">
          <${Textarea} rows=${3} value=${f.notes} onInput=${v => set({ notes: v })}/>
        <//>
      </div>

      <${List} title=${`模块 · 已选 ${on.length} / ${ALL.length}`}><//>
      <div class="pad-x">
        ${T.WORLD_MODULES.map(m => {
          const open = openMod === m.id;
          const n = pickCount(f, m.id);
          const noted = !!(f.notesBy[m.id] || '').trim();
          return html`
            <div key=${m.id} class=${`tb-wmod${f.on.includes(m.id) ? '' : ' is-off'}`}>
              <div class="tb-wmod-head press" onClick=${() => setOpenMod(open ? '' : m.id)}>
                <div class="tb-wmod-title">
                  <div class="tb-app-name">${m.title}</div>
                  <div class="tb-app-desc">${DESC[m.id]}</div>
                  <div class="tb-app-meta">${[n ? `已选 ${n} 个标签` : '未选标签', noted ? '已写想法' : ''].filter(Boolean).join(' · ')}</div>
                </div>
                <${Switch} checked=${f.on.includes(m.id)} onChange=${() => toggle(m.id)}/>
                <${Icon} name=${open ? 'chevronUp' : 'chevronDown'} size=${16}/>
              </div>
              ${open ? html`
                <div class="tb-wmod-body">
                  ${(WORLD_TAGS[m.id] || []).map(g => {
                    const custom = customOf(m.id, g.id).filter(t => !g.tags.includes(t));
                    const k = `${m.id}.${g.id}`;
                    return html`
                      <${Field} key=${g.id} label=${g.label}>
                        <div class="chip-row">
                          ${[...g.tags, ...custom].map(t => html`
                            <button key=${t} class=${`chip${picked(m.id, g.id).includes(t) ? ' is-active' : ''}`}
                              onClick=${e => { e.preventDefault(); toggleTag(m.id, g.id, t); }}>
                              ${t}
                              ${custom.includes(t) ? html`<span class="tb-chip-x" onClick=${e => { e.preventDefault(); e.stopPropagation(); dropTag(m.id, g.id, t); }}>
                                <${Icon} name="close" size=${11}/></span>` : null}
                            </button>`)}
                        </div>
                        <div class="tb-add-row">
                          <${Input} value=${adding[k] || ''} placeholder="添加标签" onInput=${v => setAdding(a => ({ ...a, [k]: v }))}
                            onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); addTag(m.id, g.id); } }}/>
                          <${Button} size="sm" variant="ghost" onClick=${e => { e?.preventDefault?.(); addTag(m.id, g.id); }}>添加<//>
                        </div>
                      <//>`;
                  })}
                  <${Field} label="已有的想法" desc="可留空。已写下的内容会保留，并在此基础上展开。">
                    <${Textarea} rows=${3} value=${f.notesBy[m.id] || ''}
                      onInput=${v => set(s => ({ notesBy: { ...s.notesBy, [m.id]: v } }))}/>
                  <//>
                  <div class="btn-row">
                    <${Button} variant="ghost" onClick=${() => setGen({ mod: m.id, grp: (WORLD_TAGS[m.id] || [])[0]?.id, theme: '', count: 10, rows: null, off: [], pick: false })}>批量生成标签<//>
                    ${n ? html`<${Button} variant="ghost" onClick=${() => clearPicks(m.id)}>清空已选<//>` : null}
                  </div>
                </div>` : null}
            </div>`;
        })}
      </div>

      <${List} title="参考">
        <${ListItem} title="主要人物" multiline arrow left=${html`<${Icon} name="users" size=${18}/>`}
          subtitle=${people.length ? people.map(c => phone.remark.nameOf(c)).join('、') : '可选。「人物处境」一块将写到这些角色'}
          onClick=${() => setPicking('people')}/>
        <${ListItem} title="已有设定" multiline arrow left=${html`<${Icon} name="book" size=${18}/>`}
          subtitle=${books.length ? books.map(b => b.name).join('、') : '可选。选择世界书，新写的内容与之保持一致'}
          onClick=${() => setPicking('books')}/>
      <//>

      <div class="pad">
        <${Field} label="每个模块的篇幅" desc="单位为字。留空表示不限，由内容决定。">
          <${NumberInput} unit="字" value=${f.length} onChange=${v => set({ length: v })} placeholder="不限"/>
        <//>
        <${Field} label="生成方式"
          desc=${f.mode === 'each'
            ? '逐个模块生成：每一块单独调用一次接口，后写的模块可以参照先写好的，篇幅也更充足。'
            : '一次写完：全部模块在一次请求中写出。'}>
          <${Segmented} value=${f.mode} onChange=${v => set({ mode: v })}
            items=${[{ value: 'all', label: '一次写完' }, { value: 'each', label: '逐个模块' }]}/>
        <//>
        ${busy ? html`
          <${Button} full variant="ghost" onClick=${stop}>
            <${Spinner} size=${15}/> ${busy === 'all' ? '正在生成' : `正在写「${titleOf(busy)}」`}，点此停止
          <//>`
          : html`<${Button} full onClick=${run}>${hasResult ? '重新生成' : '生成'}<//>`}
        <${CallNote} n=${calls}/>
      </div>

      ${hasResult ? html`
        <${List} title="结果">
          ${ALL.filter(id => String(modules[id] || '').trim()).map(id => html`
            <div key=${id} class="tb-out-wrap tb-mod">
              <div class="tb-out-head">
                <span>${titleOf(id)}</span>
                <span class="tb-mod-acts">
                  <button class="tb-out-copy press" onClick=${() => { setEditOf(id); setEditText(modules[id]); }}>修改</button>
                  <button class="tb-out-copy press" disabled=${!!busy} onClick=${() => rewrite(id)}>重写</button>
                  <button class="tb-out-copy press" onClick=${() => copyText(modules[id])}>复制</button>
                </span>
              </div>
              <div class="tb-out">${busy === id ? '正在重写' : modules[id]}</div>
            </div>`)}
        <//>
        <div class="pad">
          <${Button} full onClick=${saveBook}>存为世界书<//>
          <div class="tb-call">每个模块成为一个条目。确认页上可设定用途、常驻与位置。</div>
          <div class="pad-t"><${Button} full variant="ghost" onClick=${startSaga}>用它开一部长篇<//></div>
          <div class="tb-call">这份世界观直接成为一本常驻的世界书并挂在新长篇上，进入长篇向导。</div>
          <div class="btn-row pad-t">
            <${Button} variant="ghost" onClick=${() => copyText(joinWorld(f.name, modules))}>复制全文<//>
            <${Button} variant="ghost" onClick=${() => exportAs('txt')}>导出 TXT<//>
            <${Button} variant="ghost" onClick=${() => exportAs('docx')}>导出 DOCX<//>
          </div>
        </div>` : null}

      ${runs.length ? html`
        <${List}>
          <${ListItem} title="历史记录" right=${String(runs.length)} arrow
            left=${html`<${Icon} name="clock" size=${18}/>`} onClick=${() => nav.push('/runs/world')}/>
        <//>` : null}

      <${Sheet} open=${!!gen} onClose=${() => setGen(null)} title=${gen ? `批量生成标签 · ${titleOf(gen.mod)}` : ''} height="86%">
        ${gen ? html`
          <${Field} label="小类">
            <div class="chip-row">
              ${(WORLD_TAGS[gen.mod] || []).map(g => html`
                <button key=${g.id} class=${`chip${gen.grp === g.id ? ' is-active' : ''}`}
                  onClick=${e => { e.preventDefault(); setGen(x => ({ ...x, grp: g.id, rows: null })); }}>${g.label}</button>`)}
            </div>
          <//>
          <${Field} label="方向" desc="可留空。例如：偏东方、与海有关、适合校园。核心设定与补充要求会一并参考。">
            <${Input} value=${gen.theme} onInput=${v => setGen(x => ({ ...x, theme: v }))}/>
          <//>
          <${Field} label="数量"><${NumberInput} unit="个" min=${1} value=${gen.count} onChange=${v => setGen(x => ({ ...x, count: v }))}/><//>
          <${Button} full disabled=${busy === 'tags'} onClick=${genTags}>${busy === 'tags' ? html`<${Spinner} size=${15}/> 正在生成` : '生成'}<//>
          <${CallNote} extra="不会重复已有的标签"/>
          ${gen.rows ? html`
            <${List} inset=${false}>
              ${gen.rows.map((t, i) => html`
                <${ListItem} key=${t} title=${t} class=${gen.off[i] ? 'is-off' : ''}
                  right=${html`<${Icon} name=${gen.off[i] ? 'close' : 'check'} size=${17}/>`}
                  onClick=${() => setGen(x => ({ ...x, off: x.off.map((o, j) => (j === i ? !o : o)) }))}/>`)}
              <${ListItem} title="加入后同时选中" right=${html`<${Switch} checked=${gen.pick} onChange=${v => setGen(x => ({ ...x, pick: v }))}/>`}/>
            <//>
            <div class="sheet-acts"><${Button} onClick=${takeTags}>加入标签（${gen.rows.filter((_, i) => !gen.off[i]).length} 个）<//></div>` : null}` : null}
      <//>

      <${Sheet} open=${!!editOf} onClose=${() => setEditOf('')} title=${editOf ? `修改「${titleOf(editOf)}」` : ''} height="86%">
        <${Textarea} rows=${14} value=${editText} onInput=${setEditText}/>
        <div class="sheet-acts">
          <${Button} variant="ghost" onClick=${() => setEditOf('')}>取消<//>
          <${Button} onClick=${() => { commit({ ...modules, [editOf]: editText }); setEditOf(''); }}>保存<//>
        </div>
      <//>

      <${CharPicker} multi open=${picking === 'people'} picked=${f.peopleIds} title="主要人物"
        onClose=${() => setPicking('')} onPick=${ids => set({ peopleIds: ids })}/>
      <${BookPicker} multi open=${picking === 'books'} picked=${f.bookIds} title="已有设定"
        onClose=${() => setPicking('')} onPick=${ids => set({ bookIds: ids })}/>
    <//>`;
}

/** 历史里的一份世界观载回生成器 */
export function loadWorld(run) {
  loadToolState('world', { ...DEF, ...(run.input || {}), result: { modules: run.output?.modules || {} }, runId: run.id });
}
