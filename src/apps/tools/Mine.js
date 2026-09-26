import { html, useState, useRef, useEffect } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, Button, Icon, Spinner, Switch,
         Segmented, Sheet, EmptyState, toast, confirm, prompt } from '../../ui/index.js';
import { CharPicker, BookPicker, OutBox, CallNote, charText, bookText, charCopy, bookCopy,
         copyText, fmtTime } from './common.js';

const { db, nav, ai, toolbox, sandbox, lorefile } = phone;

// 用户自己的工具：添加、导入、编辑、运行、历史。见 ARCHITECTURE 4.247

const ICONS = ['sparkle', 'tool', 'code', 'book', 'users', 'compass', 'film', 'notes',
  'star', 'heart', 'image', 'map', 'brain', 'moon', 'music', 'gift'];

// 网页工具能做什么、不能做什么。导入确认页、编辑页、运行页顶上都是这一段
export const WEB_RULES = '网页工具在隔离环境中运行：无法读取应用内的聊天、角色、接口密钥等任何数据，'
  + '无法连接网络，也无法跳转应用的页面。它需要角色或世界书时，由你当场选择，只交给它所选的那一份副本；'
  + '它要保存内容时，先经确认页。Eira 不会在工具中要求填写接口密钥。';

// 导入的草稿：选文件在「添加」页，确认在下一页，中间隔着一次导航
let draft = null;
let draftNo = 0;
export const draftKey = () => draftNo;

// ---- 添加 ----

export function AddPage() {
  const fileRef = useRef(null);

  const take = d => { draft = d; draftNo += 1; nav.push('/import'); };

  const pick = async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try { take(await toolbox.readFile(f)); } catch (err) { toast(String(err.message || err), 'error', 5000); }
  };

  const paste = async () => {
    const text = await prompt({ title: '粘贴导入', multiline: true, okText: '读取',
      message: '粘贴 Eira 工具文件中 BEGIN 一行到 END 一行的全部内容，或一整段 HTML。' });
    if (!text) return;
    try { take(toolbox.parse(text)); } catch (err) { toast(String(err.message || err), 'error', 5000); }
  };

  return html`
    <${Page} title="添加工具" onBack=${nav.pop}>
      <${List} title="新建">
        ${toolbox.KINDS.map(k => html`
          <${ListItem} key=${k.id} title=${k.label} subtitle=${k.desc} multiline arrow
            left=${html`<${Icon} name=${k.icon} size=${18}/>`}
            onClick=${() => nav.push(`/new/${k.id}`)}/>`)}
      <//>
      <${List} title="导入他人分享的工具">
        <${ListItem} title="从文件导入" subtitle="支持 Eira 工具文件（txt、docx）与 .html 文件" multiline arrow
          left=${html`<${Icon} name="upload" size=${18}/>`}
          onClick=${() => fileRef.current?.click()}/>
        <${ListItem} title="粘贴导入" subtitle="粘贴工具文件的内容或一段 HTML" multiline arrow
          left=${html`<${Icon} name="copy" size=${18}/>`}
          onClick=${paste}/>
      <//>
      <div class="pad-x"><div class="hint-box">${WEB_RULES}</div></div>
      <input ref=${fileRef} type="file" accept=${toolbox.ACCEPT} hidden onChange=${pick}/>
    <//>`;
}

// ---- 导入前先看一眼 ----

export function ImportPage() {
  const d = draft;
  const [source, setSource] = useState(false);
  if (!d) {
    return html`<${Page} title="导入工具" onBack=${nav.pop}>
      <${EmptyState} icon="tool" title="没有待导入的工具"/><//>`;
  }
  const web = d.kind === 'web';
  const add = () => {
    const t = toolbox.create({ ...d, allowAI: false });
    draft = null;
    toast(`已添加 ${t.name}`, 'ok');
    nav.replace(`/t/${t.id}`);
  };
  const size = n => (n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} 字节`);
  return html`
    <${Page} title="导入工具" onBack=${nav.pop}>
      <${List}>
        <${ListItem} title="名称" right=${d.name || '未命名'}/>
        <${ListItem} title="种类" right=${web ? '网页工具' : '提示词工具'}/>
        ${d.author ? html`<${ListItem} title="作者" right=${d.author}/>` : null}
        ${d.desc ? html`<${ListItem} title="说明" subtitle=${d.desc} multiline/>` : null}
        ${web ? html`<${ListItem} title="大小" right=${size(new Blob([d.html || '']).size)}/>`
          : html`<${ListItem} title="输入项" subtitle=${(d.inputs || []).map(x => x.label).join('、') || '无'} multiline/>`}
      <//>
      ${web ? html`
        <div class="pad-x">
          <div class="hint-box">${WEB_RULES}</div>
          <div class="hint-box">导入后，「允许调用接口」默认关闭。需要时在该工具的编辑页开启。</div>
        </div>
        <${List}>
          <${ListItem} title="查看源码" arrow left=${html`<${Icon} name="code" size=${18}/>`}
            onClick=${() => setSource(true)}/>
        <//>`
      : html`
        <${List} title="指令">
          <div class="tb-out tb-out-plain">${d.prompt || '（空）'}</div>
        <//>`}
      <div class="pad">
        <${Button} full onClick=${add}>添加到工具箱<//>
      </div>
      <${Sheet} open=${source} onClose=${() => setSource(false)} title="源码" height="86%">
        <div class="tb-out tb-code-view">${d.html || ''}</div>
      <//>
    <//>`;
}

// ---- 新建与编辑 ----

export function EditPage({ id, kind }) {
  useStore(db.tools.store);
  const cur = id ? toolbox.get(id) : null;
  const k = cur?.kind || (kind === 'web' ? 'web' : 'prompt');
  const [f, setF] = useState(() => (cur ? { ...cur, inputs: [...(cur.inputs || [])] } : {
    kind: k, name: '', desc: '', icon: k === 'web' ? 'code' : 'sparkle', prompt: '',
    inputs: k === 'prompt' ? [{ id: 'in1', label: '内容', type: 'long', hint: '' }] : [],
    html: '', allowAI: false,
  }));
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef(null);
  const set = patch => setF(s => ({ ...s, ...patch }));

  if (id && !cur) {
    return html`<${Page} title="编辑工具" onBack=${nav.pop}>
      <${EmptyState} icon="tool" title="该工具已被删除"/><//>`;
  }

  const setInput = (i, patch) => set({ inputs: f.inputs.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const addInput = () => {
    const n = f.inputs.length + 1;
    set({ inputs: [...f.inputs, { id: `in${Date.now().toString(36)}`, label: `输入 ${n}`, type: 'text', hint: '' }] });
  };

  const save = () => {
    if (!String(f.name || '').trim()) { toast('请填写名称'); return; }
    if (cur) {
      toolbox.update(cur.id, { name: f.name.trim(), desc: f.desc, icon: f.icon,
        prompt: f.prompt, inputs: f.inputs, html: f.html, allowAI: f.allowAI });
      toast('已保存', 'ok');
      nav.pop();
    } else {
      const t = toolbox.create(f);
      nav.replace(`/t/${t.id}`);
    }
  };

  const del = async () => {
    if (!await confirm({ title: `删除「${cur.name}」`, message: '该工具与它的全部历史记录将一并删除。', okText: '删除', danger: true })) return;
    toolbox.remove(cur.id);
    toast('已删除');
    nav.popToRoot();
  };

  const pickFile = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    set({ html: text, name: f.name || file.name.replace(/\.[^.]+$/, '') });
  };

  const doExport = async fmt => {
    setExporting(false);
    try { toast(`已导出 ${await toolbox.exportTool({ ...cur, ...f }, fmt)}`, 'ok'); }
    catch (err) { toast(String(err.message || err), 'error'); }
  };

  return html`
    <${Page} title=${cur ? '编辑工具' : (k === 'web' ? '新建网页工具' : '新建提示词工具')} onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${save}>保存</button>`}>
      <div class="pad">
        <${Field} label="名称">
          <${Input} value=${f.name} placeholder="必填" onInput=${v => set({ name: v })}/>
        <//>
        <${Field} label="说明" desc="显示在工具箱列表中的一句话。">
          <${Input} value=${f.desc} placeholder="可留空" onInput=${v => set({ desc: v })}/>
        <//>
        <${Field} label="图标">
          <div class="tb-icons">
            ${ICONS.map(n => html`
              <button key=${n} class=${`tb-icon press${f.icon === n ? ' is-active' : ''}`}
                onClick=${e => { e.preventDefault(); set({ icon: n }); }}>
                <${Icon} name=${n} size=${18}/>
              </button>`)}
          </div>
        <//>

        ${k === 'prompt' ? html`
          <${Field} label="指令"
            desc="写给模型的指令。可用 {{输入项名称}} 引用下方的输入项；未引用的输入项按顺序附在指令之后。">
            <${Textarea} rows=${10} value=${f.prompt} onInput=${v => set({ prompt: v })}
              placeholder="例如：根据以下角色设定，写一段该角色的日记。"/>
          <//>
          <div class="field-label">输入项</div>
          ${f.inputs.map((x, i) => html`
            <div key=${x.id} class="tb-input-row">
              <div class="tb-input-head">
                <${Input} value=${x.label} placeholder="名称" onInput=${v => setInput(i, { label: v })}/>
                <button class="press li-cut" onClick=${() => set({ inputs: f.inputs.filter((_, j) => j !== i) })}>
                  <${Icon} name="close" size=${15}/>
                </button>
              </div>
              <${Segmented} value=${x.type} items=${toolbox.INPUTS.map(t => ({ value: t.id, label: t.label }))}
                onChange=${v => setInput(i, { type: v })}/>
              ${x.type === 'text' || x.type === 'long' ? html`
                <${Input} value=${x.hint} placeholder="输入框中的提示文字，可留空"
                  onInput=${v => setInput(i, { hint: v })}/>` : null}
            </div>`)}
          <${Button} variant="ghost" size="sm" icon="plus" onClick=${addInput}>添加输入项<//>
        ` : html`
          <div class="hint-box">${WEB_RULES}</div>
          <${Field} label="HTML" desc="整页的 HTML，包括其中的样式与脚本。外部脚本、外部图片与网络请求均不可用。">
            <${Textarea} rows=${14} class="tb-code" value=${f.html} onInput=${v => set({ html: v })}
              placeholder="<!DOCTYPE html>…" spellcheck="false"/>
          <//>
          <${Button} variant="ghost" size="sm" icon="upload" onClick=${() => fileRef.current?.click()}>选择 .html 文件<//>
          <input ref=${fileRef} type="file" accept=".html,.htm,text/html" hidden onChange=${pickFile}/>
        `}
      </div>

      ${k === 'web' ? html`
        <${List} title="接口">
          <${ListItem} title="允许调用接口" multiline
            subtitle="开启后，该工具可请求应用代为调用模型接口，接口密钥不会交给工具。每次调用前均会询问，并计入用量。关闭时该工具的请求一律拒绝。"
            right=${html`<${Switch} checked=${f.allowAI} onChange=${v => set({ allowAI: v })}/>`}/>
        <//>` : null}

      ${cur ? html`
        <${List}>
          <${ListItem} title="导出分享" subtitle="导出为文件，他人可在工具箱中导入" arrow multiline
            left=${html`<${Icon} name="download" size=${18}/>`} onClick=${() => setExporting(true)}/>
          <${ListItem} title="删除工具" danger left=${html`<${Icon} name="trash" size=${18}/>`} onClick=${del}/>
        <//>` : null}

      <${Sheet} open=${exporting} onClose=${() => setExporting(false)} title="导出格式">
        <${List} inset=${false}>
          ${toolbox.EXPORTS.filter(x => !x.web || k === 'web').map(x => html`
            <${ListItem} key=${x.id} title=${x.label}
              subtitle=${x.id === 'html' ? '原样导出 HTML，可在浏览器中打开' : x.id === 'txt' ? '可直接复制全文发送' : '可用 Word 打开'}
              arrow onClick=${() => doExport(x.id)}/>`)}
        <//>
      <//>
    <//>`;
}

// ---- 运行：提示词工具 ----

export function RunPromptPage({ tool }) {
  useStore(db.toolRuns.store);
  const [vals, setVals] = useState({});
  const [picks, setPicks] = useState({});      // 输入项 id -> 角色或世界书 id
  const [picking, setPicking] = useState(null); // { id, type }
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState('');
  const keyRef = useRef('');

  const expand = () => {
    const v = { ...vals };
    tool.inputs.forEach(x => {
      if (x.type === 'character') v[x.id] = charText(db.characters.get(picks[x.id]));
      if (x.type === 'lorebook') v[x.id] = bookText(db.lorebooks.get(picks[x.id]));
    });
    return v;
  };

  const run = async () => {
    if (!ai.isConfigured()) { toast('尚未配置聊天接口', 'error', 4000); return; }
    setBusy(true); setOut('');
    keyRef.current = `tool:${tool.id}:${Date.now()}`;
    try {
      const text = String(await toolbox.runPrompt(tool, expand(), { key: keyRef.current }) || '').trim();
      setOut(text);
      const first = tool.inputs.map(x => (x.type === 'character' ? db.characters.get(picks[x.id])?.name
        : x.type === 'lorebook' ? db.lorebooks.get(picks[x.id])?.name : vals[x.id])).find(Boolean) || '';
      toolbox.addRun(tool.id, { title: String(first).replace(/\s+/g, ' ').slice(0, 30), input: { vals, picks }, output: text });
    } catch (e) {
      if (!ai.queue.isAbort(e)) toast(String(e.message || e), 'error', 6000);
    } finally { setBusy(false); }
  };

  const stop = () => { ai.queue.cancel(keyRef.current); };
  const runs = toolbox.runsOf(tool.id);

  return html`
    <${Page} title=${tool.name} onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${() => nav.push(`/edit/${tool.id}`)}>编辑</button>`}>
      <div class="pad">
        ${tool.desc ? html`<div class="hint-box">${tool.desc}</div>` : null}
        ${tool.inputs.map(x => (x.type === 'text' ? html`
          <${Field} key=${x.id} label=${x.label}>
            <${Input} value=${vals[x.id] || ''} placeholder=${x.hint} onInput=${v => setVals(s => ({ ...s, [x.id]: v }))}/>
          <//>` : x.type === 'long' ? html`
          <${Field} key=${x.id} label=${x.label}>
            <${Textarea} rows=${5} value=${vals[x.id] || ''} placeholder=${x.hint}
              onInput=${v => setVals(s => ({ ...s, [x.id]: v }))}/>
          <//>` : html`
          <${Field} key=${x.id} label=${x.label}>
            <button class="tb-pick press" onClick=${e => { e.preventDefault(); setPicking({ id: x.id, type: x.type }); }}>
              <${Icon} name=${x.type === 'character' ? 'user' : 'book'} size=${16}/>
              <span>${(x.type === 'character' ? db.characters.get(picks[x.id])?.name
                : db.lorebooks.get(picks[x.id])?.name) || (x.type === 'character' ? '选择角色' : '选择世界书')}</span>
            </button>
          <//>`))}
        ${busy ? html`
          <${Button} full variant="ghost" onClick=${stop}><${Spinner} size=${15}/> 正在生成，点此停止<//>`
          : html`<${Button} full onClick=${run}>运行<//>`}
        <${CallNote}/>
      </div>
      ${out ? html`<div class="pad-x"><${OutBox} text=${out}/></div>` : null}
      <${List}>
        <${ListItem} title="历史记录" right=${String(runs.length)} arrow
          left=${html`<${Icon} name="clock" size=${18}/>`} onClick=${() => nav.push(`/runs/${tool.id}`)}/>
      <//>
      <${CharPicker} open=${picking?.type === 'character'} onClose=${() => setPicking(null)}
        onPick=${c => setPicks(s => ({ ...s, [picking.id]: c.id }))}/>
      <${BookPicker} open=${picking?.type === 'lorebook'} onClose=${() => setPicking(null)}
        onPick=${b => setPicks(s => ({ ...s, [picking.id]: b.id }))}/>
    <//>`;
}

// ---- 运行：网页工具 ----
//
// 盒子（system/sandbox.js）+ 盒子里的 window.eira（toolbox.BRIDGE）+ 这里拿主意。
// 盒子发来的每一件事都在这里过一遍：ai 问用户、pick 由用户当场选、save 出确认页。

export function RunWebPage({ tool }) {
  const [go, setGo] = useState(() => !toolbox.stuckLast(tool.id));
  const [escaped, setEscaped] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [calls, setCalls] = useState(0);
  const [busyAI, setBusyAI] = useState(0);
  const [ask, setAsk] = useState(null);       // { prompt, resolve }
  const [picking, setPicking] = useState(null); // { kind, resolve }
  const [saving, setSaving] = useState(null);   // { kind, data, resolve }
  const frameRef = useRef(null);
  const quietRef = useRef(false);  // 本次打开期间不再询问
  const stoppedRef = useRef(false);
  const keysRef = useRef(new Set());
  const callsRef = useRef(0);

  // 卡死之后不自动再跑：开着时记一笔，正常离开清掉
  useEffect(() => (go && !escaped ? toolbox.markOpen(tool.id) : undefined), [go, escaped, nonce]);

  // 盯着它有没有把自己跳走。每换一次 iframe（nonce）拿一个新的计数
  const guardRef = useRef({ nonce: -1, fn: null });
  if (guardRef.current.nonce !== nonce) {
    guardRef.current = { nonce, fn: sandbox.escapeGuard(() => setEscaped(true)) };
  }

  // 离开这一页时，还在路上的请求一并取消
  useEffect(() => () => keysRef.current.forEach(k => ai.queue.cancel(k)), []);

  useEffect(() => {
    if (!go || escaped) return undefined;
    const reply = (id, ok, value, error) => {
      frameRef.current?.contentWindow?.postMessage({ eira: 1, id, ok, value, error }, '*');
    };
    const onMsg = async e => {
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const d = e.data;
      if (!d || d.eira !== 1 || typeof d.id !== 'number') return;
      const a = d.args || {};
      try {
        reply(d.id, true, await handle(d.op, a));
      } catch (err) {
        reply(d.id, false, null, String(err?.message || err || '失败'));
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [go, escaped, nonce, tool.allowAI]);

  const handle = async (op, a) => {
    if (op === 'ai') return callAI(a);
    if (op === 'pick') return new Promise((resolve, reject) => setPicking({ kind: a.kind, resolve, reject }));
    if (op === 'save') return new Promise((resolve, reject) => setSaving({ kind: a.kind, data: a.data, resolve, reject }));
    if (op === 'copy') { await copyText(a.text); return true; }
    if (op === 'download') {
      const name = String(a.name || 'file.txt').slice(0, 80);
      if (!await confirm({ title: '保存文件', message: `「${tool.name}」请求保存文件：${name}`, okText: '保存' })) throw new Error('已取消');
      toolbox.downloadText(name, a.text);
      return true;
    }
    throw new Error(`不支持的操作：${op}`);
  };

  const callAI = async a => {
    if (!tool.allowAI) throw new Error('该工具未获准调用接口，可在工具的编辑页开启');
    if (stoppedRef.current) throw new Error('已停止该工具的接口调用');
    if (!ai.isConfigured()) throw new Error('尚未配置聊天接口');
    if (!quietRef.current) {
      const ok = await new Promise(resolve => setAsk({ prompt: String(a.prompt || ''), resolve }));
      if (!ok) throw new Error('已拒绝');
    }
    if (stoppedRef.current) throw new Error('已停止该工具的接口调用');
    const key = `toolweb:${tool.id}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
    keysRef.current.add(key);
    callsRef.current += 1;
    setCalls(callsRef.current);
    setBusyAI(n => n + 1);
    try {
      return String(await ai.runTextTask('tool.web', {
        system: String(a.system || ''), user: String(a.prompt || ''), key, maxTokens: 4000,
      }) || '');
    } finally {
      keysRef.current.delete(key);
      setBusyAI(n => n - 1);
    }
  };

  const stopAI = () => {
    stoppedRef.current = true;
    keysRef.current.forEach(k => ai.queue.cancel(k));
    toast('已停止该工具的接口调用');
  };

  const restart = () => {
    setEscaped(false); setGo(true); stoppedRef.current = false; quietRef.current = false;
    setNonce(n => n + 1);
  };

  const bar = html`
    <div class="tb-bar">
      <${Icon} name="lock" size=${13}/>
      <span class="tb-bar-text">第三方工具 · 无法读取应用数据，无法联网</span>
      ${tool.allowAI ? html`<span class="tb-bar-count">接口 ${calls} 次</span>` : null}
      ${busyAI > 0 ? html`<button class="tb-bar-stop press" onClick=${stopAI}>停止</button>` : null}
    </div>`;

  let body;
  if (!go) {
    body = html`<${EmptyState} icon="tool" title="已暂停运行"
      desc=${`上次打开「${tool.name}」时应用停止响应。该工具可能包含死循环，已暂停自动运行。`}
      action=${html`<${Button} size="sm" onClick=${restart}>仍然运行<//>`}/>`;
  } else if (escaped) {
    body = html`<${EmptyState} icon="lock" title="已停止运行"
      desc="该工具试图打开外部网页，已被拦下并停止运行。"
      action=${html`<${Button} size="sm" variant="ghost" onClick=${restart}>重新运行<//>`}/>`;
  } else if (!String(tool.html || '').trim()) {
    body = html`<${EmptyState} icon="code" title="该工具没有内容" desc="可在编辑页中粘贴 HTML。"/>`;
  } else {
    body = html`<iframe key=${nonce} ref=${frameRef} class="tb-frame" title=${tool.name}
      sandbox=${sandbox.SANDBOX} srcdoc=${toolbox.docOf(tool)} onLoad=${guardRef.current.fn}></iframe>`;
  }

  const answer = v => { const r = ask?.resolve; setAsk(null); r?.(v); };
  const pickDone = v => { const p = picking; setPicking(null); v == null ? p?.reject(new Error('已取消')) : p?.resolve(v); };

  return html`
    <${Page} title=${tool.name} onBack=${nav.pop} noScroll headerExtra=${bar}
      right=${html`<button class="nav-text press" onClick=${() => nav.push(`/edit/${tool.id}`)}>编辑</button>`}>
      <div class="tb-frame-wrap">${body}</div>

      <${Sheet} open=${!!ask} onClose=${() => answer(false)} title=${`「${tool.name}」请求调用一次接口`}>
        <div class="hint-box">
          本次打开期间已调用 ${calls} 次。调用使用你的接口，计入用量；接口密钥不会交给工具。
        </div>
        <div class="tb-out tb-ask">${(ask?.prompt || '').slice(0, 600)}${(ask?.prompt || '').length > 600 ? '…' : ''}</div>
        <div class="sheet-acts">
          <${Button} variant="ghost" onClick=${() => answer(false)}>拒绝<//>
          <${Button} onClick=${() => answer(true)}>调用<//>
        </div>
        <div class="sheet-acts">
          <${Button} variant="outline" onClick=${() => { quietRef.current = true; answer(true); }}>调用，本次打开期间不再询问<//>
        </div>
      <//>

      <${CharPicker} open=${picking?.kind === 'character'} title=${`交给「${tool.name}」一个角色`}
        onClose=${() => pickDone(null)} onPick=${c => pickDone(charCopy(c))}/>
      <${BookPicker} open=${picking?.kind === 'lorebook'} title=${`交给「${tool.name}」一本世界书`}
        onClose=${() => pickDone(null)} onPick=${b => pickDone(bookCopy(b))}/>
      ${picking && picking.kind !== 'character' && picking.kind !== 'lorebook'
        ? html`<${TextPick} tool=${tool} onDone=${pickDone}/>` : null}

      <${SaveSheet} tool=${tool} req=${saving} onDone=${(ok, v) => {
        const s = saving; setSaving(null);
        ok ? s?.resolve(v) : s?.reject(new Error('已取消'));
      }}/>
    <//>`;
}

// 盒子要一段文字：直接弹输入框
function TextPick({ tool, onDone }) {
  useEffect(() => {
    let live = true;
    prompt({ title: `交给「${tool.name}」一段文字`, multiline: true, okText: '交给工具' })
      .then(v => { if (live) onDone(v == null ? null : String(v)); });
    return () => { live = false; };
  }, []);
  return null;
}

// 盒子要存东西：先给用户看，确定了才存。这是确认页（CLAUDE.md 第 6 条的例外）
function SaveSheet({ tool, req, onDone }) {
  if (!req) return null;
  const d = req.data && typeof req.data === 'object' ? req.data : { text: String(req.data ?? '') };
  const kind = req.kind;
  const ok = () => {
    if (kind === 'character') {
      const c = toolbox.saveCharacter(d);
      toast(`已存入联系人：${c.name}`, 'ok');
      onDone(true, { id: c.id });
    } else if (kind === 'lorebook') {
      const entryText = e => {
        const keys = Array.isArray(e?.keys) ? e.keys.map(String).filter(Boolean) : [];
        return [`## ${String(e?.title || '条目').replace(/\n/g, ' ')}`,
          ...(keys.length ? [`关键词：${keys.join('、')}`] : []), '', String(e?.content || '')].join('\n');
      };
      const text = [`# ${String(d.name || '未命名世界书').replace(/\n/g, ' ')}`,
        ...(Array.isArray(d.entries) ? d.entries : []).map(entryText)].join('\n\n');
      lorefile.setPending({ drafts: [lorefile.draftFromText(text, d.name || '', tool.name)] });
      onDone(true, { pending: true });
      phone.intent.open('lorebook', { route: '/import', back: true });
    } else {
      const r = toolbox.addRun(tool.id, { title: String(d.title || '').slice(0, 30), output: String(d.text ?? JSON.stringify(d)) });
      toast('已存入该工具的历史记录', 'ok');
      onDone(true, { id: r.id });
    }
  };
  const label = kind === 'character' ? '存为一个角色' : kind === 'lorebook' ? '存为一本世界书' : '存入历史记录';
  const preview = kind === 'character' ? charText(d)
    : kind === 'lorebook' ? bookText({ name: d.name, entries: (d.entries || []).map(e => ({ comment: e?.title, keys: e?.keys, content: e?.content })) })
      : String(d.text ?? JSON.stringify(d, null, 2));
  return html`
    <${Sheet} open=${true} onClose=${() => onDone(false)} title=${`「${tool.name}」请求${label}`} height="80%">
      <div class="hint-box">${kind === 'lorebook' ? '确定后进入世界书的导入确认页，在那里设定用途与条目设置后保存。' : '以下内容确定后保存。'}</div>
      <div class="tb-out">${preview}</div>
      <div class="sheet-acts">
        <${Button} variant="ghost" onClick=${() => onDone(false)}>取消<//>
        <${Button} onClick=${ok}>${label}<//>
      </div>
    <//>`;
}

// ---- 历史 ----

export function RunsPage({ toolId, name }) {
  useStore(db.toolRuns.store);
  const runs = toolbox.runsOf(toolId);
  const clear = async () => {
    if (!await confirm({ title: '清空历史记录', message: `共 ${runs.length} 条，清空后无法恢复。`, okText: '清空', danger: true })) return;
    toolbox.clearRuns(toolId);
  };
  return html`
    <${Page} title=${`${name || '工具'} · 历史`} onBack=${nav.pop}
      right=${runs.length ? html`<button class="nav-text press" onClick=${clear}>清空</button>` : null}>
      ${runs.length ? html`
        <${List}>
          ${runs.map(r => html`
            <${ListItem} key=${r.id} title=${r.title || '未命名'} subtitle=${fmtTime(r.createdAt)} arrow
              onClick=${() => nav.push(`/run/${r.id}`)}/>`)}
        <//>`
      : html`<${EmptyState} icon="clock" title="暂无历史记录" desc="每次生成的结果会保存在这里。"/>`}
    <//>`;
}

export function RunView({ id, load }) {
  useStore(db.toolRuns.store);
  const r = toolbox.getRun(id);
  if (!r) return html`<${Page} title="历史记录" onBack=${nav.pop}><${EmptyState} icon="clock" title="该记录已被删除"/><//>`;
  const text = typeof r.output === 'string' ? r.output : (r.output?.text || JSON.stringify(r.output, null, 2));
  const rename = async () => {
    const v = await prompt({ title: '重命名', value: r.title || '' });
    if (v != null) toolbox.updateRun(r.id, { title: v.trim() });
  };
  const del = async () => {
    if (!await confirm({ title: '删除这条记录', okText: '删除', danger: true })) return;
    toolbox.removeRun(r.id);
    nav.pop();
  };
  return html`
    <${Page} title=${r.title || '历史记录'} onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${rename}>重命名</button>`}>
      <div class="pad">
        <div class="tb-call">${fmtTime(r.createdAt)}</div>
        <${OutBox} text=${text}/>
      </div>
      <${List}>
        ${load ? html`<${ListItem} title=${load.label} arrow left=${html`<${Icon} name="undo" size=${18}/>`}
          onClick=${() => load.fn(r)}/>` : null}
        <${ListItem} title="删除这条记录" danger left=${html`<${Icon} name="trash" size=${18}/>`} onClick=${del}/>
      <//>
    <//>`;
}
