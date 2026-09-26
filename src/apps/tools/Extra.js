import { html, useState, useRef, useEffect } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, Button, Icon, Spinner, Switch,
         Segmented, NumberInput, Sheet, EmptyState, toast, confirm } from '../../ui/index.js';
import { CharPicker, CallNote, OutBox, copyText, useToolState, loadToolState } from './common.js';

const { db, nav, ai, toolbox, sidestory: S, work } = phone;
const T = ai.tools;

// 番外生成器。移植自用户的 fanwai 仓库，见 ARCHITECTURE 4.247 与 system/sidestory.js。
//
// 它不写番外，它把脑洞和标签整理成一段提示词。两种用法（用户要求两种都要）：
// 复制到别处交给别的模型写；或者在「我们」里建一则番外，这段提示词作为前提，由 Eira 写。
//
// 本地编译不调接口。「编主线」「AI 整理」「批量生成标签」各一次请求，按钮下写明。

const DEF = { story: S.blankStory(), open: { idea: true, tags: true },
  extraTags: {}, versions: [], cur: 0, runId: null };

// 语义词典单独存一份（'extra-lex'）。生成器页与词典页可能同时挂着，
// 放在同一份设置里的话，谁后写谁就把对方的改动盖掉
const lexState = () => ({ lex: {}, lexDeleted: [], ...toolbox.stateOf('extra-lex') });
const setLex = fn => toolbox.setState('extra-lex', fn(lexState()));

const cats = f => S.CATEGORIES.map(c => ({ ...c, tags: [...c.tags, ...((f.extraTags || {})[c.key] || []).filter(t => !c.tags.includes(t))] }));

// 可以收起的一节
function Fold({ id, title, sub, f, set, children }) {
  const open = !!f.open[id];
  return html`
    <div class="tb-fold">
      <${List}>
        <${ListItem} title=${title} subtitle=${sub} multiline
          right=${html`<${Icon} name=${open ? 'chevronUp' : 'chevronDown'} size=${16}/>`}
          onClick=${() => set(s => ({ open: { ...s.open, [id]: !open } }))}/>
      <//>
      ${open ? html`<div class="pad-x tb-fold-body">${children}</div>` : null}
    </div>`;
}

// 单选一排
const Pick1 = ({ list, value, onPick }) => html`
  <div class="chip-row">
    ${list.map(x => html`
      <button key=${x} class=${`chip${value === x ? ' is-active' : ''}`}
        onClick=${e => { e.preventDefault(); onPick(value === x ? '未指定' : x); }}>${x}</button>`)}
  </div>`;
// 多选一排
const PickN = ({ list, value = [], onPick }) => html`
  <div class="chip-row">
    ${list.map(x => html`
      <button key=${x} class=${`chip${value.includes(x) ? ' is-active' : ''}`}
        onClick=${e => { e.preventDefault(); onPick(value.includes(x) ? value.filter(y => y !== x) : [...value, x]); }}>${x}</button>`)}
  </div>`;

// 一组滑块：每一项先开，再拖
function Sliders({ defs, cfg = {}, onChange }) {
  return html`${defs.map(d => {
    const c = cfg[d.key] || { on: false, value: d.value };
    const put = patch => onChange({ ...cfg, [d.key]: { ...c, ...patch } });
    return html`
      <div key=${d.key} class="tb-slider">
        <div class="tb-slider-head">
          <span>${d.name}</span>
          <${Switch} checked=${!!c.on} onChange=${v => put({ on: v })}/>
        </div>
        ${c.on ? html`
          <input class="tb-range" type="range" min="0" max="100" value=${c.value ?? d.value}
            onInput=${e => put({ value: Number(e.target.value) })}/>
          <div class="tb-slider-ends"><span>${d.min}</span><span>${d.max}</span></div>` : null}
      </div>`;
  })}`;
}

function Person({ label, p, onChange, onPickChar }) {
  const put = patch => onChange({ ...p, ...patch });
  return html`
    <div class="tb-detail">
      <div class="tb-detail-head"><span>${label}</span>
        <button class="tb-out-copy press" onClick=${e => { e.preventDefault(); onPickChar(); }}>从联系人填入名字</button>
      </div>
      <${Field} label="名字"><${Input} value=${p.name} placeholder="可留空" onInput=${v => put({ name: v })}/><//>
      <${Field} label="性别"><${Pick1} list=${S.OPT.gender.slice(1)} value=${p.gender} onPick=${v => put({ gender: v })}/><//>
      <${Field} label="年龄阶段"><${Pick1} list=${S.OPT.age.slice(1)} value=${p.age} onPick=${v => put({ age: v })}/><//>
      <${Field} label="身份"><${Pick1} list=${S.OPT.identity.slice(1)} value=${p.identity} onPick=${v => put({ identity: v })}/><//>
      <${Field} label="职业"><${Input} value=${p.job} placeholder="可留空" onInput=${v => put({ job: v })}/><//>
      <${Field} label="性格"><${PickN} list=${S.OPT.personality} value=${p.personality} onPick=${v => put({ personality: v })}/><//>
      <${Field} label="性取向"><${Pick1} list=${S.OPT.orientation.slice(1)} value=${p.orientation} onPick=${v => put({ orientation: v })}/><//>
      <${Field} label="补充"><${Input} value=${p.extra} placeholder="可留空" onInput=${v => put({ extra: v })}/><//>
    </div>`;
}

export function ExtraPage() {
  useStore(db.chats.store);
  useStore(db.characters.store);
  useStore(db.tools.store);
  const [f, set, fRef] = useToolState('extra', DEF);
  const L = lexState();
  const [busy, setBusy] = useState('');
  const [pickFor, setPickFor] = useState('');      // 'char' | 'user'
  const [chatPick, setChatPick] = useState(false);
  const [tagGen, setTagGen] = useState(null);      // { cat, theme, count, rows, off }
  const [adding, setAdding] = useState({});        // 每个分类的自定义输入
  const [countText, setCountText] = useState('');
  const [countTarget, setCountTarget] = useState(0);
  const keyRef = useRef('');

  useEffect(() => () => { if (keyRef.current) ai.queue.cancel(keyRef.current); }, []);

  const s = f.story;
  const lex = S.lexMap(L.lex, L.lexDeleted);
  const putStory = patch => set(x => ({ story: { ...x.story, ...(typeof patch === 'function' ? patch(x.story) : patch) } }));
  const putIn = (key, patch) => putStory(st => ({ [key]: { ...st[key], ...patch } }));
  const conflicts = S.conflicts(s);
  const related = S.related(s, new Set(cats(f).flatMap(c => c.tags)));
  const v = f.versions[f.cur] || null;

  const toggleTag = (cat, t) => putStory(st => {
    const cur = st.tags[cat] || [];
    return { tags: { ...st.tags, [cat]: cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t] } };
  });
  const addTag = cat => {
    const t = String(adding[cat] || '').trim();
    if (!t) return;
    set(x => ({ extraTags: { ...x.extraTags, [cat]: [...new Set([...(x.extraTags[cat] || []), t])] },
      story: { ...x.story, tags: { ...x.story.tags, [cat]: [...new Set([...(x.story.tags[cat] || []), t])] } } }));
    setAdding(a => ({ ...a, [cat]: '' }));
  };

  // 一次编译的结果成为一个版本，并存进番外库（历史）
  const keep = (ver) => {
    const cur = fRef.current;
    const versions = [...cur.versions, { ...ver, n: cur.versions.length + 1, at: Date.now() }];
    const title = ver.title || cur.story.title || cur.story.brainDump.slice(0, 20) || '未命名番外';
    const out = { text: ver.prompt, versions };
    const input = { story: cur.story, extraTags: cur.extraTags };
    let runId = cur.runId;
    if (runId && toolbox.getRun(runId)) toolbox.updateRun(runId, { title, input, output: out });
    else runId = toolbox.addRun('extra', { title, input, output: out }).id;
    set({ versions, cur: versions.length - 1, runId });
    fRef.current = { ...fRef.current, versions, runId };
  };

  const compileLocal = () => {
    const prompt = S.compile(s, lex);
    if (!prompt.trim()) { toast('请先写下脑洞或选择标签'); return; }
    keep({ prompt, understanding: S.understanding(s, lex), direction: '', ai: false, title: s.title });
    toast('已编译', 'ok');
  };

  const call = async (label, fn) => {
    if (!ai.isConfigured()) { toast('尚未配置聊天接口', 'error', 4000); return null; }
    setBusy(label);
    keyRef.current = `tool-extra:${label}:${Date.now()}`;
    try { return await fn(keyRef.current); }
    catch (e) { if (!ai.queue.isAbort(e)) toast(`${label}失败：${e.message || e}`, 'error', 6000); return null; }
    finally { setBusy(''); }
  };

  const aiCompile = async () => {
    const r = await call('AI 整理', key => T.extraCompile(S.material(s, lex), s.compileLevel, { key }));
    if (!r) return;
    const prompt = [s.head, r.prompt, s.tail].map(x => String(x || '').trim()).filter(Boolean).join('\n');
    keep({ prompt, understanding: r.understanding, direction: r.direction, ai: true, title: s.title || r.title });
    if (!s.title && r.title) putStory({ title: r.title });
    toast('已整理', 'ok');
  };

  const storyline = async () => {
    const text = await call('编主线', key => T.extraStoryline(S.material(s, lex), { key }));
    if (!text) return;
    if (s.brainDump.trim() && !await confirm({ title: '主线已写好', message: text, okText: '替换脑洞', cancelText: '追加在后面' })) {
      putStory({ brainDump: `${s.brainDump.trim()}\n\n${text}` });
    } else putStory({ brainDump: text });
  };

  const genTags = async () => {
    const g = tagGen;
    const cat = S.CATEGORIES.find(c => c.key === g.cat);
    const existing = cats(f).flatMap(c => c.tags);
    const rows = await call('批量生成标签', key => T.extraTags({ category: cat.name, theme: g.theme, existing, count: g.count }, { key }));
    if (!rows) return;
    setTagGen(x => ({ ...x, rows, off: rows.map(r => existing.includes(r.tag)) }));
  };
  const takeTags = () => {
    const g = tagGen;
    const keepRows = g.rows.filter((_, i) => !g.off[i]);
    set(x => ({
      extraTags: { ...x.extraTags, [g.cat]: [...new Set([...(x.extraTags[g.cat] || []), ...keepRows.map(r => r.tag)])] },
    }));
    setLex(l => ({ ...l, lex: { ...l.lex, ...Object.fromEntries(keepRows.filter(r => r.meaning).map(r => [r.tag, r.meaning])) } }));
    toast(`已加入 ${keepRows.length} 个标签与翻译`, 'ok');
    setTagGen(null);
  };

  const writeInUs = chat => {
    setChatPick(false);
    if (!v) return;
    const row = work.create({ chatId: chat.id, kind: work.EXTRA, title: s.title || v.title || '', premise: v.prompt,
      tone: db.settings.get().workToneLast || '' });
    const first = work.addChapter(row.id);
    toast('已在「我们」中新建这则番外', 'ok');
    phone.intent.open('us', { route: first ? `/read/${first.id}` : `/work/${row.id}`, back: true });
  };

  const reset = async () => {
    if (!await confirm({ title: '新建番外', message: '当前填写的内容与版本将清空。已编译的版本仍保存在番外库中。', okText: '新建' })) return;
    set({ story: S.blankStory(), versions: [], cur: 0, runId: null });
  };

  const chats = db.chats.all().filter(c => (c.characterIds || []).length)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const chatName = c => (c.characterIds || []).map(id => db.characters.get(id)).filter(Boolean)
    .map(x => phone.remark.nameOf(x)).join('、') || c.title || '会话';
  const cnt = S.countText(countText);
  const runs = toolbox.runsOf('extra');

  return html`
    <${Page} title="番外生成器" onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${() => nav.push('/runs/extra')}>番外库</button>`}>
      <div class="pad">
        <div class="hint-box">
          这里不写番外正文，而是把脑洞与标签整理成一段提示词。可复制到别处交给模型执行，
          也可在「我们」中新建一则番外，以这段提示词为前提由 Eira 写作。选择的是感觉，不是写作指令。
        </div>
      </div>

      <${Fold} id="idea" title="脑洞" sub="优先级最高。一句话也可以生成" f=${f} set=${set}>
        <${Field} label="标题"><${Input} value=${s.title} placeholder="可留空" onInput=${x => putStory({ title: x })}/><//>
        <${Field} label="我这次想看的">
          <${Textarea} rows=${5} value=${s.brainDump} onInput=${x => putStory({ brainDump: x })}/>
        <//>
        <${Button} full variant="ghost" disabled=${!!busy} onClick=${storyline}>
          ${busy === '编主线' ? html`<${Spinner} size=${15}/> 正在编写` : s.brainDump.trim() ? '补完这条主线' : '按所选标签编一条主线'}
        <//>
        <${CallNote} extra="写出谁、在什么处境、发生了什么、转折与落点，不写正文"/>
      <//>

      <${Fold} id="tags" title="标签" sub=${`已选 ${S.tagList(s).length} 个。标签经语义词典翻译为行为语言后写入`} f=${f} set=${set}>
        ${conflicts.length ? html`<div class="warn-box">方向相反的标签：${conflicts.map(([a, b]) => `「${a}」与「${b}」`).join('，')}。是否保留由你决定。</div>` : null}
        ${cats(f).map(c => html`
          <${Field} key=${c.key} label=${c.name}>
            <${PickN} list=${c.tags} value=${s.tags[c.key] || []} onPick=${x => putStory(st => ({ tags: { ...st.tags, [c.key]: x } }))}/>
            <div class="tb-add-row">
              <${Input} value=${adding[c.key] || ''} placeholder="添加标签" onInput=${x => setAdding(a => ({ ...a, [c.key]: x }))}
                onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); addTag(c.key); } }}/>
              <${Button} size="sm" variant="ghost" onClick=${e => { e?.preventDefault?.(); addTag(c.key); }}>添加<//>
            </div>
          <//>`)}
        ${related.length ? html`
          <${Field} label="相关推荐">
            <div class="chip-row">
              ${related.map(t => html`<button key=${t} class="chip" onClick=${e => {
                e.preventDefault();
                const c = cats(f).find(x => x.tags.includes(t));
                if (c) toggleTag(c.key, t);
              }}><${Icon} name="plus" size=${11}/> ${t}</button>`)}
            </div>
          <//>` : null}
        <div class="btn-row">
          <${Button} variant="ghost" onClick=${() => setTagGen({ cat: 'emotion', theme: '', count: 8, rows: null, off: [] })}>批量生成标签<//>
          <${Button} variant="ghost" onClick=${() => nav.push('/extra/lexicon')}>语义词典<//>
        </div>
      <//>

      <${Fold} id="people" title="人物" sub="全部选填。不指定时沿用当前上下文中的角色" f=${f} set=${set}>
        <${Field} label="人物模式">
          <${Segmented} value=${s.characters.mode} items=${S.OPT.charMode.map(x => ({ value: x.v, label: x.t }))}
            onChange=${x => putIn('characters', { mode: x })}/>
        <//>
        <${Person} label="CHAR" p=${s.characters.char} onChange=${p => putIn('characters', { char: p })} onPickChar=${() => setPickFor('char')}/>
        <${Person} label="USER" p=${s.characters.user} onChange=${p => putIn('characters', { user: p })} onPickChar=${() => setPickFor('user')}/>
        ${(s.characters.others || []).map((o, i) => html`
          <div key=${o.id} class="tb-detail">
            <div class="tb-detail-head"><span>其他角色 ${i + 1}</span>
              <button class="press li-cut" onClick=${() => putIn('characters', { others: s.characters.others.filter(x => x.id !== o.id) })}>
                <${Icon} name="close" size=${15}/></button>
            </div>
            <${Field} label="名字"><${Input} value=${o.name} onInput=${x => putIn('characters', { others: s.characters.others.map(y => (y.id === o.id ? { ...y, name: x } : y)) })}/><//>
            <${Field} label="与主要角色的关系"><${Input} value=${o.relation} onInput=${x => putIn('characters', { others: s.characters.others.map(y => (y.id === o.id ? { ...y, relation: x } : y)) })}/><//>
            <${Field} label="补充"><${Input} value=${o.extra} onInput=${x => putIn('characters', { others: s.characters.others.map(y => (y.id === o.id ? { ...y, extra: x } : y)) })}/><//>
          </div>`)}
        <${Button} full variant="ghost" icon="plus" onClick=${() => putIn('characters', { others: [...(s.characters.others || []), { id: phone.uid('o'), name: '', relation: '', extra: '' }] })}>添加其他角色<//>
      <//>

      <${Fold} id="rel" title="关系与情绪" sub="当前关系、关系动态的强度、谁更主动" f=${f} set=${set}>
        <${Field} label="当前关系"><${Pick1} list=${S.OPT.relation.slice(1)} value=${s.relationship.current} onPick=${x => putIn('relationship', { current: x })}/>
          <div class="pad-t"><${Input} value=${s.relationship.currentCustom} placeholder="自定义，可留空" onInput=${x => putIn('relationship', { currentCustom: x })}/></div>
        <//>
        <${Sliders} defs=${S.SLIDERS} cfg=${s.relationship.sliders} onChange=${x => putIn('relationship', { sliders: x })}/>
        ${S.ROLE_QUESTIONS.map(q => html`
          <${Field} key=${q.key} label=${`${q.label}（A 为 CHAR，B 为 USER）`}>
            <${Segmented} value=${s.relationship.roles[q.key] || '未指定'} items=${S.ROLE_OPTIONS.map(x => ({ value: x, label: x }))}
              onChange=${x => putIn('relationship', { roles: { ...s.relationship.roles, [q.key]: x } })}/>
          <//>`)}
      <//>

      <${Fold} id="world" title="世界与场景" sub="时代、世界类型、身份差、场景与参考作品" f=${f} set=${set}>
        <${Field} label="时代"><${Pick1} list=${S.OPT.era.slice(1)} value=${s.world.era} onPick=${x => putIn('world', { era: x })}/><//>
        <${Field} label="世界类型"><${Pick1} list=${S.OPT.world.slice(1)} value=${s.world.type} onPick=${x => putIn('world', { type: x })}/><//>
        <${Field} label="身份差"><${Pick1} list=${S.OPT.social.slice(1)} value=${s.world.social} onPick=${x => putIn('world', { social: x })}/><//>
        <${Field} label="场景"><${PickN} list=${S.OPT.scene} value=${s.world.scenes} onPick=${x => putIn('world', { scenes: x })}/>
          <div class="pad-t"><${Input} value=${s.world.sceneCustom} placeholder="其他场景，用顿号分隔" onInput=${x => putIn('world', { sceneCustom: x })}/></div>
        <//>
        <${Field} label="文学参考" desc="只取时代气质、人物张力与叙事方式，明确要求不复制原作。"><${Input} value=${s.world.literary} placeholder="作品名，用顿号分隔" onInput=${x => putIn('world', { literary: x })}/><//>
        <${Field} label="影像质感"><${PickN} list=${S.OPT.screen} value=${s.world.screen} onPick=${x => putIn('world', { screen: x })}/><//>
        <${Field} label="想要的整体感觉"><${Input} value=${s.world.screenFeel} placeholder="可留空" onInput=${x => putIn('world', { screenFeel: x })}/><//>
      <//>

      <${Fold} id="narr" title="叙事与氛围" sub="节奏、视角、风格、氛围、画面、结局、拒绝清单" f=${f} set=${set}>
        <${Sliders} defs=${S.NARRATIVE_SLIDERS} cfg=${s.narrative.sliders} onChange=${x => putIn('narrative', { sliders: x })}/>
        <${Field} label="视角"><${Pick1} list=${S.OPT.pov.slice(1)} value=${s.narrative.pov} onPick=${x => putIn('narrative', { pov: x })}/><//>
        <${Field} label="风格"><${PickN} list=${S.OPT.style} value=${s.narrative.styles} onPick=${x => putIn('narrative', { styles: x })}/><//>
        <${Field} label="信息差"><${Pick1} list=${S.OPT.infoGap.slice(1)} value=${s.narrative.infoGap} onPick=${x => putIn('narrative', { infoGap: x })}/><//>
        <${Field} label="氛围"><${PickN} list=${S.OPT.vibe} value=${s.vibe.moods} onPick=${x => putIn('vibe', { moods: x })}/><//>
        <${Field} label="季节"><${Pick1} list=${S.OPT.season.slice(1)} value=${s.visual.season} onPick=${x => putIn('visual', { season: x })}/><//>
        <${Field} label="时间"><${Pick1} list=${S.OPT.time.slice(1)} value=${s.visual.time} onPick=${x => putIn('visual', { time: x })}/><//>
        <${Field} label="天气"><${Pick1} list=${S.OPT.weather.slice(1)} value=${s.visual.weather} onPick=${x => putIn('visual', { weather: x })}/><//>
        <${Field} label="色调"><${Pick1} list=${S.OPT.tone.slice(1)} value=${s.visual.tone} onPick=${x => putIn('visual', { tone: x })}/><//>
        <${Field} label="结局倾向"><${Pick1} list=${S.OPT.ending.slice(1)} value=${s.ending} onPick=${x => putStory({ ending: x })}/><//>
        <${List} inset=${false}>
          <${ListItem} title="加入一点额外的元素" subtitle="小意外、配角介入、伏笔等。不会覆盖上面已明确的要求" multiline
            right=${html`<${Switch} checked=${s.extra.on} onChange=${x => putIn('extra', { on: x })}/>`}/>
        <//>
        ${s.extra.on ? html`
          <${Field} label="元素"><${PickN} list=${S.OPT.hooks} value=${s.extra.hooks} onPick=${x => putIn('extra', { hooks: x })}/><//>
          <${Field} label="幅度"><${Segmented} value=${s.extra.level} items=${S.OPT.hookLevel.map(x => ({ value: x, label: x }))} onChange=${x => putIn('extra', { level: x })}/><//>` : null}
        <${Field} label="拒绝清单" desc="绝对不要出现的内容，一行一项。单独列在提示词末尾。">
          <${Textarea} rows=${3} value=${s.refuse} onInput=${x => putStory({ refuse: x })}/>
        <//>
      <//>

      <${Fold} id="len" title="篇幅" sub="目标字数与严格篇幅模式" f=${f} set=${set}>
        <${Field} label="目标字数"><${Pick1} list=${S.OPT.lengthTarget} value=${s.length.target} onPick=${x => putIn('length', { target: x === '未指定' ? '不限' : x })}/>
          <div class="pad-t"><${NumberInput} unit="字" value=${Number(s.length.custom) || 0} placeholder="自定义字数"
            onChange=${x => putIn('length', { custom: x ? String(x) : '' })}/></div>
        <//>
        <${List} inset=${false}>
          <${ListItem} title="严格篇幅模式" subtitle="把目标字数作为最低完成线，不许总结、跳时间与虚报字数" multiline
            right=${html`<${Switch} checked=${s.length.strict} onChange=${x => putIn('length', { strict: x })}/>`}/>
          <${ListItem} title="长篇分段模式" subtitle="一次写不完时停在场景断点，下次无缝续写" multiline
            right=${html`<${Switch} checked=${s.length.segmented} onChange=${x => putIn('length', { segmented: x })}/>`}/>
          <${ListItem} title="输出总字数" subtitle="正文写完后按实际正文统计并输出字数" multiline
            right=${html`<${Switch} checked=${s.length.countOutput} onChange=${x => putIn('length', { countOutput: x })}/>`}/>
        <//>
      <//>

      <${Fold} id="out" title="输出形态" sub="自然段落或分区块、开场指令、固定的开头与结尾" f=${f} set=${set}>
        <${Field} label="形态" desc="自然段落：像手写要求那样连成几段。分区块：人物、关系、叙事、篇幅分块列出。">
          <${Segmented} value=${s.promptStyle} items=${[{ value: 'natural', label: '自然段落' }, { value: 'structured', label: '分区块' }]}
            onChange=${x => putStory({ promptStyle: x })}/>
        <//>
        <${Field} label="开场指令"><${Input} value=${s.opening} onInput=${x => putStory({ opening: x })}/><//>
        <${List} inset=${false}>
          <${ListItem} title="附加完整的番外说明" subtitle="说明番外不计入主线、结束后恢复主线" multiline
            right=${html`<${Switch} checked=${s.openingExtraOn} onChange=${x => putStory({ openingExtraOn: x })}/>`}/>
        <//>
        <${Field} label="固定开头" desc="每一篇都相同的开头约束，放在最前面。可留空。">
          <${Textarea} rows=${3} value=${s.head} onInput=${x => putStory({ head: x })}/>
        <//>
        <${Field} label="固定结尾" desc="每一篇都相同的结尾约束，放在最后面。可留空。">
          <${Textarea} rows=${3} value=${s.tail} onInput=${x => putStory({ tail: x })}/>
        <//>
      <//>

      <div class="pad">
        <${Button} full onClick=${compileLocal}>编译提示词<//>
        <div class="tb-call">本地编译，不调用接口</div>
        <div class="pad-t">
          <${Field} label="AI 整理的强度">
            <${Segmented} value=${s.compileLevel} items=${S.OPT.compileLevel.map(x => ({ value: x.v, label: x.t }))}
              onChange=${x => putStory({ compileLevel: x })}/>
          <//>
          <${Button} full variant="ghost" disabled=${!!busy} onClick=${aiCompile}>
            ${busy === 'AI 整理' ? html`<${Spinner} size=${15}/> 正在整理` : 'AI 整理'}
          <//>
          <${CallNote} extra=${S.OPT.compileLevel.find(x => x.v === s.compileLevel)?.d || ''}/>
        </div>
        <div class="pad-t"><${Button} full size="sm" variant="outline" onClick=${reset}>新建番外<//></div>
      </div>

      ${v ? html`
        <${List} title="版本"><//>
        <div class="pad-x">
          <div class="chip-row">
            ${f.versions.map((x, i) => html`
              <button key=${i} class=${`chip${f.cur === i ? ' is-active' : ''}`} onClick=${() => set({ cur: i })}>
                v${x.n}${x.ai ? ' · AI' : ''}</button>`)}
          </div>
          ${v.understanding ? html`<${OutBox} title="理解" text=${v.understanding}/>` : null}
          ${v.direction ? html`<${OutBox} title="番外方向" text=${v.direction}/>` : null}
          <${OutBox} title="最终提示词" text=${v.prompt}/>
        </div>
        <div class="pad">
          <${Button} full onClick=${() => copyText(v.prompt)}>复制提示词<//>
          <div class="pad-t"><${Button} full variant="ghost" onClick=${() => setChatPick(true)}>在「我们」中写这则番外<//></div>
          <div class="tb-call">选择一段会话后新建一则番外，这段提示词作为前提。之后由「我们」按原有方式写作。</div>
        </div>` : null}

      <${Fold} id="count" title="篇幅检测" sub="统计已写出的正文字数，生成续写指令" f=${f} set=${set}>
        <${Field} label="粘贴正文"><${Textarea} rows=${5} value=${countText} onInput=${setCountText}/><//>
        <${Field} label="目标字数"><${NumberInput} unit="字" value=${countTarget} placeholder="可留空" onChange=${setCountTarget}/><//>
        <div class="tb-call">
          共 ${cnt.chars} 字（不含空白 ${cnt.noSpace} 字，汉字 ${cnt.cn} 个，${cnt.paragraphs} 段）
          ${countTarget ? `。${cnt.noSpace >= countTarget ? '已达到目标' : `距目标尚缺 ${countTarget - cnt.noSpace} 字`}` : ''}
        </div>
        <div class="pad-t"><${Button} full variant="ghost" onClick=${() => copyText(countTarget && cnt.noSpace < countTarget
          ? `${S.CONTINUE_INSTRUCTION}距离目标篇幅尚缺约 ${countTarget - cnt.noSpace} 字。` : S.CONTINUE_INSTRUCTION)}>复制续写指令<//></div>
      <//>

      ${runs.length ? html`
        <${List}>
          <${ListItem} title="番外库" right=${String(runs.length)} arrow
            left=${html`<${Icon} name="clock" size=${18}/>`} onClick=${() => nav.push('/runs/extra')}/>
        <//>` : null}

      <${CharPicker} open=${!!pickFor} title="填入名字" onClose=${() => setPickFor('')}
        onPick=${c => putIn('characters', { [pickFor]: { ...s.characters[pickFor], name: phone.remark.nameOf(c) } })}/>

      <${Sheet} open=${chatPick} onClose=${() => setChatPick(false)} title="在哪段会话中写" height="70%">
        ${chats.length ? html`
          <${List} inset=${false}>
            ${chats.map(c => html`<${ListItem} key=${c.id} title=${chatName(c)} arrow
              left=${html`<${Icon} name="message" size=${18}/>`} onClick=${() => writeInUs(c)}/>`)}
          <//>` : html`<${EmptyState} icon="message" title="暂无会话" desc="番外挂在一段会话上，请先与角色开始对话。"/>`}
      <//>

      <${Sheet} open=${!!tagGen} onClose=${() => setTagGen(null)} title="批量生成标签" height="86%">
        ${tagGen ? html`
          <${Field} label="分类">
            <div class="chip-row">
              ${S.CATEGORIES.map(c => html`<button key=${c.key} class=${`chip${tagGen.cat === c.key ? ' is-active' : ''}`}
                onClick=${e => { e.preventDefault(); setTagGen(x => ({ ...x, cat: c.key })); }}>${c.name}</button>`)}
            </div>
          <//>
          <${Field} label="方向" desc="可留空。例如：职场、久别重逢相关。"><${Input} value=${tagGen.theme} onInput=${x => setTagGen(g => ({ ...g, theme: x }))}/><//>
          <${Field} label="数量"><${NumberInput} unit="个" min=${1} value=${tagGen.count} onChange=${x => setTagGen(g => ({ ...g, count: x }))}/><//>
          <${Button} full disabled=${!!busy} onClick=${genTags}>${busy === '批量生成标签' ? html`<${Spinner} size=${15}/> 正在生成` : '生成'}<//>
          <${CallNote} extra="每个标签同时生成行为语言翻译"/>
          ${tagGen.rows ? html`
            <${List} inset=${false}>
              ${tagGen.rows.map((r, i) => html`
                <${ListItem} key=${i} title=${r.tag} subtitle=${r.meaning} multiline class=${tagGen.off[i] ? 'is-off' : ''}
                  right=${html`<${Icon} name=${tagGen.off[i] ? 'close' : 'check'} size=${17}/>`}
                  onClick=${() => setTagGen(g => ({ ...g, off: g.off.map((o, j) => (j === i ? !o : o)) }))}/>`)}
            <//>
            <div class="sheet-acts"><${Button} onClick=${takeTags}>加入标签池与词典<//></div>` : null}` : null}
      <//>
    <//>`;
}

// 语义词典：标签翻译为行为语言。可改、可加、可删、可恢复默认
export function LexiconPage() {
  useStore(db.tools.store);
  const f = lexState();
  const set = fn => setLex(l => ({ ...l, ...(typeof fn === 'function' ? fn(l) : fn) }));
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null); // { tag, meaning, isNew }
  const lex = S.lexMap(f.lex, f.lexDeleted);
  const rows = [...lex.entries()].filter(([t, m]) => !q || t.includes(q) || m.includes(q));
  const save = () => {
    const t = String(edit.tag || '').trim();
    if (!t || !String(edit.meaning || '').trim()) { toast('请填写标签与翻译'); return; }
    set(x => ({ lex: { ...x.lex, [t]: edit.meaning.trim() }, lexDeleted: x.lexDeleted.filter(y => y !== t) }));
    setEdit(null);
  };
  const del = t => {
    set(x => {
      const lexNext = { ...x.lex };
      delete lexNext[t];
      return { lex: lexNext, lexDeleted: S.LEXICON.some(([k]) => k === t) ? [...new Set([...x.lexDeleted, t])] : x.lexDeleted };
    });
    setEdit(null);
  };
  const restore = async () => {
    if (!await confirm({ title: '恢复默认词典', message: '自己添加与修改的翻译将全部清除。', okText: '恢复', danger: true })) return;
    set({ lex: {}, lexDeleted: [] });
  };
  return html`
    <${Page} title="语义词典" onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${() => setEdit({ tag: '', meaning: '', isNew: true })}>添加</button>`}>
      <div class="pad">
        <div class="hint-box">选中的标签不会原样写进提示词，而是替换为这里的行为语言。没有词条的标签作为整体方向交给模型。</div>
        <${Input} value=${q} placeholder="搜索" onInput=${setQ}/>
      </div>
      <${List} title=${`${rows.length} 条`}>
        ${rows.map(([t, m]) => html`<${ListItem} key=${t} title=${t} subtitle=${m} multiline arrow onClick=${() => setEdit({ tag: t, meaning: m })}/>`)}
      <//>
      <div class="pad"><${Button} full variant="outline" onClick=${restore}>恢复默认<//></div>
      <${Sheet} open=${!!edit} onClose=${() => setEdit(null)} title=${edit?.isNew ? '添加词条' : '编辑词条'} height="70%">
        ${edit ? html`
          <${Field} label="标签"><${Input} value=${edit.tag} disabled=${!edit.isNew} onInput=${x => setEdit(e => ({ ...e, tag: x }))}/><//>
          <${Field} label="行为语言" desc="说明这个感觉在故事里通过什么行为、反应或细节体现。">
            <${Textarea} rows=${5} value=${edit.meaning} onInput=${x => setEdit(e => ({ ...e, meaning: x }))}/>
          <//>
          <div class="sheet-acts">
            ${edit.isNew ? null : html`<${Button} variant="danger" onClick=${() => del(edit.tag)}>删除<//>`}
            <${Button} onClick=${save}>保存<//>
          </div>` : null}
      <//>
    <//>`;
}

export function loadExtra(run) {
  const versions = run.output?.versions || [];
  const inp = run.input || {};
  const cur = toolbox.stateOf('extra');
  loadToolState('extra', { ...DEF, ...cur, story: { ...S.blankStory(), ...(inp.story || {}) },
    extraTags: inp.extraTags || cur.extraTags || {}, versions, cur: Math.max(0, versions.length - 1), runId: run.id });
}
