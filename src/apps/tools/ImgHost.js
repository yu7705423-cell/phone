import { html, useState, useEffect, useRef } from '../../lib.js';
import { phone, useStore } from '../../sdk/index.js';
import { Page, List, ListItem, Field, Input, Textarea, Button, Icon, Spinner, Switch, Segmented,
         EmptyState, Sheet, toast, confirm } from '../../ui/index.js';
import { OutBox, copyText, fmtTime, useToolState } from './common.js';
import { SETUP, HOST_TYPES, fieldsOf } from './imghostdata.js';

const { db, nav, toolbox, imghost: IH } = phone;

// 图床。见 ARCHITECTURE 4.248
//
// 用户要求：搭建教程每一步都能点击跳转，复制完回来直接填上；加一个「我的图床」；
// 把用户自己的「图床搬家工具」（changephoto）也做进来。
//
//   /imghost                     我的图床：已搭好的图床、添加图床、中转 Worker、搬家、上传记录
//   /imghost/setup/<类型>[/<id>]  搭建向导：每一步的说明、跳转链接、要复制的代码、就地填写的输入框、测试连接
//   /imghost/host/<id>           一个图床：测试、设为默认、修改、删除、上传
//   /imghost/upload[/<id>]       直接传图拿链接
//   /imghost/move                图床搬家：代码里挖图片链接、检测、转存或配对、导出换好链接的代码
//
// 这里的请求都打到用户自己填的图床上，不调模型接口。

const typeName = t => SETUP[t]?.name || t;
const fmtBytes = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);
const pad3 = n => String(n).padStart(3, '0');

// 跳到外部网页。外壳里交给系统浏览器
const ExtLink = ({ href, label }) => html`
  <a class="btn btn-ghost btn-sm ih-ext press" href=${href} target="_blank" rel="noopener noreferrer">
    ${label}<${Icon} name="link" size=${13}/>
  </a>`;

// 一个输入框，右边「粘贴」：从别的页面复制回来，点一下填上
function PasteField({ f, value, onChange }) {
  const paste = async e => {
    e.preventDefault();
    try {
      const t = (await navigator.clipboard.readText() || '').trim();
      if (!t) { toast('剪贴板中没有文字'); return; }
      onChange(t);
      toast('已粘贴', 'ok');
    } catch { toast('无法读取剪贴板，请长按输入框粘贴'); }
  };
  if (f.type === 'select') {
    return html`<${Field} label=${f.label}>
      <${Segmented} value=${value ?? f.value ?? ''} items=${f.options} onChange=${onChange}/><//>`;
  }
  if (f.type === 'switch') {
    return html`<div class="ih-switch"><span>${f.label}</span><${Switch} checked=${!!value} onChange=${onChange}/></div>`;
  }
  return html`
    <${Field} label=${f.label}>
      <div class="tb-add-row">
        <${Input} type=${f.type === 'password' ? 'password' : 'text'} value=${value ?? ''} placeholder=${f.placeholder}
          autocomplete="off" spellcheck="false" onInput=${onChange}/>
        <${Button} size="sm" variant="ghost" onClick=${paste}>粘贴<//>
      </div>
    <//>`;
}

// Worker 代码：从本站读出来，给一个复制按钮
function WorkerCode() {
  const [code, setCode] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(new URL('worker/image-proxy.js', location.href), { cache: 'no-cache' })
      .then(r => (r.ok ? r.text() : Promise.reject(new Error(r.status))))
      .then(t => { if (live) setCode(t); })
      .catch(() => { if (live) setCode(''); });
    return () => { live = false; };
  }, []);
  return html`
    <div class="ih-code">
      <div class="btn-row is-chips">
        <${Button} size="sm" icon="copy" disabled=${!code} onClick=${() => copyText(code)}>复制 Worker 代码<//>
        <${Button} size="sm" variant="ghost" disabled=${!code} onClick=${() => setOpen(o => !o)}>${open ? '收起' : '查看代码'}<//>
      </div>
      ${!code ? html`<div class="tb-call">正在读取代码</div>` : null}
      ${open && code ? html`<div class="tb-out tb-code-view ih-pre">${code}</div>` : null}
    </div>`;
}

// ---- 我的图床 ----

export function ImgHostPage() {
  useStore(db.tools.store);
  useStore(db.toolRuns.store);
  const list = IH.hosts();
  const def = IH.defaultHost();
  const r = IH.relay();
  const runs = toolbox.runsOf('imghost');
  const recent = runs.flatMap(x => (x.output?.links || []).map(l => ({ ...l, at: x.createdAt }))).slice(0, 12);
  const [url, setUrl] = useState('');
  const [check, setCheck] = useState('');

  return html`
    <${Page} title="图床" onBack=${nav.pop}
      right=${html`<button class="nav-text press" onClick=${() => nav.push('/runs/imghost')}>记录</button>`}>
      <div class="pad">
        <div class="hint-box">
          Eira 中的图片保存在本设备，只有本机可见。分享美化包、使用「图片地址」时，图片需要放在公开地址上。
          图床上的图片任何人都可以访问，请勿上传私人照片。
        </div>
      </div>

      <${List} title=${`我的图床${list.length ? ` · ${list.length}` : ''}`}>
        ${list.length ? list.map(h => html`
          <${ListItem} key=${h.id} title=${h.name || typeName(h.type)} arrow multiline
            left=${html`<${Icon} name=${h.ok ? 'check' : 'image'} size=${18}/>`}
            subtitle=${[typeName(h.type), h.ok ? '已通过测试' : '未通过测试', def?.id === h.id ? '默认' : ''].filter(Boolean).join(' · ')}
            onClick=${() => nav.push(`/imghost/host/${h.id}`)}/>`)
        : html`<${ListItem} title="尚未添加图床" subtitle="从下方选择一种，按步骤搭建。" multiline/>`}
      <//>
      ${list.length ? html`
        <div class="pad-x"><${Button} full icon="upload" onClick=${() => nav.push('/imghost/upload')}>上传图片<//></div>` : null}

      <${List} title="添加图床">
        ${HOST_TYPES.map(t => html`
          <${ListItem} key=${t} title=${SETUP[t].name} subtitle=${`${SETUP[t].desc}。${SETUP[t].tag}`} multiline arrow
            onClick=${() => nav.push(`/imghost/setup/${t}`)}/>`)}
      <//>

      <${List} title="更多">
        <${ListItem} title="中转 Worker" arrow multiline left=${html`<${Icon} name="plug" size=${18}/>`}
          subtitle=${r.url ? `已设置：${r.url}` : '未设置。可选，用于搬家时取回跨域或防盗链的图片'}
          onClick=${() => nav.push('/imghost/setup/relay')}/>
        <${ListItem} title="图床搬家" arrow multiline left=${html`<${Icon} name="refresh" size=${18}/>`}
          subtitle="从 HTML、CSS 代码中提取全部图片链接，转存到自己的图床，导出换好链接的代码"
          onClick=${() => nav.push('/imghost/move')}/>
      <//>

      ${recent.length ? html`
        <${List} title="最近上传">
          ${recent.map((l, i) => html`
            <${ListItem} key=${`${l.url}${i}`} title=${l.name || l.url} subtitle=${l.url} multiline
              left=${html`<img class="ih-thumb" src=${l.url} alt="" referrerpolicy="no-referrer" loading="lazy"/>`}
              right=${html`<button class="press li-cut" onClick=${e => { e.stopPropagation(); copyText(l.url); }}><${Icon} name="copy" size=${15}/></button>`}/>`)}
          <${ListItem} title="全部上传记录" arrow onClick=${() => nav.push('/runs/imghost')}/>
        <//>` : null}

      <div class="pad">
        <${Field} label="检查地址" desc="粘贴图片地址，确认能否在本设备打开。能打开不代表所有网络都能打开。">
          <${Input} value=${url} placeholder="https://" onInput=${v => { setUrl(v); setCheck(''); }}/>
        <//>
        <${Button} full variant="ghost" onClick=${() => {
          if (!/^https:\/\//i.test(url.trim())) { toast('请填写以 https:// 开头的地址'); return; }
          setCheck('loading');
        }}>检查<//>
        ${check ? html`
          <div class="tb-img-check">
            <img src=${url.trim()} alt="" referrerpolicy="no-referrer" onLoad=${() => setCheck('ok')} onError=${() => setCheck('bad')}
              class=${check === 'ok' ? '' : 'is-hidden'}/>
            <div class="tb-call">${check === 'loading' ? '正在加载' : check === 'ok' ? '图片可以打开' : '无法打开该地址，请检查地址是否正确、是否已部署完成'}</div>
          </div>` : null}
      </div>
    <//>`;
}

// ---- 搭建向导 ----

export function SetupPage({ type, hostId = '' }) {
  useStore(db.tools.store);
  const def = SETUP[type];
  const editing = hostId ? IH.getHost(hostId) : null;
  const isRelay = type === 'relay';
  const init = () => {
    const base = {};
    (def?.steps || []).forEach(s => (s.fields || []).forEach(f => { if (f.value !== undefined) base[f.key] = f.value; }));
    if (isRelay) return { ...base, ...IH.draftOf('relay'), ...Object.fromEntries(Object.entries(IH.relay()).filter(([, v]) => v)) };
    if (editing) return { ...base, ...editing.cfg };
    return { ...base, ...IH.draftOf(type) };
  };
  const [cfg, setCfg] = useState(init);
  const [name, setName] = useState(() => editing?.name || '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, msg }

  if (!def) return html`<${Page} title="搭建图床" onBack=${nav.pop}><${EmptyState} icon="image" title="未知的图床类型"/><//>`;

  // 填一格存一格：跳去别的页面复制再回来，填过的还在
  const put = (k, v) => setCfg(c => {
    const next = { ...c, [k]: v };
    if (!editing) IH.setDraft(type, next);
    return next;
  });

  const save = (ok, msg) => {
    if (isRelay) {
      IH.setRelay({ url: cfg.url, token: cfg.token });
      toast('已保存中转 Worker', 'ok');
      nav.pop();
      return;
    }
    const row = IH.saveHost({ id: editing?.id || '', type, name: name.trim() || def.name, cfg, ok, msg });
    // R2 的 Worker 同时是中转：地址与口令一并记下
    if (type === 'r2' && String(cfg._relayUrl || '').trim()) IH.setRelay({ url: cfg._relayUrl, token: cfg._relayToken });
    if (!editing) IH.setDraft(type, {});
    toast(ok ? '已存入我的图床' : '已保存，尚未通过测试', ok ? 'ok' : 'plain');
    nav.replace(`/imghost/host/${row.id}`);
  };

  const run = async () => {
    setBusy(true); setResult(null);
    try {
      const msg = await IH.test(type, cfg);
      setResult({ ok: true, msg });
      save(true, msg);
    } catch (e) {
      setResult({ ok: false, msg: String(e.message || e) });
    } finally { setBusy(false); }
  };

  const n = def.steps.length;
  return html`
    <${Page} title=${editing ? `修改 · ${editing.name || def.name}` : def.name} onBack=${nav.pop}>
      <div class="pad">
        <div class="hint-box">${def.lead}</div>
        ${def.steps.map((s, i) => html`
          <div key=${i} class="ih-step">
            <div class="ih-step-n">${i + 1}</div>
            <div class="ih-step-body">
              <div class="ih-step-title">${s.title}</div>
              ${s.text ? html`<div class="ih-step-text">${s.text}</div>` : null}
              ${s.links?.length ? html`<div class="ih-links">${s.links.map(l => html`<${ExtLink} key=${l.href} ...${l}/>`)}</div>` : null}
              ${s.code === 'worker' ? html`<${WorkerCode}/>` : null}
              ${s.note ? html`<div class="hint-box ih-note">${s.note}</div>` : null}
              ${s.warn ? html`<div class="warn-box ih-note">${s.warn}</div>` : null}
              ${(s.fields || []).map(f => html`<${PasteField} key=${f.key} f=${f} value=${cfg[f.key]} onChange=${v => put(f.key, v)}/>`)}
            </div>
          </div>`)}
        <div class="ih-step">
          <div class="ih-step-n">${n + 1}</div>
          <div class="ih-step-body">
            <div class="ih-step-title">测试连接并保存</div>
            ${!isRelay ? html`
              <${Field} label="名称" desc="显示在「我的图床」中。可留空。">
                <${Input} value=${name} placeholder=${def.name} onInput=${setName}/>
              <//>` : null}
            <${Button} full disabled=${busy} onClick=${run}>${busy ? html`<${Spinner} size=${15}/> 正在测试` : '测试连接并保存'}<//>
            ${result ? html`<div class=${result.ok ? 'hint-box ih-note' : 'warn-box ih-note'}>${result.msg}</div>` : null}
            ${result && !result.ok ? html`
              <${Button} full variant="ghost" onClick=${() => save(false, result.msg)}>仍然保存（未通过测试）<//>` : null}
          </div>
        </div>
        ${def.warn ? html`<div class="warn-box">${def.warn}</div>` : null}
      </div>
    <//>`;
}

// ---- 一个图床 ----

export function HostPage({ id }) {
  useStore(db.tools.store);
  const h = IH.getHost(id);
  const [busy, setBusy] = useState(false);
  if (!h) return html`<${Page} title="图床" onBack=${nav.pop}><${EmptyState} icon="image" title="该图床已被删除"/><//>`;
  const isDef = IH.defaultHost()?.id === h.id;
  const retest = async () => {
    setBusy(true);
    try {
      const msg = await IH.test(h.type, h.cfg);
      IH.saveHost({ ...h, ok: true, msg });
      toast('测试通过', 'ok');
    } catch (e) {
      IH.saveHost({ ...h, ok: false, msg: String(e.message || e) });
      toast(String(e.message || e), 'error', 6000);
    } finally { setBusy(false); }
  };
  const del = async () => {
    if (!await confirm({ title: `删除「${h.name || typeName(h.type)}」`, message: '只从 Eira 中移除这份配置，已经上传的图片不受影响。', okText: '删除', danger: true })) return;
    IH.removeHost(h.id);
    nav.pop();
  };
  return html`
    <${Page} title=${h.name || typeName(h.type)} onBack=${nav.pop}>
      <${List}>
        <${ListItem} title="类型" right=${typeName(h.type)}/>
        <${ListItem} title="状态" subtitle=${h.msg || ''} multiline right=${h.ok ? '已通过测试' : '未通过测试'}/>
        ${h.testedAt ? html`<${ListItem} title="测试时间" right=${fmtTime(h.testedAt)}/>` : null}
        <${ListItem} title="设为默认" subtitle="上传图片与图床搬家时默认选用" multiline
          right=${html`<${Switch} checked=${isDef} onChange=${v => v && IH.setDefault(h.id)}/>`}/>
      <//>
      <div class="pad">
        <${Button} full icon="upload" onClick=${() => nav.push(`/imghost/upload/${h.id}`)}>上传图片<//>
      </div>
      <${List}>
        <${ListItem} title="重新测试连接" left=${html`<${Icon} name="refresh" size=${18}/>`}
          right=${busy ? html`<${Spinner} size=${15}/>` : null} onClick=${busy ? null : retest}/>
        <${ListItem} title="修改配置" arrow left=${html`<${Icon} name="edit" size=${18}/>`}
          onClick=${() => nav.push(`/imghost/setup/${h.type}/${h.id}`)}/>
        <${ListItem} title="删除" danger left=${html`<${Icon} name="trash" size=${18}/>`} onClick=${del}/>
      <//>
    <//>`;
}

// 选一个图床
const HostChips = ({ value, onChange }) => html`
  <div class="chip-row">
    ${IH.hosts().map(h => html`
      <button key=${h.id} class=${`chip${value === h.id ? ' is-active' : ''}`}
        onClick=${e => { e.preventDefault(); onChange(h.id); }}>${h.name || typeName(h.type)}</button>`)}
  </div>`;

async function uploadOne(host, blob, name) {
  const wait = IH.THROTTLE[host.type];
  const r = await IH.upload(host, blob, name);
  if (wait) await new Promise(res => setTimeout(res, wait));
  return r;
}

// ---- 直接传图 ----

export function UploadPage({ hostId = '' }) {
  useStore(db.tools.store);
  const [hid, setHid] = useState(() => hostId || IH.defaultHost()?.id || '');
  const [items, setItems] = useState([]); // { key, file, name, size, state, url, error, deleteUrl }
  const [busy, setBusy] = useState(false);
  const [fmt, setFmt] = useState('url');
  const fileRef = useRef(null);
  const stopRef = useRef(false);
  const host = IH.getHost(hid);

  if (!IH.hosts().length) {
    return html`<${Page} title="上传图片" onBack=${nav.pop}>
      <${EmptyState} icon="image" title="尚未添加图床" desc="请先在「图床」中按步骤搭建一个。"
        action=${html`<${Button} size="sm" onClick=${() => nav.replace('/imghost')}>去添加<//>`}/><//>`;
  }

  const add = files => {
    const list = [...files].filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg|heic)$/i.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!list.length) { toast('没有可上传的图片'); return; }
    setItems(cur => [...cur, ...list.map((f, i) => ({ key: `${Date.now()}${i}${f.name}`, file: f, name: f.name, size: f.size, state: 'wait' }))]);
  };

  const pasteImages = async () => {
    try {
      const got = [];
      for (const it of await navigator.clipboard.read()) {
        const t = it.types.find(x => x.startsWith('image/'));
        if (t) { const b = await it.getType(t); got.push(new File([b], `paste-${Date.now()}.${t.split('/')[1] || 'png'}`, { type: t })); }
      }
      if (got.length) add(got); else toast('剪贴板中没有图片');
    } catch { toast('无法读取剪贴板中的图片，请改用选择文件'); }
  };

  const patch = (key, p) => setItems(cur => cur.map(x => (x.key === key ? { ...x, ...p } : x)));

  const start = async (only) => {
    if (!host) { toast('请先选择图床'); return; }
    stopRef.current = false;
    setBusy(true);
    const todo = items.filter(x => (only ? only.includes(x.key) : x.state !== 'done'));
    const done = [];
    for (const it of todo) {
      if (stopRef.current) break;
      patch(it.key, { state: 'up', error: '' });
      try {
        const r = await uploadOne(host, it.file, it.name);
        patch(it.key, { state: 'done', url: r.url, deleteUrl: r.deleteUrl || '', note: r.note || '' });
        done.push({ name: it.name, url: r.url, deleteUrl: r.deleteUrl || '' });
      } catch (e) {
        patch(it.key, { state: 'fail', error: String(e.message || e) });
      }
    }
    if (done.length) {
      toolbox.addRun('imghost', {
        title: `${host.name || typeName(host.type)} · ${done.length} 张`,
        output: { text: done.map(x => x.url).join('\n'), links: done, host: host.name || typeName(host.type) },
      });
    }
    setBusy(false);
  };

  const ok = items.filter(x => x.state === 'done');
  const failed = items.filter(x => x.state === 'fail');
  const STATE = { wait: '待上传', up: '正在上传', done: '已上传', fail: '失败' };

  return html`
    <${Page} title="上传图片" onBack=${nav.pop}>
      <div class="pad">
        <${Field} label="上传到"><${HostChips} value=${hid} onChange=${setHid}/><//>
        <div class="btn-row">
          <${Button} variant="ghost" icon="image" onClick=${() => fileRef.current?.click()}>选择图片<//>
          <${Button} variant="ghost" icon="copy" onClick=${pasteImages}>粘贴图片<//>
        </div>
        <input ref=${fileRef} type="file" accept="image/*" multiple hidden onChange=${e => { add(e.target.files || []); e.target.value = ''; }}/>
        <div class="tb-call">按文件名排序上传。文件名中的中文与空格会换成短横线，以免地址需要转码。</div>
      </div>
      ${items.length ? html`
        <${List} title=${`共 ${items.length} 张 · 已上传 ${ok.length}${failed.length ? ` · 失败 ${failed.length}` : ''}`}>
          ${items.map(it => html`
            <${ListItem} key=${it.key} title=${it.name} multiline
              subtitle=${[`${fmtBytes(it.size)} · ${STATE[it.state]}`, it.url || '', it.note || '', it.error || ''].filter(Boolean).join('\n')}
              left=${it.url ? html`<img class="ih-thumb" src=${it.url} alt="" referrerpolicy="no-referrer"/>` : html`<${Icon} name="image" size=${18}/>`}
              right=${it.url ? html`<button class="press li-cut" onClick=${() => copyText(it.url)}><${Icon} name="copy" size=${15}/></button>`
                : it.state === 'wait' && !busy ? html`<button class="press li-cut" onClick=${() => setItems(c => c.filter(x => x.key !== it.key))}><${Icon} name="close" size=${15}/></button>` : null}/>`)}
        <//>
        <div class="pad">
          ${busy ? html`<${Button} full variant="ghost" onClick=${() => { stopRef.current = true; }}><${Spinner} size=${15}/> 正在上传，点此停止<//>`
            : html`<${Button} full disabled=${!items.some(x => x.state !== 'done')} onClick=${() => start()}>开始上传<//>`}
          ${failed.length && !busy ? html`<div class="pad-t"><${Button} full variant="ghost" onClick=${() => start(failed.map(x => x.key))}>重试失败的 ${failed.length} 张<//></div>` : null}
        </div>` : null}
      ${ok.length ? html`
        <div class="pad-x">
          <${Field} label="链接格式"><${Segmented} value=${fmt} items=${IH.FORMATS.map(x => ({ value: x.id, label: x.label }))} onChange=${setFmt}/><//>
          <${OutBox} title=${`新链接 · ${ok.length}`} text=${IH.formatLinks(ok, fmt)}/>
        </div>` : null}
    <//>`;
}

// ---- 图床搬家 ----
//
// 三步：代码（贴进来或选文件）、图片（检测、转存或手动配对）、导出（换好链接的代码、对照表、新链接列表）。
// 贴进来的代码与挖出来的链接随手存下，切走再回来接着做。图片本身不存，要用时再取。

const MOVE_DEF = { sources: [], base: '', items: [], tab: 'code', total: 0, unresolved: 0 };
const CODE_ACCEPT = '.css,.scss,.less,.html,.htm,.md,.txt,.xml,.svg,.json';

export function MovePage() {
  useStore(db.tools.store);
  const [f, set] = useToolState('imghost-move', MOVE_DEF);
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState('');
  const [prog, setProg] = useState('');
  const [hid, setHid] = useState(() => IH.defaultHost()?.id || '');
  const [matchOpen, setMatchOpen] = useState(false);
  const [newLines, setNewLines] = useState('');
  const [fmt, setFmt] = useState('url');
  const fileRef = useRef(null);
  const stopRef = useRef(false);

  const items = f.items || [];
  const sel = items.filter(it => it.sel !== false);
  const patchItem = (id, p) => set(s => ({ items: s.items.map(it => (it.id === id ? { ...it, ...p } : it)) }));

  const addFiles = async files => {
    const got = [];
    for (const file of files) got.push({ name: file.name, text: await file.text() });
    if (got.length) set(s => ({ sources: [...s.sources, ...got] }));
  };
  const addPaste = () => {
    if (!paste.trim()) { toast('请先粘贴代码'); return; }
    set(s => ({ sources: [...s.sources, { name: `粘贴的代码 ${s.sources.length + 1}.html`, text: paste }] }));
    setPaste('');
  };

  const doExtract = () => {
    if (!f.sources.length) { toast('请先添加代码'); return; }
    const r = IH.extract(f.sources, { baseUrl: f.base });
    if (!r.items.length) { toast('没有找到图片链接'); return; }
    set({ items: r.items.map(it => ({ ...it, sel: !!it.url })), total: r.total, unresolved: r.unresolved, tab: 'img' });
    toast(`找到 ${r.items.length} 张图片，共 ${r.total} 处`, 'ok');
  };

  // 并发跑一批，边跑边写进度
  const pool = async (list, n, fn) => {
    let i = 0; let done = 0;
    const one = async () => {
      while (i < list.length && !stopRef.current) {
        const it = list[i++];
        await fn(it);
        done += 1;
        setProg(`${done} / ${list.length}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(n, list.length) }, one));
  };

  const probeAll = async () => {
    stopRef.current = false;
    setBusy('probe');
    await pool(items.filter(it => it.url), 6, async it => {
      const r = await IH.probe(it.url);
      patchItem(it.id, r.ok ? { status: 'ok', w: r.w, h: r.h } : { status: 'bad', reason: r.reason });
    });
    setBusy(''); setProg('');
  };

  const transfer = async (list) => {
    const host = IH.getHost(hid);
    if (!host) { toast('请先选择图床'); return; }
    stopRef.current = false;
    setBusy('up');
    const done = [];
    await pool(list, IH.THROTTLE[host.type] ? 1 : 3, async it => {
      patchItem(it.id, { upError: '' });
      const got = await IH.fetchBlob(it.url);
      if (!got.ok) { patchItem(it.id, { upError: got.error }); return; }
      const name = `${pad3(it.index)}-${IH.safeName((it.url.split('/').pop() || 'image').split(/[?#]/)[0])}`;
      try {
        const r = await uploadOne(host, got.blob, name);
        patchItem(it.id, { newUrl: r.url, conf: 'manual', why: ['由 Eira 上传'] });
        done.push({ name, url: r.url, deleteUrl: r.deleteUrl || '' });
      } catch (e) { patchItem(it.id, { upError: String(e.message || e) }); }
    });
    if (done.length) {
      toolbox.addRun('imghost', { title: `图床搬家 · ${done.length} 张`,
        output: { text: done.map(x => x.url).join('\n'), links: done, host: host.name || typeName(host.type) } });
    }
    setBusy(''); setProg('');
  };

  const saveOriginals = async () => {
    stopRef.current = false;
    setBusy('zip');
    const out = [];
    const rows = [['序号', '文件名', '原链接', '状态']];
    await pool(sel.filter(it => it.url), 4, async it => {
      const got = await IH.fetchBlob(it.url);
      const ext = (got.blob?.type || '').split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') || 'png';
      const name = `${pad3(it.index)}.${ext}`;
      if (got.ok) out.push({ name, blob: got.blob });
      rows.push([pad3(it.index), got.ok ? name : '', it.url, got.ok ? '已保存' : got.error]);
    });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    out.push({ name: '清单.csv', blob: new Blob([`﻿${csv}`], { type: 'text/csv' }) });
    try { toast(`已导出 ${await toolbox.exportZipBlobs('原图', out.sort((a, b) => a.name.localeCompare(b.name)))}`, 'ok'); }
    catch (e) { toast(String(e.message || e), 'error'); }
    setBusy(''); setProg('');
  };

  // 手动传到别处后，把新链接粘回来自动配对：图像指纹 > 文件名 > 尺寸 > 顺序
  const autoMatch = async () => {
    const lines = newLines.split(/\s+/).map(x => x.trim()).filter(x => /^https?:\/\//i.test(x));
    if (!lines.length) { toast('请粘贴新链接，一行一个'); return; }
    setBusy('match');
    const olds = sel.filter(it => it.url);
    const news = lines.map(url => ({ url }));
    let n = 0;
    const total = olds.length + news.length;
    for (const o of olds) { if (stopRef.current) break; const h = await IH.hashFromUrl(o.url); o.hash = h.hash; o.w = o.w || h.w; o.h = o.h || h.h; setProg(`${++n} / ${total}`); }
    for (const x of news) { if (stopRef.current) break; const h = await IH.hashFromUrl(x.url); x.hash = h.hash; x.w = h.w; x.h = h.h; setProg(`${++n} / ${total}`); }
    const m = IH.matchAuto(olds, news);
    set(s => ({ items: s.items.map(it => {
      const p = m.pairs[it.id];
      return p ? { ...it, newUrl: news[p.ni].url, conf: p.conf, why: p.why } : it;
    }) }));
    setBusy(''); setProg('');
    setMatchOpen(false);
    toast(`已配对 ${Object.keys(m.pairs).length} 张${m.pool.length ? `，${m.pool.length} 个新链接未用上` : ''}。可逐张检查并修改`, 'ok', 4000);
  };

  const outOf = i => IH.replaceAll(f.sources[i].text, items, i);
  const outName = n => { const m = String(n).match(/^(.*?)(\.[^.]+)?$/); return `${m[1]}-已替换${m[2] || '.txt'}`; };
  const mapCsv = () => [['序号', '原链接', '新链接', '依据', '可信度'],
    ...items.map(it => [pad3(it.index), it.url || it.raw, it.newUrl || '', (it.why || []).join('、'), IH.CONF[it.conf] || ''])]
    .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const mapMd = () => ['| 序号 | 原链接 | 新链接 | 可信度 |', '|---|---|---|---|',
    ...items.map(it => `| ${pad3(it.index)} | ${it.url || it.raw} | ${it.newUrl || ''} | ${IH.CONF[it.conf] || ''} |`)].join('\n');
  const changed = items.filter(it => it.newUrl && it.newUrl !== it.url);

  const reset = async () => {
    if (!await confirm({ title: '清空重来', message: '贴进来的代码与提取、配对的结果将全部清空。', okText: '清空', danger: true })) return;
    set({ ...MOVE_DEF });
  };

  const status = it => (it.status === 'ok' ? `可以加载 · ${it.w}×${it.h}` : it.status === 'bad' ? `已失效 · ${it.reason || ''}` : it.url ? '未检测' : '相对链接，无法解析');

  return html`
    <${Page} title="图床搬家" onBack=${nav.pop}
      right=${f.sources.length ? html`<button class="nav-text press" onClick=${reset}>清空</button>` : null}>
      <div class="pad-x pad-t">
        <${Segmented} value=${f.tab} onChange=${v => set({ tab: v })}
          items=${[{ value: 'code', label: '1 代码' }, { value: 'img', label: `2 图片${items.length ? ` · ${items.length}` : ''}` }, { value: 'out', label: '3 导出' }]}/>
      </div>

      ${f.tab === 'code' ? html`
        <div class="pad">
          <div class="hint-box">把含有图片的 HTML、CSS 或 Markdown 贴进来，或一次选择多个代码文件。每个文件各自替换、各自导出。</div>
          <${Field} label="粘贴代码">
            <${Textarea} rows=${6} class="tb-code" value=${paste} onInput=${setPaste} placeholder="<style>…</style>"/>
          <//>
          <div class="btn-row">
            <${Button} variant="ghost" onClick=${addPaste}>加入这段代码<//>
            <${Button} variant="ghost" icon="upload" onClick=${() => fileRef.current?.click()}>选择代码文件<//>
          </div>
          <input ref=${fileRef} type="file" multiple accept=${CODE_ACCEPT} hidden onChange=${e => { addFiles([...(e.target.files || [])]); e.target.value = ''; }}/>
        </div>
        ${f.sources.length ? html`
          <${List} title=${`代码 · ${f.sources.length}`}>
            ${f.sources.map((s, i) => html`
              <${ListItem} key=${i} title=${s.name} subtitle=${`${s.text.length} 字符`}
                right=${html`<button class="press li-cut" onClick=${() => set(x => ({ sources: x.sources.filter((_, j) => j !== i), items: [] }))}><${Icon} name="close" size=${15}/></button>`}/>`)}
          <//>` : null}
        <div class="pad">
          <${Field} label="基准地址" desc="代码里有相对链接（如 images/a.png）时，填写原网页地址即可解析。可留空。">
            <${Input} value=${f.base} placeholder="https://example.com/page/" onInput=${v => set({ base: v })}/>
          <//>
          <${Button} full onClick=${doExtract}>提取图片链接<//>
        </div>` : null}

      ${f.tab === 'img' ? html`
        ${!items.length ? html`<${EmptyState} icon="image" title="尚未提取" desc="请先在「代码」中加入代码并提取。"/>` : html`
          <div class="pad">
            <div class="tb-call">共 ${f.total} 处，${items.length} 张不同的图片${f.unresolved ? `，${f.unresolved} 处相对链接无法解析` : ''}。已选 ${sel.length} 张</div>
            <div class="btn-row pad-t">
              <${Button} size="sm" variant="ghost" onClick=${() => set(s => ({ items: s.items.map(it => ({ ...it, sel: !!it.url })) }))}>全选<//>
              <${Button} size="sm" variant="ghost" onClick=${() => set(s => ({ items: s.items.map(it => ({ ...it, sel: false })) }))}>全不选<//>
              <${Button} size="sm" variant="ghost" disabled=${!!busy} onClick=${probeAll}>检测是否可用<//>
              <${Button} size="sm" variant="ghost" disabled=${!!busy} onClick=${saveOriginals}>保存原图 ZIP<//>
            </div>
            ${busy ? html`<div class="tb-call"><${Spinner} size=${13}/> ${prog} <button class="tb-out-copy press" onClick=${() => { stopRef.current = true; }}>停止</button></div>` : null}
          </div>
          <div class="ih-grid">
            ${items.map(it => html`
              <div key=${it.id} class=${`ih-cell${it.sel === false ? ' is-off' : ''}`}>
                <div class="ih-cell-img" onClick=${() => it.url && patchItem(it.id, { sel: it.sel === false })}>
                  ${it.url ? html`<img src=${it.url} alt="" referrerpolicy="no-referrer" loading="lazy"/>` : html`<${Icon} name="image" size=${22}/>`}
                  <span class="ih-cell-n">${pad3(it.index)}</span>
                  ${it.sel !== false && it.url ? html`<span class="ih-cell-on"><${Icon} name="check" size=${12}/></span>` : null}
                </div>
                <div class="ih-cell-meta">${status(it)} · ${it.occurrences.length} 处</div>
                ${it.newUrl ? html`<div class="ih-cell-new">新：${it.newUrl}${it.conf ? `（${IH.CONF[it.conf]}${it.why?.length ? `，${it.why.join('、')}` : ''}）` : ''}</div>` : null}
                ${it.upError ? html`<div class="ih-cell-err">${it.upError}</div>` : null}
                <input class="ih-cell-input" value=${it.newUrl || ''} placeholder="新链接，可手动填写"
                  onInput=${e => patchItem(it.id, { newUrl: e.target.value.trim(), conf: 'manual', why: ['手动填写'] })}/>
              </div>`)}
          </div>
          <div class="pad">
            <${Field} label="方式一：由 Eira 转存到我的图床" desc=${IH.hosts().length ? '逐张取回原图再上传。取不回的图片（跨域或防盗链）配置中转 Worker 后可以取回。' : '尚未添加图床。'}>
              ${IH.hosts().length ? html`<${HostChips} value=${hid} onChange=${setHid}/>` : html`<${Button} size="sm" variant="ghost" onClick=${() => nav.push('/imghost')}>去添加图床<//>`}
            <//>
            <${Button} full disabled=${!!busy || !IH.hosts().length || !sel.length} onClick=${() => transfer(sel.filter(it => it.url))}>
              ${busy === 'up' ? html`<${Spinner} size=${15}/> 正在转存 ${prog}` : `转存已选的 ${sel.length} 张`}
            <//>
            ${items.some(it => it.upError) && !busy ? html`<div class="pad-t"><${Button} full variant="ghost"
              onClick=${() => transfer(items.filter(it => it.upError && it.url))}>重试失败的 ${items.filter(it => it.upError).length} 张<//></div>` : null}
            <div class="pad-t">
              <${Field} label="方式二：自己上传到别处" desc="先「保存原图 ZIP」，按 001、002 的顺序传到任意图床，再把新链接粘回来自动配对。依据依次为图像内容、文件名、尺寸与顺序，每一对标出可信度。">
                <${Button} full variant="ghost" onClick=${() => setMatchOpen(true)}>粘贴新链接并自动配对<//>
              <//>
            </div>
            <div class="pad-t"><${Button} full onClick=${() => set({ tab: 'out' })}>下一步：导出<//></div>
          </div>`}` : null}

      ${f.tab === 'out' ? html`
        ${!changed.length ? html`<${EmptyState} icon="download" title="尚无可替换的链接" desc="请先在「图片」中转存或填写新链接。"/>` : html`
          <${List} title=${`换好链接的代码 · 已替换 ${changed.length} 张`}>
            ${f.sources.map((s, i) => {
              const o = outOf(i);
              return html`
                <${ListItem} key=${i} title=${outName(s.name)} subtitle=${`替换了 ${o.count} 处`}
                  right=${html`<span class="ih-row-acts">
                    <button class="tb-out-copy press" onClick=${() => copyText(o.text)}>复制</button>
                    <button class="tb-out-copy press" onClick=${() => toolbox.downloadText(outName(s.name), o.text)}>下载</button>
                  </span>`}/>`;
            })}
          <//>
          <div class="pad">
            <div class="btn-row">
              <${Button} variant="ghost" onClick=${() => toolbox.downloadText('新旧链接对照.csv', `﻿${mapCsv()}`, 'text/csv;charset=utf-8')}>对照表 CSV<//>
              <${Button} variant="ghost" onClick=${() => toolbox.downloadText('新旧链接对照.md', mapMd())}>对照表 Markdown<//>
            </div>
            <div class="pad-t"><${Field} label="新链接列表"><${Segmented} value=${fmt} items=${IH.FORMATS.map(x => ({ value: x.id, label: x.label }))} onChange=${setFmt}/><//></div>
            <${OutBox} title=${`新链接 · ${changed.length}`} text=${IH.formatLinks(changed.map(it => ({ url: it.newUrl, name: pad3(it.index) })), fmt)}/>
          </div>`}` : null}

      <${Sheet} open=${matchOpen} onClose=${() => { stopRef.current = true; setMatchOpen(false); }} title="粘贴新链接并自动配对" height="80%">
        <div class="hint-box">一行一个新链接。读不到图片内容时（跨域），依次按文件名、尺寸与顺序推测，可信度相应降低。配对结果可在每张图下方修改。</div>
        <${Textarea} rows=${8} class="tb-code" value=${newLines} onInput=${setNewLines} placeholder="https://…"/>
        <div class="sheet-acts">
          <${Button} disabled=${busy === 'match'} onClick=${autoMatch}>${busy === 'match' ? html`<${Spinner} size=${15}/> 正在比对 ${prog}` : '自动配对'}<//>
        </div>
      <//>
    <//>`;
}
