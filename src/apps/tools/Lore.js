import { html, useState, useRef, useEffect } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, Button, Icon, Spinner, Switch,
         Segmented, NumberInput, Sheet, toast, confirm } from '../../ui/index.js';
import { BookPicker, CallNote, OutBox, copyText, bookText, useToolState, loadToolState } from './common.js';

const { db, nav, ai, toolbox, lorefile, lorecheck } = phone;
const T = ai.tools;

// 世界书生成器。见 ARCHITECTURE 4.247
//
// 世界书在这里是「给模型看的运行时规约」，不是给人看的设定集。分阶段写：
// 大纲、正文、示例、自检、独立审查。只有正文那一步必做，其余每一步都是一次请求，
// 开关在表单上，按钮下面写明这一下总共几次。本地审查不调接口，每一版都跑。
//
// 每一次生成、修订、手动修改都是新的一版，旧版本不覆盖。
// 导出只有两种：存进 Eira 的世界书（先过确认页），或导出成我们自己的 txt、docx。
// 不做别家（酒馆）格式的导出（用户要求，CLAUDE.md 第 17 条同一个理由）。

const DEF = {
  title: '', question: '', tuning: '', inject: '', format: 'natural', language: '', length: 0,
  target: '', seriesIds: [],
  outline: true, pause: true, examples: false, exCount: 2, selfcheck: false, review: false,
  versions: [], cur: 0, pendingOutline: null, runId: null,
};

const FORMATS = [
  { value: 'natural', label: '自然语言' },
  { value: 'yaml', label: 'YAML' },
  { value: 'xml', label: 'XML' },
];
const STATUS = { pass: '通过', warn: '提示', fail: '不通过', skip: '未检查' };
const CLAIM = { kept: '已遵守', partly: '部分遵守', broken: '未遵守' };

export function LorePage() {
  useStore(db.lorebooks.store);
  const [f, set, fRef] = useToolState('lore', DEF);
  const [busy, setBusy] = useState('');
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(null);   // 手动修改：{ text, note }
  const [feedback, setFeedback] = useState('');
  const [withEx, setWithEx] = useState(true);
  const keyRef = useRef('');
  const stopRef = useRef(false);

  useEffect(() => () => { stopRef.current = true; if (keyRef.current) ai.queue.cancel(keyRef.current); }, []);

  const series = f.seriesIds.map(id => db.lorebooks.get(id)).filter(Boolean);
  const form = () => ({ ...fRef.current, series: series.map(bookText).join('\n\n') });
  const after = 1 + (f.examples ? 1 : 0) + (f.selfcheck ? 1 : 0) + (f.review ? 1 : 0);
  const total = (f.outline ? 1 : 0) + after;
  const v = f.versions[f.cur] || f.versions[f.versions.length - 1] || null;

  // 一个版本存进历史：整个项目一条，版本都在里面
  const keepVersion = (ver) => {
    const cur = fRef.current;
    const versions = [...cur.versions, { ...ver, n: cur.versions.length + 1, at: Date.now() }];
    let runId = cur.runId;
    const title = cur.title || cur.question.slice(0, 24) || '未命名世界书';
    const out = { text: ver.body, versions };
    if (runId && toolbox.getRun(runId)) toolbox.updateRun(runId, { title, output: out, input: { ...cur, versions: [], runId: null, loadNo: undefined } });
    else runId = toolbox.addRun('lore', { title, input: { ...cur, versions: [], runId: null, loadNo: undefined }, output: out }).id;
    set({ versions, cur: versions.length - 1, runId });
    fRef.current = { ...fRef.current, versions, runId };
    return versions.length;
  };

  const stepRef = useRef('');
  const step = async (label, fn) => {
    if (stopRef.current) throw Object.assign(new Error('已中止'), { stopped: true });
    stepRef.current = label;
    setBusy(label);
    keyRef.current = `tool-lore:${label}:${Date.now()}`;
    return fn(keyRef.current);
  };

  // 大纲之后的几步
  const finish = async (outline) => {
    const fm = form();
    const body = await step('正文', key => T.loreBody(fm, outline, { key }));
    const ver = { body, outline, examples: '', selfcheck: null, review: null, causes: '', note: '' };
    ver.audit = lorecheck.audit({ body, question: fm.question, outline, format: fm.format });
    if (fm.examples) ver.examples = await step('示例', key => T.loreExamples(body, fm.exCount, { key }));
    if (fm.selfcheck) ver.selfcheck = await step('自检', key => T.loreSelfCheck(body, { key }));
    if (fm.review) ver.review = await step('审查', key => T.loreReview(fm, body, lorecheck.auditText(ver.audit), { key }));
    const n = keepVersion(ver);
    toast(`第 ${n} 版完成，本地审查 ${ver.audit.score} 分`, 'ok', 3500);
  };

  const guard = async fn => {
    if (!ai.isConfigured()) { toast('尚未配置聊天接口', 'error', 4000); return; }
    stopRef.current = false;
    try { await fn(); }
    catch (e) {
      if (e.stopped || ai.queue.isAbort(e)) toast('已中止');
      else toast(`${stepRef.current}失败：${e.message || e}`, 'error', 6000);
    } finally { setBusy(''); }
  };

  const start = () => {
    if (!f.question.trim()) { toast('请先填写要解决的问题'); return; }
    guard(async () => {
      if (f.outline) {
        const outline = await step('大纲', key => T.loreOutline(form(), { key }));
        if (f.pause) { set({ pendingOutline: outline }); toast('大纲已生成，可先修改再继续', 'ok'); return; }
        await finish(outline);
      } else await finish('');
    });
  };

  const goOn = () => {
    const outline = f.pendingOutline || '';
    set({ pendingOutline: null });
    guard(() => finish(outline));
  };

  const stop = () => { stopRef.current = true; ai.queue.cancel(keyRef.current); };

  const revise = () => {
    if (!v) return;
    guard(async () => {
      const fm = form();
      const fb = [feedback.trim(), v.review?.biggest ? `Reviewer: ${v.review.biggest}` : ''].filter(Boolean).join('\n');
      const r = await step('修订', key => T.loreRevise(fm, v.body, fb, lorecheck.auditText(v.audit), { key }));
      const ver = { body: r.body, outline: v.outline, examples: v.examples, selfcheck: null, review: null,
        causes: r.causes, note: feedback.trim() || '按审查结论修订' };
      ver.audit = lorecheck.audit({ body: r.body, question: fm.question, outline: v.outline, format: fm.format });
      const n = keepVersion(ver);
      setFeedback('');
      toast(`已存为第 ${n} 版，本地审查 ${ver.audit.score} 分`, 'ok', 3500);
    });
  };

  const saveEdit = () => {
    if (!editing || editing.text === v.body) { toast('内容没有变化'); return; }
    const fm = form();
    keepVersion({ body: editing.text, outline: v.outline, examples: v.examples, selfcheck: null, review: null,
      causes: '', note: editing.note || '手动修改',
      audit: lorecheck.audit({ body: editing.text, question: fm.question, outline: v.outline, format: fm.format }) });
    setEditing(null);
  };

  const fullText = (ex) => [f.title ? `# ${f.title}` : '', v?.body || '', ex && v?.examples ? `## 示例\n${v.examples}` : '']
    .filter(Boolean).join('\n\n');

  const saveBook = () => {
    const name = f.title || '未命名世界书';
    lorefile.setPending({ drafts: [lorefile.draftFromText(fullText(withEx), name, '世界书生成器')] });
    phone.intent.open('lorebook', { route: '/import', back: true });
  };

  const exportAs = async fmt => {
    try { toast(`已导出 ${await toolbox.exportText(`世界书-${f.title || '未命名'}-第${v.n}版`, fullText(true), fmt)}`, 'ok'); }
    catch (e) { toast(String(e.message || e), 'error'); }
  };

  const newProject = async () => {
    if (f.versions.length && !await confirm({ title: '新建项目', message: '当前项目保存在历史记录中。表单与版本将清空。', okText: '新建' })) return;
    set({ ...DEF, loadNo: f.loadNo });
  };

  return html`
    <${Page} title="世界书生成器" onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${() => nav.push('/runs/lore')}>历史</button>`}>
      <div class="pad">
        <div class="hint-box">
          这里生成的世界书是给模型执行的规约，不是给人阅读的设定集。
          每一条都应写成条件、动作与程度，模型拿到之后可以直接照做。
        </div>
        <${Field} label="标题" desc="存为世界书时的书名。">
          <${Input} value=${f.title} onInput=${x => set({ title: x })}/>
        <//>
        <${Field} label="要解决的问题" desc="模型在写作中出现的问题，或需要它遵守的设定。写现象即可，生成时会翻译为可执行的规约。">
          <${Textarea} rows=${5} value=${f.question} onInput=${x => set({ question: x })}/>
        <//>
        <${Field} label="补充要求" desc="世界观基调、必须包含的设定、篇幅偏好等。可留空。">
          <${Textarea} rows=${3} value=${f.tuning} onInput=${x => set({ tuning: x })}/>
        <//>
        <${Field} label="前置注入" desc="自己写好的世界书片段。放在调用的最前面，优先级高于生成器的全部规约，冲突时以它为准。可留空。">
          <${Textarea} rows=${3} value=${f.inject} onInput=${x => set({ inject: x })}/>
        <//>
        <${Field} label="格式" desc="YAML 与 XML 便于机器解析与拆分条目；自然语言可读性最好。">
          <${Segmented} value=${f.format} items=${FORMATS} onChange=${x => set({ format: x })}/>
        <//>
        <${Field} label="语言" desc="留空则与需求使用同一种语言。">
          <${Input} value=${f.language} placeholder="例如：简体中文" onInput=${x => set({ language: x })}/>
        <//>
        <${Field} label="篇幅期望" desc="正文字数。留空表示不限，生成时不会为凑字数注水。">
          <${NumberInput} unit="字" value=${f.length} placeholder="不限" onChange=${x => set({ length: x })}/>
        <//>
        <${Field} label="目标模型" desc="这份世界书最终注入给哪个模型使用。可留空。">
          <${Input} value=${f.target} onInput=${x => set({ target: x })}/>
        <//>
      </div>

      <${List} title="同系列的世界书">
        <${ListItem} title="已有世界书" arrow multiline left=${html`<${Icon} name="book" size=${18}/>`}
          subtitle=${series.length ? series.map(b => b.name).join('、') : '可选。告知模型这些已经管理的内容，避免重复与冲突'}
          onClick=${() => setPicking(true)}/>
      <//>

      <${List} title=${`生成步骤 · 共 ${total} 次请求`}>
        <${ListItem} title="先写大纲" multiline subtitle="多一次请求。正文按大纲逐节展开，并据此计算覆盖率。关闭即快速模式"
          right=${html`<${Switch} checked=${f.outline} onChange=${x => set({ outline: x })}/>`}/>
        ${f.outline ? html`<${ListItem} title="大纲生成后先暂停" multiline subtitle="在写正文之前修改大纲。修改大纲比修改正文省事"
          right=${html`<${Switch} checked=${f.pause} onChange=${x => set({ pause: x })}/>`}/>` : null}
        <${ListItem} title="生成示例" multiline subtitle="多一次请求。写出正常、边界、易错三类示例"
          right=${html`<${Switch} checked=${f.examples} onChange=${x => set({ examples: x })}/>`}/>
        ${f.examples ? html`<div class="pad-x"><${Field} label="每类示例条数">
          <${NumberInput} unit="条" min=${1} value=${f.exCount} onChange=${x => set({ exCount: x })}/><//></div>` : null}
        <${ListItem} title="模型自检" multiline subtitle="多一次请求。模型逐条对照写作契约，说明自己是否遵守"
          right=${html`<${Switch} checked=${f.selfcheck} onChange=${x => set({ selfcheck: x })}/>`}/>
        <${ListItem} title="独立审查" multiline subtitle="多一次请求。另起一次请求，结合本地审查结果评判这一版并给出修改建议"
          right=${html`<${Switch} checked=${f.review} onChange=${x => set({ review: x })}/>`}/>
      <//>

      <div class="pad">
        ${busy ? html`<${Button} full variant="ghost" onClick=${stop}><${Spinner} size=${15}/> 正在生成${busy}，点此中止<//>`
          : f.pendingOutline != null ? null
            : html`<${Button} full onClick=${start}>开始生成<//>`}
        ${f.pendingOutline == null ? html`<${CallNote} n=${total}/>` : null}
        ${f.versions.length ? html`<div class="pad-t"><${Button} full size="sm" variant="outline" onClick=${newProject}>新建项目<//></div>` : null}
      </div>

      ${f.pendingOutline != null ? html`
        <${List} title="确认大纲"><//>
        <div class="pad-x">
          <div class="hint-box">正文将严格按这份大纲展开，并据此计算覆盖率。</div>
          <${Textarea} rows=${12} value=${f.pendingOutline} onInput=${x => set({ pendingOutline: x })}/>
          <div class="btn-row pad-t">
            <${Button} variant="ghost" onClick=${() => set({ pendingOutline: null })}>放弃<//>
            <${Button} disabled=${!!busy} onClick=${goOn}>按这份大纲写正文<//>
          </div>
          <${CallNote} n=${after}/>
        </div>` : null}

      ${v ? html`
        <${List} title="版本"><//>
        <div class="pad-x">
          <div class="chip-row">
            ${f.versions.map((x, i) => html`
              <button key=${i} class=${`chip${f.cur === i ? ' is-active' : ''}`}
                onClick=${() => set({ cur: i })}>第 ${x.n} 版 · ${x.audit?.score ?? '-'} 分</button>`)}
          </div>
          ${v.note ? html`<div class="tb-call">${v.note}</div>` : null}
        </div>

        <${List} title=${`本地审查 · ${v.audit?.score ?? '-'} 分`}>
          ${(v.audit?.items || []).map(x => html`
            <${ListItem} key=${x.id} title=${`${x.id} ${x.name}`} multiline
              subtitle=${[x.summary, ...(x.status === 'warn' || x.status === 'fail' ? (x.evidence || []).slice(0, 3).map(e => `「${e.text}」`) : []),
                x.status === 'warn' || x.status === 'fail' ? x.advice : ''].filter(Boolean).join('\n')}
              right=${html`<span class=${`tb-st tb-st-${x.status}`}>${STATUS[x.status]}</span>`}/>`)}
          <${ListItem} title="约束密度" multiline subtitle=${`每千字约 ${v.audit?.density?.perK ?? 0} 条。${v.audit?.density?.note || ''}`}/>
        <//>

        ${v.selfcheck ? html`
          <${List} title="模型自检">
            ${(v.selfcheck.items || []).map((x, i) => html`
              <${ListItem} key=${i} title=${`${x.rule || ''} ${CLAIM[x.claim] || x.claim || ''}`} subtitle=${x.note || ''} multiline/>`)}
            ${v.selfcheck.weakest ? html`<${ListItem} title="最不满意的一处" subtitle=${v.selfcheck.weakest} multiline/>` : null}
            ${v.selfcheck.left_open ? html`<${ListItem} title="留给模型发挥的部分" subtitle=${v.selfcheck.left_open} multiline/>` : null}
            ${v.selfcheck.raw ? html`<${ListItem} title="自检原文" subtitle=${v.selfcheck.raw} multiline/>` : null}
          <//>` : null}

        ${v.review ? html`
          <${List} title="独立审查">
            ${(v.review.items || []).map((x, i) => html`
              <${ListItem} key=${i} title=${`${x.rule || ''} ${x.summary || ''}`} multiline
                subtitle=${[x.evidence ? `「${x.evidence}」` : '', x.advice].filter(Boolean).join('\n')}
                right=${html`<span class=${`tb-st tb-st-${x.status}`}>${STATUS[x.status] || x.status || ''}</span>`}/>`)}
            ${v.review.biggest ? html`<${ListItem} title="最该修改的一处" subtitle=${v.review.biggest} multiline/>` : null}
            ${v.review.density ? html`<${ListItem} title="约束与发挥空间" subtitle=${v.review.density} multiline/>` : null}
            ${v.review.raw ? html`<${ListItem} title="审查原文" subtitle=${v.review.raw} multiline/>` : null}
          <//>` : null}

        ${v.causes ? html`<div class="pad-x"><${OutBox} title="根因与对策" text=${v.causes}/></div>` : null}
        <div class="pad-x">
          <${OutBox} title=${`正文 · 第 ${v.n} 版`} text=${v.body}/>
          ${v.examples ? html`<${OutBox} title="示例" text=${v.examples}/>` : null}
          ${v.outline ? html`<${OutBox} title="大纲" text=${v.outline}/>` : null}
        </div>

        <div class="pad">
          <div class="btn-row">
            <${Button} variant="ghost" onClick=${() => copyText(v.body)}>复制正文<//>
            ${v.examples ? html`<${Button} variant="ghost" onClick=${() => copyText(`${v.body}\n\n## 示例\n${v.examples}`)}>复制正文与示例<//>` : null}
            <${Button} variant="ghost" onClick=${() => setEditing({ text: v.body, note: '' })}>手动修改<//>
          </div>
        </div>

        <${List} title="修订">
          <div class="pad-x">
            <${Field} label="这一版哪里不好" desc="描述现象即可。修订时先分析根因，再给出整篇新版本；本地审查与独立审查的结论一并带上。调用一次接口。">
              <${Textarea} rows=${3} value=${feedback} onInput=${setFeedback}/>
            <//>
            <${Button} full disabled=${!!busy} onClick=${revise}>${feedback.trim() ? '按反馈修订' : '按审查结论修订'}<//>
            <${CallNote}/>
          </div>
        <//>

        <${List} title="保存">
          ${v.examples ? html`<${ListItem} title="把示例一起存进去" subtitle="示例成为单独的一个条目" multiline
            right=${html`<${Switch} checked=${withEx} onChange=${setWithEx}/>`}/>` : null}
          <${ListItem} title="存为世界书" subtitle="每个小节成为一个条目，确认页上设定用途、常驻与位置后保存" multiline arrow
            left=${html`<${Icon} name="book" size=${18}/>`} onClick=${saveBook}/>
          <${ListItem} title="导出 TXT" left=${html`<${Icon} name="download" size=${18}/>`} onClick=${() => exportAs('txt')}/>
          <${ListItem} title="导出 DOCX" left=${html`<${Icon} name="download" size=${18}/>`} onClick=${() => exportAs('docx')}/>
        <//>` : null}

      <${BookPicker} multi open=${picking} picked=${f.seriesIds} title="同系列的世界书"
        onClose=${() => setPicking(false)} onPick=${ids => set({ seriesIds: ids })}/>

      <${Sheet} open=${!!editing} onClose=${() => setEditing(null)} title=${v ? `手动修改第 ${v.n} 版` : ''} height="90%">
        ${editing ? html`
          <${Textarea} rows=${14} value=${editing.text} onInput=${x => setEditing(e => ({ ...e, text: x }))}/>
          <div class="pad-t"><${Input} value=${editing.note} placeholder="这次改了什么，可留空"
            onInput=${x => setEditing(e => ({ ...e, note: x }))}/></div>
          <div class="sheet-acts">
            <${Button} variant="ghost" onClick=${() => setEditing(null)}>取消<//>
            <${Button} onClick=${saveEdit}>存为新版本<//>
          </div>` : null}
      <//>
    <//>`;
}

export function loadLore(run) {
  const versions = run.output?.versions || [];
  loadToolState('lore', { ...DEF, ...(run.input || {}), versions, cur: Math.max(0, versions.length - 1), runId: run.id, pendingOutline: null });
}
