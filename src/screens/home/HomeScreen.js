import { html, useState, useRef, useEffect, useLayoutEffect } from '../../lib.js';
import { Icon } from '../../icons/Icon.js';
import { useStore } from '../../system/store.js';
import { settings } from '../../system/db/index.js';
import { layout, chats } from '../../system/db/index.js';
import { getWidget, registryStore } from '../../system/registry.js';
import { appLook } from '../../system/look.js';
import { WidgetEditor } from './WidgetEditor.js';
import { CellEditor } from './CellEditor.js';
import { openApp } from '../../system/nav.js';
import { GRID_COLS } from '../../system/db/defaults.js';
import { rowsOf, setPage, moveTo, healAndSave, addPage, removePage, freeSlots } from './layout.js';
import { toast } from '../../ui/overlay.js';

function unreadFor(appId) {
  if (appId !== 'chat') return 0;
  return chats.all().reduce((n, c) => n + (c.unread || 0), 0);
}

function Cell({ cell, edit, onPick, picked, onEditWidget }) {
  const style = `grid-column:${cell.x + 1}/span ${cell.w};grid-row:${cell.y + 1}/span ${cell.h}`;

  if (cell.kind === 'widget') {
    const wg = getWidget(cell.ref);
    const tap = () => {
      if (edit) { onPick(cell); return; }
      if (wg?.editable) onEditWidget(cell);
    };
    return html`
      <div class=${`cell cell-widget${edit ? ' is-edit' : ''}${picked ? ' is-picked' : ''}`} style=${style}
        onClick=${tap}>
        ${wg ? wg.render(cell) : html`<div class="wg wg-empty">挂件缺失</div>`}
      </div>`;
  }

  const app = appLook(cell.ref);
  if (!app) return null;
  const badge = unreadFor(cell.ref);
  return html`
    <div class=${`cell cell-app${edit ? ' is-edit' : ''}${picked ? ' is-picked' : ''}`} style=${style}
      onClick=${() => edit ? onPick(cell) : openApp(cell.ref)}>
      <div class="app-tile">
        <${Icon} name=${app.icon} size=${25} />
        ${badge ? html`<span class="tile-badge">${badge > 99 ? '99+' : badge}</span>` : null}
      </div>
      <span class="app-name ellipsis">${app.name}</span>
    </div>`;
}

export function HomeScreen() {
  const lay = useStore(layout.store);
  useStore(registryStore);
  useStore(chats.store);
  useStore(settings.store);

  const [edit, setEdit] = useState(false);
  const [picked, setPicked] = useState(null);
  const [editingWidget, setEditingWidget] = useState(null);
  const [editingCell, setEditingCell] = useState(null);
  const pressTimer = useRef(null);
  const touch = useRef(null);
  // 长按松手时浏览器还会补一次 click，会把刚进入的整理模式立刻弹出菜单。
  // 这里吞掉紧随长按的那一次点击。
  const swallowTap = useRef(false);
  const gridRef = useRef(null);
  const [cell, setCell] = useState(0);

  useEffect(() => { healAndSave(); }, []);

  const pages = lay.pages || [];
  const idx = Math.min(lay.currentPage || 0, Math.max(0, pages.length - 1));
  const page = pages[idx] || { cells: [] };
  const rows = rowsOf(page, edit);
  const slots = edit ? freeSlots(page, rows) : [];

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
      const byH = (height - gap * (rows - 1)) / rows;
      setCell(Math.max(44, Math.floor(Math.min(byW, byH))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows]);

  // 整理模式:没有待交换目标时点开这个位置的菜单;有目标时完成交换
  // 整理模式：没有待移动目标时点开菜单；有目标时把它挪到这里
  const onPick = cell => {
    if (swallowTap.current) return;
    if (!picked) { setEditingCell(cell); return; }
    if (picked === cell.id) { setPicked(null); return; }
    const r = moveTo(idx, picked, cell.x, cell.y);
    if (!r.ok) toast(r.reason, 'error');
    setPicked(null);
  };

  // 点空位：有待移动目标就挪过来，否则打开菜单往这里放东西
  const onPickSlot = (x, y) => {
    if (swallowTap.current) return;
    if (picked) {
      const r = moveTo(idx, picked, x, y);
      if (!r.ok) toast(r.reason, 'error');
      setPicked(null);
      return;
    }
    setEditingCell({ slot: true, x, y, w: 1, h: 1 });
  };

  const startPress = () => {
    clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => {
      setEdit(true);
      setPicked(null);
      swallowTap.current = true;
      // 若松手后没有补 click（鼠标场景），过一会儿自行解除，不能一直吞
      setTimeout(() => { swallowTap.current = false; }, 500);
    }, 550);
  };
  const endPress = () => clearTimeout(pressTimer.current);

  const onTouchStart = e => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    startPress();
  };
  const onTouchMove = e => {
    if (!touch.current) return;
    if (Math.abs(e.touches[0].clientX - touch.current.x) > 8
      || Math.abs(e.touches[0].clientY - touch.current.y) > 8) endPress();
  };
  const onTouchEnd = e => {
    endPress();
    const t = touch.current;
    touch.current = null;
    if (!t) return;
    const dx = e.changedTouches[0].clientX - t.x;
    const dy = e.changedTouches[0].clientY - t.y;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      setPage(dx < 0 ? idx + 1 : idx - 1);
    }
  };

  return html`
    <div class="home"
      onMouseDown=${startPress} onMouseUp=${endPress} onMouseLeave=${endPress}
      onTouchStart=${onTouchStart} onTouchMove=${onTouchMove} onTouchEnd=${onTouchEnd}>

      <div class=${`home-grid${edit ? ' is-edit' : ''}`} ref=${gridRef}
        style=${cell
          ? `grid-template-columns:repeat(${GRID_COLS},${cell}px);grid-auto-rows:${cell}px`
          : `grid-template-columns:repeat(${GRID_COLS},1fr);grid-auto-rows:1fr`}>
        ${page.cells.map(c => html`
          <${Cell} key=${c.id} cell=${c} edit=${edit} picked=${picked === c.id}
            onPick=${onPick} onEditWidget=${setEditingWidget}/>`)}
        ${edit ? slots.map(sl => html`
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
          <span class="edit-hint">${picked ? '点另一个同样大小的位置交换' : '点两个位置交换'}</span>
          <div class="edit-acts">
            <button class="icon-btn press" onClick=${addPage} aria-label="新建一页">
              <${Icon} name="plus" size=${17}/>
            </button>
            ${idx > 0 && !page.cells.length ? html`
              <button class="icon-btn press" onClick=${() => removePage(idx)} aria-label="删除这一页">
                <${Icon} name="trash" size=${17}/>
              </button>` : null}
            <button class="btn btn-primary btn-sm press"
              onClick=${() => { setEdit(false); setPicked(null); healAndSave(); }}>完成</button>
          </div>
        </div>` : null}

      <${WidgetEditor} cell=${editingWidget} onClose=${() => setEditingWidget(null)}/>
      <${CellEditor} cell=${editingCell} pageIdx=${idx}
        onClose=${() => setEditingCell(null)} onSwapFrom=${setPicked}/>
    </div>`;
}
