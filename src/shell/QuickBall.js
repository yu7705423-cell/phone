import { html, useState, useEffect, useRef, useErrorBoundary } from '../lib.js';
import { useStore } from '../system/store.js';
import { nav, goHome, back, lock, setSwitcher, openApp, push } from '../system/nav.js';
import { settings, lorebooks, characters, chats } from '../system/db/index.js';
import { useImage } from '../system/db/useImage.js';
import * as qb from '../system/quickball.js';
import * as extras from '../system/extras.js';
import * as fullscreen from '../system/fullscreen.js';
import * as svc from '../system/ai/services.js';
import * as htmlcard from '../system/htmlcard.js';
import { purposeOf } from '../system/ai/context/lorebook.js';
import { listApps, registryStore } from '../system/registry.js';
import { Icon, Switch, Segmented, Textarea, toast, confirm } from '../ui/index.js';

// 悬浮球。见 system/quickball.js 开头与 ARCHITECTURE 4.256。
//
// 挂在外壳最外层（Root），切应用、切页面都不卸载。位置每次画都按当下的屏幕重算并夹回可见区域；
// 窗口变了（横竖屏、键盘、关掉全屏、改了窗口大小）也重算。点一下展开，长按选放哪些，拖动换位置。

// ---- 能放进去的 ----
// chat: true 的只在正看着那一段对话时出现；toggle 给出开没开，面板上画成亮着或暗着
const settingsPage = r => openApp('settings', r, { back: true });
const chatOf = c => (c.chatId ? chats.get(c.chatId) : null);

const ACTIONS = [
  { id: 'lore', group: '当前对话', label: '世界书开关', icon: 'book', chat: true, panel: 'lore' },
  { id: 'reply', group: '当前对话', label: '让角色接着说', icon: 'message', chat: true, run: c => c.api?.generate() },
  { id: 'regen', group: '当前对话', label: '重新生成上一轮', icon: 'refresh', chat: true, run: c => c.api?.regenerate() },
  { id: 'narration', group: '当前对话', label: '旁白', icon: 'notes', chat: true,
    toggle: c => extras.narrationOn(chatOf(c)), run: c => extras.setNarration(c.chatId, !extras.narrationOn(chatOf(c))) },
  { id: 'inner', group: '当前对话', label: '心声', icon: 'heart', chat: true,
    toggle: c => extras.innerOn(chatOf(c)),
    run: c => extras.setInnerMode(c.chatId, extras.innerOn(chatOf(c)) ? extras.INNER_OFF : extras.INNER_INLINE) },
  { id: 'bottom', group: '当前对话', label: '回到最新', icon: 'chevronDown', chat: true, run: c => c.api?.toBottom() },
  { id: 'menu', group: '当前对话', label: '会话菜单', icon: 'more', chat: true, run: c => c.api?.openMenu() },
  { id: 'summary', group: '当前对话', label: '立即总结记忆', note: '调用一次接口', icon: 'brain', chat: true,
    run: c => c.api?.summarize() },
  { id: 'search', group: '当前对话', label: '搜索聊天记录', icon: 'search', chat: true, run: c => push(`/search/${c.chatId}`) },
  { id: 'charedit', group: '当前对话', label: '角色资料', icon: 'user', chat: true,
    run: c => (c.charId ? push(`/edit/${c.charId}`) : toast('群聊中不可用')) },
  { id: 'stage', group: '当前对话', label: '线下', icon: 'film', chat: true, run: c => push(`/stage/${c.chatId}`) },

  { id: 'model', group: '接口', label: '切换模型与接口', icon: 'layers', panel: 'model' },
  { id: 'limits', group: '接口', label: '用量与上限', icon: 'pulse', run: () => settingsPage('/limits') },
  { id: 'trace', group: '接口', label: '请求记录', icon: 'eye', run: () => settingsPage('/trace') },
  { id: 'background', group: '接口', label: '后台在做什么', icon: 'clock', run: () => settingsPage('/background') },

  { id: 'theme', group: '界面', label: '深色模式', icon: 'moon',
    toggle: () => settings.get().theme === 'dark', run: () => settings.set({ theme: settings.get().theme === 'dark' ? 'light' : 'dark' }) },
  { id: 'full', group: '界面', label: '全屏显示', icon: 'maximize',
    toggle: () => fullscreen.wantFull(), run: () => fullscreen.setFull(!fullscreen.wantFull()) },
  { id: 'reload', group: '界面', label: '重新载入', icon: 'rotateRight', run: () => location.reload() },
  { id: 'appearance', group: '界面', label: '主题设置', icon: 'sun', run: () => settingsPage('/appearance') },

  { id: 'home', group: '导航', label: '回主屏', icon: 'grid', run: () => goHome() },
  { id: 'back', group: '导航', label: '返回', icon: 'chevronLeft', run: () => back() },
  { id: 'switcher', group: '导航', label: '多任务', icon: 'folder', run: () => setSwitcher(true) },
  { id: 'lock', group: '导航', label: '锁屏', icon: 'lock', run: () => lock() },
];

// 每个应用各一项「打开」
function appActions() {
  return listApps().filter(a => a.id && a.name).map(a => ({
    id: `app:${a.id}`, group: '打开应用', label: a.name, icon: a.icon || 'grid', run: () => openApp(a.id, '/'),
  }));
}
const allActions = () => [...ACTIONS, ...appActions()];
const GROUPS = ['当前对话', '接口', '界面', '导航', '打开应用'];

// ---- 世界书开关：这个角色挂着的书、全局的书、内置卡片 ----
function LorePanel({ c }) {
  useStore(lorebooks.store);
  useStore(characters.store);
  useStore(settings.store);
  const [open, setOpen] = useState('');
  const char = c.charId ? characters.get(c.charId) : null;
  if (!char) return html`<div class="qb-hint">${c.group ? '群聊中请在各成员的角色资料中设置世界书。' : '找不到当前角色。'}</div>`;
  const ids = char.lorebookIds || [];
  const toggleAttach = bid => characters.update(char.id, { lorebookIds: ids.includes(bid) ? ids.filter(x => x !== bid) : [...ids, bid] });
  const patchEntry = (bid, eid, on) => lorebooks.update(bid, b => ({ entries: b.entries.map(e => (e.id === eid ? { ...e, enabled: on } : e)) }));
  const books = lorebooks.all().filter(b => purposeOf(b) === 'chat');
  const bb = htmlcard.builtinBook();
  const bst = htmlcard.builtinState();

  const row = (b, on, onChange, sub, entries, onEntry) => html`
    <div key=${b.id} class="qb-book">
      <div class="qb-book-row">
        <button class="qb-book-name press" onClick=${() => setOpen(open === b.id ? '' : b.id)}>
          <${Icon} name=${open === b.id ? 'chevronUp' : 'chevronDown'} size=${14}/>
          <span><b>${b.name}</b><small>${sub}</small></span>
        </button>
        <${Switch} checked=${on} onChange=${onChange}/>
      </div>
      ${open === b.id ? html`
        <div class="qb-entries">
          ${entries.length ? entries.map(e => html`
            <div key=${e.id} class="qb-entry">
              <span>${e.comment || String(e.content || '').slice(0, 16) || '未命名条目'}${e.type === 'card' ? ' · 卡片' : ''}</span>
              <${Switch} checked=${e.enabled !== false} onChange=${v => onEntry(e.id, v)}/>
            </div>`) : html`<div class="qb-hint">暂无条目</div>`}
        </div>` : null}
    </div>`;

  return html`
    <div class="qb-books">
      <div class="qb-hint">开关表示「${char.name}」是否使用该世界书。全局生效的书对所有角色生效，在此关闭后对所有角色停用。展开可逐条开关。</div>
      ${row(bb, bb.global || ids.includes(bb.id),
        v => (bb.global ? htmlcard.setBuiltin({ global: v }) : toggleAttach(bb.id)),
        bb.global ? '内置 · 全局生效' : '内置',
        bb.entries, (eid, on) => htmlcard.setBuiltin({ off: on ? (bst.off || []).filter(x => x !== eid) : [...(bst.off || []), eid] }))}
      ${books.map(b => row(b, b.global || ids.includes(b.id),
        v => (b.global ? lorebooks.update(b.id, { global: v }) : toggleAttach(b.id)),
        `${(b.entries || []).length} 个条目${b.global ? ' · 全局生效' : ''}`,
        b.entries || [], (eid, on) => patchEntry(b.id, eid, on)))}
      ${books.length ? null : html`<div class="qb-hint">还没有自己的世界书。</div>`}
    </div>`;
}

// ---- 切换模型与接口：主用是哪一套、这一套最近用过的模型 ----
function ModelPanel({ onClose }) {
  useStore(settings.store);
  const presets = svc.chatPresets();
  const active = svc.activeChat();
  const recent = active ? [active.model, ...(active.recentModels || [])].filter((x, i, a) => x && a.indexOf(x) === i) : [];
  return html`
    <div class="qb-books">
      <div class="qb-group-name">主用接口</div>
      ${presets.map(p => html`
        <button key=${p.id} class=${`qb-pick press${p.id === active?.id ? ' is-on' : ''}`} onClick=${() => svc.setActiveChat(p.id)}>
          <span><b>${p.name || '接口'}</b><small>${p.model || '未选择模型'}</small></span>
          ${p.id === active?.id ? html`<${Icon} name="check" size=${16}/>` : null}
        </button>`)}
      ${active ? html`
        <div class="qb-group-name">「${active.name || '接口'}」最近用过的模型</div>
        <div class="chip-row">
          ${recent.map(m => html`<button key=${m} class=${`chip press${active.model === m ? ' is-active' : ''}`}
            onClick=${() => { svc.switchModel(active.id, m); toast(`已切换为 ${m}`, 'ok'); }}>${m}</button>`)}
        </div>` : null}
      <button class="qb-more press" onClick=${() => { onClose(); settingsPage('/api'); }}>更多模型与接口设置</button>
    </div>`;
}

// ---- 长按：外观（大小、图、溢出、自己写的 CSS） ----
// 这一页开着时球不藏起来，改什么当场看得到（见 QuickBall 里的 is-preview）
const CSS_HINT = '.qb-ball {\n  border-radius: 50%;\n}\n.qb-img {\n  filter: drop-shadow(0 2px 6px rgba(0,0,0,.3));\n}';
const CSS_NAMES = [
  ['.qb-ball', '悬浮球'], ['.qb-core', '中间的圆点'], ['.qb-img', '图片'], ['.qb-panel', '面板'],
  ['.qb-item', '面板中的一项'], ['.qb-icon', '项目图标'], ['.qb-label', '项目名称'],
  ['.is-idle', '闲置时'], ['.is-dragging', '拖动中'], ['.has-img', '已换图片'], ['--qb-size', '悬浮球边长（变量）'],
];
// 这几个名字写在界面上给用户用了，改名等于把用户写好的 CSS 作废：只加不改
function LookEditor({ conf }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(conf.css);
  const preview = useImage(conf.img || null);
  const pick = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try { await qb.setImage(file); toast('已更换图片', 'ok'); }
    catch (err) { toast('图片处理失败：' + (err.message || err), 'error', 4000); }
    finally { setBusy(false); }
  };
  const range = (label, min, max, step, value, onInput) => html`
    <label class="qb-range">
      <span>${label}</span>
      <input type="range" min=${min} max=${max} step=${step} value=${value} onInput=${e => onInput(Number(e.target.value))}/>
    </label>`;
  return html`
    <div class="qb-books">
      ${range(`大小　${conf.size}px`, qb.SIZE_MIN, qb.SIZE_MAX, 2, conf.size, v => qb.setCfg({ size: v }))}
      ${range(`闲置时的不透明度　${Math.round(conf.idle * 100)}%`, 20, 100, 5, Math.round(conf.idle * 100), v => qb.setCfg({ idle: v / 100 }))}
      <div class="qb-hint">三秒未操作后变为该不透明度，减少遮挡。</div>

      <div class="qb-group-name">图片</div>
      <div class="qb-img-row">
        <span class="qb-img-thumb">${preview ? html`<img src=${preview} alt=""/>` : html`<${Icon} name="image" size=${20}/>`}</span>
        <button class="chip press" disabled=${busy} onClick=${() => fileRef.current?.click()}>${busy ? '处理中' : conf.img ? '更换图片' : '选择图片'}</button>
        ${conf.img ? html`<button class="chip press" onClick=${() => qb.clearImage()}>移除图片</button>` : null}
      </div>
      <input type="file" accept="image/*" ref=${fileRef} onChange=${pick} style="display:none"/>
      ${conf.img ? html`
        ${range(`图片大小　${conf.scale.toFixed(1)} 倍`, qb.SCALE_MIN, qb.SCALE_MAX, 0.1, conf.scale, v => qb.setCfg({ scale: v }))}
        <div class="qb-hint">图片按悬浮球大小的倍数显示，大于 1 倍时超出悬浮球的范围，超出部分同样可以点击与拖动。靠边时整张图片保持在屏幕内。</div>
        <div class="qb-entry">
          <span>保留圆角底板</span>
          <${Switch} checked=${conf.plate} onChange=${v => qb.setCfg({ plate: v })}/>
        </div>` : html`<div class="qb-hint">选择图片后替换默认的圆角方块，透明部分保持透明；动图保留动画。</div>`}

      <div class="qb-group-name">自定义 CSS</div>
      <div class="qb-hint">只作用于悬浮球及其面板，不影响其他界面；设置应用中不生效，改坏后可在「设置 - 悬浮球」恢复默认样式。不支持 <span class="mono">&</span> 嵌套写法，含有它的规则不生效。</div>
      <div class="qb-hint">${CSS_NAMES.map(([k, v], i) => html`${i ? '，' : '可用的类名：'}<span class="mono">${k}</span> ${v}`)}。</div>
      <${Textarea} rows=${8} value=${draft} onInput=${setDraft} placeholder=${CSS_HINT}/>
      <div class="qb-img-row">
        <button class="chip press" onClick=${() => { qb.setCfg({ css: draft }); toast('已应用', 'ok'); }}>应用</button>
        <button class="chip press" onClick=${async () => {
          if (!await confirm({ title: '清空悬浮球的自定义 CSS', danger: true })) return;
          setDraft(''); qb.setCfg({ css: '' });
        }}>清空</button>
      </div>
    </div>`;
}

// ---- 长按：选放哪些、排顺序 ----
function Editor({ items, onChange }) {
  const acts = allActions();
  const on = id => items.includes(id);
  const flip = id => onChange(on(id) ? items.filter(x => x !== id) : [...items, id]);
  const move = (id, d) => {
    const i = items.indexOf(id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const byId = new Map(acts.map(a => [a.id, a]));
  return html`
    <div class="qb-books">
      <div class="qb-hint">勾选要放进悬浮球的项目。「当前对话」一组只在聊天页中显示。</div>
      <div class="qb-group-name">已放入 ${items.length} 项（可调整顺序）</div>
      ${items.filter(id => byId.has(id)).map((id, i, arr) => html`
        <div key=${id} class="qb-entry">
          <span>${byId.get(id).label}</span>
          <span class="qb-order">
            <button class="press" disabled=${i === 0} onClick=${() => move(id, -1)} aria-label="上移"><${Icon} name="chevronUp" size=${16}/></button>
            <button class="press" disabled=${i === arr.length - 1} onClick=${() => move(id, 1)} aria-label="下移"><${Icon} name="chevronDown" size=${16}/></button>
          </span>
        </div>`)}
      ${GROUPS.map(g => html`
        <div key=${g} class="qb-group-name">${g}</div>
        <div class="chip-row">
          ${acts.filter(a => a.group === g).map(a => html`
            <button key=${a.id} class=${`chip press${on(a.id) ? ' is-active' : ''}`} onClick=${() => flip(a.id)}>${a.label}</button>`)}
        </div>`)}
    </div>`;
}

const cssPx = (el, name) => parseFloat(getComputedStyle(el).getPropertyValue(name)) || 0;

// 悬浮球挂在外壳最外层，外面没有别的错误边界。它出任何错（存的值坏了、旧代码里少个函数、
// 某个应用登记的东西不对）都只能自己消失，不能把整个外壳一起带崩 —— 外壳一崩，各应用自己的
// 崩溃页（上面有「更新代码并重开」）也出不来，人就卡在白屏上。换个页面再试一次，好了就回来
export function QuickBall(props) {
  const [err, reset] = useErrorBoundary(e => console.error('[quickball] 悬浮球出错，已隐藏', e));
  const n = useStore(nav);
  const at = `${n.screen}/${n.appId || ''}`;
  const seen = useRef(at);
  const own = useRef(null);
  useEffect(() => { if (err && seen.current !== at) reset(); seen.current = at; }, [at, err]);
  // 渲染中途炸掉的那棵旧树 Preact 不会卸，球的 DOM 就留在屏幕上（点了还会再炸）。这里只有一个悬浮球，
  // 不是自己画的那层 .qb-layer 一律是残留，手动摘掉
  useEffect(() => {
    if (!err) return;
    document.querySelectorAll('.qb-layer').forEach(el => { if (el !== own.current) el.remove(); });
  }, [err]);
  if (err) return html`<div class="qb-layer" ref=${own}></div>`;
  return html`<${Ball} ...${props}/>`;
}

function Ball({ inSettings = false }) {
  useStore(settings.store);
  useStore(registryStore);
  const n = useStore(nav);
  const c = useStore(qb.chatStore);
  const conf = qb.cfg();
  const img = useImage(conf.img || null);
  const [tab, setTab] = useState('items');       // 长按编辑：'items' 放哪些 | 'look' 外观
  const ref = useRef(null);
  const drag = useRef(null);
  const holdT = useRef(null);
  const idleT = useRef(null);
  const [box, setBox] = useState(null);         // { W, H, top, bottom }
  const [live, setLive] = useState(null);       // 拖动中的位置
  const [idle, setIdle] = useState(false);
  const [view, setView] = useState('');         // '' | 'panel' | 'edit' | 'lore' | 'model'

  // 量一下外壳那一块。窗口一变就重量：横竖屏、键盘、关掉全屏、改窗口大小
  useEffect(() => {
    const el = ref.current;
    const parent = el?.offsetParent || el?.parentElement;
    if (!el || !parent) return undefined;
    const measure = () => setBox({
      W: parent.clientWidth, H: parent.clientHeight,
      top: cssPx(parent, '--safe-top') + cssPx(parent, '--top-inset') + 28,
      bottom: cssPx(parent, '--safe-bottom') + 24,
    });
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(parent);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [conf.on, n.screen]);

  // 用户写的 CSS：包成只作用于悬浮球那一层（qb.scopeCss）。设置 app 里不挂，那里能恢复默认
  const userCss = conf.css && !inSettings ? qb.scopeCss(conf.css) : '';

  const wake = () => {
    setIdle(false);
    clearTimeout(idleT.current);
    idleT.current = setTimeout(() => setIdle(true), 3000);
  };
  useEffect(() => { wake(); return () => clearTimeout(idleT.current); }, [conf.on]);

  if (!conf.on || n.screen === 'lock') return null;

  // 正看着的就是登记的那一段对话，「当前对话」那一组才出现
  const route = n.appId ? (n.stacks[n.appId] || ['/']).slice(-1)[0] : '';
  const inChat = n.screen === 'app' && n.appId === 'chat' && !!c.chatId && route === `/chat/${c.chatId}`;
  const byId = new Map(allActions().map(a => [a.id, a]));
  const shown = conf.items.map(id => byId.get(id)).filter(a => a && (!a.chat || inChat));

  const at = live || (box ? qb.place(conf, box.W, box.H, box) : null);

  const down = e => {
    wake();
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x0: at?.x || 0, y0: at?.y || 0, moved: false, held: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 不支持就算了 */ }
    clearTimeout(holdT.current);
    holdT.current = setTimeout(() => {
      const d = drag.current;
      if (d && !d.moved) { d.held = true; setTab('items'); setView('edit'); try { navigator.vibrate?.(15); } catch { /* 无 */ } }
    }, 550);
  };
  const move = e => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || d.held || !box) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    if (!d.moved) { d.moved = true; clearTimeout(holdT.current); }
    // 拖动中也夹在屏幕里：拖不出去；换了图就按整张图夹
    setLive(qb.clampDrag(d.x0 + dx, d.y0 + dy, box.W, box.H, conf));
  };
  const up = e => {
    const d = drag.current;
    drag.current = null;
    clearTimeout(holdT.current);
    wake();
    if (!d || d.id !== e.pointerId) return;
    if (d.held) return;
    if (!d.moved) { setView(view ? '' : 'panel'); return; }
    if (box && live) qb.setCfg(qb.dropAt(live.x, live.y, box.W, box.H, conf, box));
    setLive(null);
  };

  const tap = a => {
    if (a.panel) { setView(a.panel); return; }
    try { a.run?.(c); } catch (err) { toast(String(err.message || err), 'error'); }
    if (!a.toggle) setView('');
  };

  const looking = view === 'edit' && tab === 'look';
  const title = { panel: '快捷操作', edit: looking ? '悬浮球外观' : '选择放入的项目', lore: '世界书开关', model: '切换模型与接口' }[view] || '';
  const hasImg = !!(conf.img && img);
  const cls = ['qb-ball no-callout',
    live && 'is-dragging', idle && !view && 'is-idle',
    view && !looking && 'is-open', looking && 'is-preview', !at && 'is-placing',
    hasImg && 'has-img', hasImg && conf.plate && 'has-plate'].filter(Boolean).join(' ');

  return html`<div class="qb-layer">
    ${userCss ? html`<style id="qb-user-css">${userCss}</style>` : null}
    <button ref=${ref} class=${cls}
      aria-label="悬浮球"
      style=${`--qb-x:${Math.round(at?.x || 0)}px;--qb-y:${Math.round(at?.y || 0)}px;--qb-size:${conf.size}px;--qb-idle:${conf.idle};--qb-scale:${conf.scale}${hasImg ? `;--qb-img:url("${img}")` : ''}`}
      onPointerDown=${down} onPointerMove=${move} onPointerUp=${up}
      onPointerCancel=${() => { drag.current = null; clearTimeout(holdT.current); setLive(null); }}
      onContextMenu=${e => e.preventDefault()}>
      ${hasImg ? html`<span class="qb-img"></span>` : html`<span class="qb-core"></span>`}
    </button>
    ${view ? html`
      <div class="qb-scrim" onClick=${e => { if (e.target === e.currentTarget) setView(''); }}>
        <div class="qb-panel">
          <div class="qb-head">
            ${view !== 'panel' ? html`<button class="qb-head-btn press" onClick=${() => setView('panel')} aria-label="返回">
              <${Icon} name="chevronLeft" size=${18}/></button>` : html`<span class="qb-head-btn"></span>`}
            <span class="qb-title">${title}</span>
            ${view === 'panel' ? html`<button class="qb-head-btn press" onClick=${() => { setTab('items'); setView('edit'); }}>编辑</button>`
              : html`<button class="qb-head-btn press" onClick=${() => setView('')} aria-label="关闭"><${Icon} name="close" size=${16}/></button>`}
          </div>
          ${view === 'panel' ? html`
            ${shown.length ? html`<div class="qb-grid">
              ${shown.map(a => {
                const on = a.toggle ? !!a.toggle(c) : false;
                return html`<button key=${a.id} class=${`qb-item press${on ? ' is-on' : ''}`} onClick=${() => tap(a)}>
                  <span class="qb-icon"><${Icon} name=${a.icon} size=${20}/></span>
                  <span class="qb-label">${a.label}</span>
                  ${a.note ? html`<span class="qb-note">${a.note}</span>` : null}
                </button>`;
              })}
            </div>` : html`<div class="qb-hint">还没有放入任何项目。点右上角「编辑」选择。</div>`}`
          : view === 'edit' ? html`
            <div class="qb-tabs"><${Segmented} value=${tab} onChange=${setTab}
              items=${[{ value: 'items', label: '项目' }, { value: 'look', label: '外观' }]}/></div>
            ${tab === 'look' ? html`<${LookEditor} conf=${conf}/>`
              : html`<${Editor} items=${conf.items} onChange=${items => qb.setCfg({ items })}/>`}`
          : view === 'lore' ? html`<${LorePanel} c=${c}/>`
          : view === 'model' ? html`<${ModelPanel} onClose=${() => setView('')}/>` : null}
        </div>
      </div>` : null}
  </div>`;
}
