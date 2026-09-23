import { html, useState, useRef, useEffect, useLayoutEffect, useMemo } from '../../lib.js';
import { Icon } from '../../icons/Icon.js';
import { useStore } from '../../system/store.js';
import { settings } from '../../system/db/index.js';
import * as accounts from '../../system/accounts.js';
import { layout, chats } from '../../system/db/index.js';
import { getWidget, registryStore } from '../../system/registry.js';
import { appLook } from '../../system/look.js';
import { WidgetEditor } from './WidgetEditor.js';
import { CellEditor } from './CellEditor.js';
import { openApp } from '../../system/nav.js';
import { GRID_COLS } from '../../system/db/defaults.js';
import { rowsOf, setPage, movePicked, moveTo, planMove, healAndSave, addPage, removePage, freeSlots } from './layout.js';
import { dragState, bindGrid, pressStart, justDragged, dragging } from './drag.js';
import { editState, setEdit, setPicked, clearPicked } from './editState.js';
import { AppTile } from './AppTile.js';
import { FolderView, FolderTile } from './FolderView.js';
import { FolderEdit } from './FolderEdit.js';
import { toast } from '../../ui/overlay.js';

function unreadFor(appId) {
  if (appId !== 'chat') return 0;
  const me = accounts.currentId();
  return chats.where(c => (c.personaId || me) === me)
    .reduce((n, c) => n + (c.unread || 0), 0);
}

function Cell({ cell, edit, onPick, picked, lifted, away, onEditWidget, onOpenFolder, onEditFolder }) {
  const hold = useRef(null);
  const fired = useRef(false);
  const style = `grid-column:${cell.x + 1}/span ${cell.w};grid-row:${cell.y + 1}/span ${cell.h}`;
  // 按住就可能是要拖。真拖没拖由 drag.js 看手指挪了多远、是不是在整理模式里
  const down = e => pressStart(e, { type: 'cell', id: cell.id, w: cell.w, h: cell.h }, e.currentTarget);
  const cls = `${edit ? ' is-edit' : ''}${picked ? ' is-picked' : ''}${lifted ? ' is-lifted' : ''}${away ? ' is-away' : ''}`;

  if (cell.kind === 'folder') {
    // 长按直接改名与增减内容。外层那个长按是「进整理模式」，这里先截下来
    const start = () => {
      clearTimeout(hold.current);
      fired.current = false;
      hold.current = setTimeout(() => { fired.current = true; onEditFolder(cell); }, 550);
    };
    const end = () => clearTimeout(hold.current);
    const tap = () => {
      if (fired.current) { fired.current = false; return; }
      if (justDragged()) return;
      if (edit) onPick(cell); else onOpenFolder(cell);
    };
    return html`
      <div class=${`cell cell-app no-callout${cls}`} data-cell=${cell.id}
        style=${style} onClick=${tap} onPointerDown=${down}
        onContextMenu=${e => { e.preventDefault(); onEditFolder(cell); }}
        onMouseDown=${start} onMouseUp=${end} onMouseLeave=${end}
        onTouchStart=${start} onTouchEnd=${end} onTouchMove=${end} onTouchCancel=${end}>
        <${FolderTile} cell=${cell}/>
        <span class="app-name ph-tile-name ellipsis">${cell.name || '文件夹'}</span>
      </div>`;
  }

  if (cell.kind === 'widget') {
    const wg = getWidget(cell.ref);
    const tap = () => {
      if (justDragged()) return;
      if (edit) { onPick(cell); return; }
      if (wg?.editable) onEditWidget(cell);
    };
    return html`
      <div class=${`cell cell-widget${cell.config?.bare ? ' is-bare' : ''}${cls}`} style=${style}
        data-cell=${cell.id} onClick=${tap} onPointerDown=${down}>
        ${wg ? wg.render(cell) : html`<div class="wg wg-empty">挂件缺失</div>`}
      </div>`;
  }

  const app = appLook(cell.ref);
  if (!app) return null;
  return html`
    <div class=${`cell cell-app${cls}`} style=${style} data-cell=${cell.id} onPointerDown=${down}
      onClick=${() => { if (justDragged()) return; if (edit) onPick(cell); else openApp(cell.ref); }}>
      <${AppTile} app=${app} badge=${unreadFor(cell.ref)}/>
      <span class="app-name ph-tile-name ellipsis">${app.name}</span>
    </div>`;
}

export function HomeScreen() {
  const lay = useStore(layout.store);
  useStore(registryStore);
  useStore(chats.store);
  useStore(settings.store);

  const { edit, picked } = useStore(editState);
  const drag = useStore(dragState);
  const [editingWidget, setEditingWidget] = useState(null);
  const [editingCell, setEditingCell] = useState(null);
  const [openFolder, setOpenFolder] = useState(null);
  const [editFolder, setEditFolder] = useState(null);
  const pressTimer = useRef(null);
  const touch = useRef(null);
  // 长按松手时浏览器还会补一次 click，会把刚进入的整理模式立刻弹出菜单。
  // 这里吞掉紧随长按的那一次点击。
  const swallowTap = useRef(false);
  const gridRef = useRef(null);
  const [cell, setCell] = useState(0);
  const [autoRows, setAutoRows] = useState(6);

  useEffect(() => { healAndSave(); }, []);

  const pages = lay.pages || [];
  const idx = Math.min(lay.currentPage || 0, Math.max(0, pages.length - 1));
  const page = pages[idx] || { cells: [] };
  // 行数按屏高自动撑满：格子边长先由宽度定死（保证是方的），
  // 再看这个高度能放下几行。大屏就多出几行可用，不会空一大片。
  const needRows = rowsOf(page, edit);
  const rows = Math.max(needRows, autoRows);
  const slots = edit ? freeSlots(page, rows) : [];

  // ---- 拖动（见 drag.js） ----
  // 落下之后格子从哪儿飞过来。拖的那一格从影子最后的位置飞进新格子，
  // 被挤走、被对调的那几格从各自的老位置滑过去 —— 看得见谁去了哪儿
  const flipFrom = useRef(new Map());
  const [, bump] = useState(0);
  const onDrop = (src, over, at) => {
    if (src.type === 'cell' && at) flipFrom.current.set(src.id, at);
    if (!over) { bump(n => n + 1); return; }
    let r;
    if (over.type === 'dock') {
      r = movePicked(idx, src.type === 'cell' ? { type: 'cell', id: src.id } : src, { type: 'dock', i: over.i });
    } else if (src.type === 'cell') {
      r = moveTo(idx, src.id, over.x, over.y);
    } else {
      // 从 dock 拖下来：落在别的应用上就和它对调，落在空处就放在那儿
      const hit = page.cells.find(c => over.x >= c.x && over.x < c.x + c.w && over.y >= c.y && over.y < c.y + c.h);
      r = movePicked(idx, src, hit ? { type: 'cell', id: hit.id } : { type: 'slot', x: over.x, y: over.y });
    }
    if (!r.ok) toast(r.reason, 'error');
    bump(n => n + 1);
  };
  const onPage = dir => {
    const next = idx + dir;
    if (next < 0) return;
    // 拖到最后一页的右边：这一页有东西就新开一页，空页就不再开
    if (next >= pages.length) { if (page.cells.length) addPage(); return; }
    setPage(next);
  };
  const gap = gridRef.current ? parseFloat(getComputedStyle(gridRef.current).gap) || 12 : 12;
  bindGrid({ el: gridRef.current, cell, gap, cols: GRID_COLS, rows, onDrop, onPage });

  // ---- 让位：拖着停在一处，其他格子先按「松手会变成什么样」挪好 ----
  // 手指路过一个位置不算，停下来 150 毫秒才算 —— 不然拖过去的一路上
  // 每经过一个图标，整页都要翻腾一次
  const [settled, setSettled] = useState(null);
  const overKey = drag.over ? JSON.stringify(drag.over) : '';
  useEffect(() => {
    const o = drag.over;
    if (!drag.src || drag.src.type !== 'cell' || !o || o.type !== 'slot') { setSettled(null); return undefined; }
    const t = setTimeout(() => setSettled(o), 150);
    return () => clearTimeout(t);
  }, [drag.src, overKey]);
  // 预览和松手走的是同一段 planMove，看到的就是落下之后的样子
  const preview = useMemo(() => {
    if (!settled || drag.src?.type !== 'cell') return null;
    const draft = structuredClone(lay);
    return planMove(draft, idx, drag.src.id, settled.x, settled.y).ok ? draft.pages[idx].cells : null;
  }, [settled, drag.src, lay, idx]);
  const shown = preview || page.cells;

  // ---- 过渡（FLIP）----
  // 每一格挪了位置都滑过去，不跳。「从哪儿滑」取这一次改动**之前**屏幕上的样子：
  // 在渲染时量（这时 DOM 还是上一版），正在滑的格子量到的就是它半路的位置，
  // 目标又变了也是从半路接着滑，不会先闪回原处
  const before = new Map();
  if (gridRef.current) {
    gridRef.current.querySelectorAll('[data-cell]').forEach(n => before.set(n.dataset.cell, n.getBoundingClientRect()));
  }
  const beforeRef = useRef(before);
  beforeRef.current = before;
  const rects = useRef({ page: -1, cell: 0, pos: new Map() });
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    // 换了一页、格子边长变了（转屏、改尺寸）不算挪动，不飞
    const same = rects.current.page === idx && rects.current.cell === cell;
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const prev = beforeRef.current;
    const lastPos = rects.current.pos;
    const pos = new Map();
    el.querySelectorAll('[data-cell]').forEach(node => {
      const id = node.dataset.cell;
      // offsetLeft/Top 不含 transform，是格子真正排在哪。没换格子就不碰它 ——
      // 拖动时每挪一下手指这里都要跑一遍，正在滑的格子被一遍遍重新起步，就滑不动了
      const at = `${node.offsetLeft},${node.offsetTop}`;
      pos.set(id, at);
      if (!flipFrom.current.has(id) && lastPos.get(id) === at) return;
      const from = flipFrom.current.get(id) || (same ? prev.get(id) : null);
      if (!from || still || !node.animate) return;
      node.getAnimations?.().forEach(an => an.cancel());
      const r = node.getBoundingClientRect();
      const dx = from.left - r.left;
      const dy = from.top - r.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        { duration: 280, easing: 'cubic-bezier(.2, .9, .3, 1)' });
    });
    flipFrom.current.clear();
    rects.current = { page: idx, cell, pos };
  });

  // 格子边长取「按宽度均分」与「按高度均分」中较小的那个:
  // 前者保证 1x1 是方的,后者保证整页不溢出。
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const gap = parseFloat(getComputedStyle(el).gap) || 12;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      const byW = (width - gap * (GRID_COLS - 1)) / GRID_COLS;
      const fitRows = Math.max(4, Math.floor((height + gap) / (byW + gap)));
      setAutoRows(fitRows);
      const useRows = Math.max(needRows, fitRows);
      const byH = (height - gap * (useRows - 1)) / useRows;
      const size = Math.max(44, Math.floor(Math.min(byW, byH)));
      setCell(size);
      // Dock 里的图标要和网格里一样大，所以把格子边长共享出去
      document.documentElement.style.setProperty('--cell', size + 'px');
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [needRows]);

  // 整理模式:没有待交换目标时点开这个位置的菜单;有目标时完成交换
  // 整理模式：没有待移动目标时点开菜单；有目标时把它挪到这里
  const drop = target => {
    const r = movePicked(idx, picked, target);
    if (!r.ok) toast(r.reason, 'error');
    clearPicked();
  };

  const onPick = cell => {
    if (swallowTap.current) return;
    if (!picked) { setEditingCell(cell); return; }
    if (picked.type === 'cell' && picked.id === cell.id) { clearPicked(); return; }
    drop({ type: 'cell', id: cell.id });
  };

  // 点空位：有待移动目标就挪过来，否则打开菜单往这里放东西
  const onPickSlot = (x, y) => {
    if (swallowTap.current) return;
    if (picked) { drop({ type: 'slot', x, y }); return; }
    setEditingCell({ slot: true, x, y, w: 1, h: 1 });
  };

  const startPress = () => {
    clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => {
      setEdit(true);
      swallowTap.current = true;
      // 若松手后没有补 click（鼠标场景），过一会儿自行解除，不能一直吞
      setTimeout(() => { swallowTap.current = false; }, 500);
    }, 550);
  };
  const endPress = () => clearTimeout(pressTimer.current);
  // 拖起来了就不再算长按：拖得久了，主屏那个「长按进整理」的计时会再触发一次
  if (drag.src) clearTimeout(pressTimer.current);

  const onTouchStart = e => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    startPress();
  };
  const onTouchMove = e => {
    if (!touch.current) return;
    if (dragging()) { endPress(); return; }
    if (Math.abs(e.touches[0].clientX - touch.current.x) > 8
      || Math.abs(e.touches[0].clientY - touch.current.y) > 8) endPress();
  };
  const onTouchEnd = e => {
    endPress();
    const t = touch.current;
    touch.current = null;
    if (!t || dragging() || justDragged()) return;
    const dx = e.changedTouches[0].clientX - t.x;
    const dy = e.changedTouches[0].clientY - t.y;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      setPage(dx < 0 ? idx + 1 : idx - 1);
    }
  };

  return html`
    <div class="home no-callout ph-home"
      onMouseDown=${startPress} onMouseUp=${endPress} onMouseLeave=${endPress}
      onTouchStart=${onTouchStart} onTouchMove=${onTouchMove} onTouchEnd=${onTouchEnd}>

      <div class=${`home-grid ph-home-grid${edit ? ' is-edit' : ''}`} ref=${gridRef}
        style=${cell
          ? `grid-template-columns:repeat(${GRID_COLS},${cell}px);grid-auto-rows:${cell}px`
          : `grid-template-columns:repeat(${GRID_COLS},1fr);grid-auto-rows:1fr`}>
        ${shown.map(c => html`
          <${Cell} key=${c.id} cell=${c} edit=${edit}
            picked=${picked?.type === 'cell' && picked.id === c.id}
            lifted=${drag.src?.type === 'cell' && drag.src.id === c.id}
            away=${!!preview && drag.src?.id === c.id}
            onPick=${onPick} onEditWidget=${setEditingWidget}
            onOpenFolder=${setOpenFolder} onEditFolder=${f => { endPress(); setEditFolder(f); }}/>`)}
        ${drag.over?.type === 'slot' ? html`
          <div class="cell cell-drop" aria-hidden="true"
            style=${`grid-column:${drag.over.x + 1}/span ${drag.over.w};grid-row:${drag.over.y + 1}/span ${drag.over.h}`}></div>` : null}
        ${edit && !drag.src ? slots.map(sl => html`
          <div key=${`${sl.x},${sl.y}`} class="cell cell-slot"
            style=${`grid-column:${sl.x + 1};grid-row:${sl.y + 1}`}
            onClick=${() => onPickSlot(sl.x, sl.y)}>
            <${Icon} name="plus" size=${16}/>
          </div>`) : null}
      </div>

      <div class="page-dots">
        ${pages.map((p, i) => html`
          <button key=${p.id} class=${`dot${i === idx ? ' is-active' : ''}`}
            onClick=${() => setPage(i)} aria-label=${`第${i + 1}页`}></button>`)}
      </div>

      ${edit ? html`
        <div class="edit-bar">
          <span class="edit-hint">${picked
            ? '点目标位置完成移动，翻页后再点也可以'
            : '按住拖到想放的位置，拖到屏幕边缘可翻页。点一下换图标、改大小或移除'}</span>
          <div class="edit-acts">
            <button class="icon-btn press" onClick=${addPage} aria-label="新建一页">
              <${Icon} name="plus" size=${17}/>
            </button>
            ${idx > 0 && !page.cells.length ? html`
              <button class="icon-btn press" onClick=${() => removePage(idx)} aria-label="删除这一页">
                <${Icon} name="trash" size=${17}/>
              </button>` : null}
            <button class="btn btn-primary btn-sm press"
              onClick=${() => { setEdit(false); healAndSave(); }}>完成</button>
          </div>
        </div>` : null}

      <${FolderView} cell=${openFolder} onClose=${() => setOpenFolder(null)}/>
      <${FolderEdit} open=${!!editFolder} cell=${editFolder}
        onClose=${() => setEditFolder(null)}/>
      <${WidgetEditor} cell=${editingWidget} onClose=${() => setEditingWidget(null)}/>
      <${CellEditor} cell=${editingCell} pageIdx=${idx}
        onClose=${() => setEditingCell(null)}
        onSwapFrom=${id => setPicked({ type: 'cell', id, page: idx })}/>
    </div>`;
}
