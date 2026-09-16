import { html, useState, useRef, useEffect, useLayoutEffect } from '../../lib.js';
import { Icon } from '../../icons/Icon.js';
import { useStore } from '../../system/store.js';
import { layout, chats } from '../../system/db/index.js';
import { getApp, getWidget, registryStore } from '../../system/registry.js';
import { openApp } from '../../system/nav.js';
import { GRID_COLS } from '../../system/db/defaults.js';
import { rowsOf, setPage, swapCells, healAndSave, addPage, removePage } from './layout.js';
import { toast } from '../../ui/overlay.js';

function unreadFor(appId) {
  if (appId !== 'chat') return 0;
  return chats.all().reduce((n, c) => n + (c.unread || 0), 0);
}

function Cell({ cell, edit, onPick, picked }) {
  const style = `grid-column:${cell.x + 1}/span ${cell.w};grid-row:${cell.y + 1}/span ${cell.h}`;

  if (cell.kind === 'placeholder') {
    return html`
      <div class=${`cell cell-ph${edit ? ' is-edit' : ''}`} style=${style}
        onClick=${() => edit ? onPick(cell) : toast('这个位置还没有 app')}>
        <${Icon} name="plus" size=${18}/>
        <span>${cell.label || '待开发'}</span>
      </div>`;
  }

  if (cell.kind === 'widget') {
    const wg = getWidget(cell.ref);
    return html`
      <div class=${`cell cell-widget${edit ? ' is-edit' : ''}${picked ? ' is-picked' : ''}`} style=${style}
        onClick=${() => edit && onPick(cell)}>
        ${wg ? wg.render() : html`<div class="wg wg-empty">挂件缺失</div>`}
      </div>`;
  }

  const app = getApp(cell.ref);
  if (!app) return null;
  const badge = unreadFor(cell.ref);
  return html`
    <div class=${`cell cell-app${edit ? ' is-edit' : ''}${picked ? ' is-picked' : ''}`} style=${style}
      onClick=${() => edit ? onPick(cell) : openApp(cell.ref)}>
      <div class="app-tile" style=${`background:${app.accent}`}>
        <${Icon} name=${app.icon} size=${25} style="color:var(--on-tile)"/>
        ${badge ? html`<span class="tile-badge">${badge > 99 ? '99+' : badge}</span>` : null}
      </div>
      <span class="app-name ellipsis">${app.name}</span>
    </div>`;
}

export function HomeScreen() {
  const lay = useStore(layout.store);
  useStore(registryStore);
  useStore(chats.store);

  const [edit, setEdit] = useState(false);
  const [picked, setPicked] = useState(null);
  const pressTimer = useRef(null);
  const touch = useRef(null);
  const gridRef = useRef(null);
  const [cell, setCell] = useState(0);

  useEffect(() => { healAndSave(); }, []);

  const pages = lay.pages || [];
  const idx = Math.min(lay.currentPage || 0, Math.max(0, pages.length - 1));
  const page = pages[idx] || { cells: [] };
  const rows = rowsOf(page);

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

  const onPick = cell => {
    if (!picked) { setPicked(cell.id); return; }
    if (picked === cell.id) { setPicked(null); return; }
    const a = page.cells.find(c => c.id === picked);
    if (a && (a.w !== cell.w || a.h !== cell.h)) {
      toast('只能和同样大小的位置交换');
      setPicked(null);
      return;
    }
    swapCells(idx, picked, cell.id);
    setPicked(null);
  };

  const startPress = () => {
    clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => { setEdit(true); setPicked(null); }, 550);
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
          <${Cell} key=${c.id} cell=${c} edit=${edit} picked=${picked === c.id} onPick=${onPick}/>`)}
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
    </div>`;
}
