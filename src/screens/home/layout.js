import { layout } from '../../system/db/index.js';
import { hasApp, hasWidget, listApps } from '../../system/registry.js';
import { GRID_COLS, DOCK_SIZE } from '../../system/db/defaults.js';
import { uid } from '../../system/store.js';

const ph = (x, y) => ({ id: uid('c'), kind: 'placeholder', label: '待开发', x, y, w: 1, h: 1 });

function occupy(cells) {
  const taken = new Set();
  for (const c of cells) {
    for (let dy = 0; dy < c.h; dy++) {
      for (let dx = 0; dx < c.w; dx++) taken.add(`${c.x + dx},${c.y + dy}`);
    }
  }
  return taken;
}

function fits(taken, x, y, w, h) {
  if (x < 0 || x + w > GRID_COLS) return false;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) if (taken.has(`${x + dx},${y + dy}`)) return false;
  }
  return true;
}

function place(cells, w, h) {
  const taken = occupy(cells);
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x <= GRID_COLS - w; x++) {
      if (fits(taken, x, y, w, h)) return { x, y };
    }
  }
  return null;
}

// 自愈。引用失效的单元转成 placeholder 而不是直接删,否则版式会塌。
// 见 ARCHITECTURE 3.8
export function heal(raw) {
  const lay = structuredClone(raw);
  lay.pages = Array.isArray(lay.pages) && lay.pages.length ? lay.pages : [{ id: uid('p'), cells: [] }];

  const placed = new Set();

  for (const page of lay.pages) {
    const kept = [];
    for (const cell of (page.cells || [])) {
      let c = { ...cell };
      c.w = Math.max(1, Math.min(GRID_COLS, c.w | 0 || 1));
      c.h = Math.max(1, Math.min(6, c.h | 0 || 1));

      if (c.kind === 'app' && !hasApp(c.ref)) c = { ...ph(c.x, c.y), x: c.x, y: c.y, w: c.w, h: c.h };
      else if (c.kind === 'widget' && !hasWidget(c.ref)) c = { ...ph(c.x, c.y), x: c.x, y: c.y, w: c.w, h: c.h };
      if (c.kind === 'app') {
        if (placed.has(c.ref)) c = { ...ph(c.x, c.y), x: c.x, y: c.y, w: 1, h: 1 };
        else placed.add(c.ref);
      }

      // 越界或重叠:重新落位
      const taken = occupy(kept);
      if (!fits(taken, c.x, c.y, c.w, c.h)) {
        const spot = place(kept, c.w, c.h);
        if (!spot) continue;
        c.x = spot.x; c.y = spot.y;
      }
      if (!c.id) c.id = uid('c');
      kept.push(c);
    }
    page.cells = kept;
  }

  // Dock
  const dock = Array.from({ length: DOCK_SIZE }, (_, i) => {
    const id = (lay.dock || [])[i];
    return id && hasApp(id) ? id : null;
  });
  dock.forEach(id => id && placed.add(id));
  lay.dock = dock;

  // 已注册但没摆出来的 app:优先占用最近的 placeholder,否则追加
  const missing = listApps().filter(a => a.showOnHome !== false && !placed.has(a.id));
  for (const app of missing) {
    let done = false;
    for (const page of lay.pages) {
      const slot = page.cells.find(c => c.kind === 'placeholder' && c.w === 1 && c.h === 1);
      if (slot) {
        slot.kind = 'app'; slot.ref = app.id; delete slot.label;
        done = true; break;
      }
    }
    if (done) continue;
    const last = lay.pages[lay.pages.length - 1];
    const spot = place(last.cells, 1, 1);
    if (spot) last.cells.push({ id: uid('c'), kind: 'app', ref: app.id, ...spot, w: 1, h: 1 });
    else {
      const page = { id: uid('p'), cells: [{ id: uid('c'), kind: 'app', ref: app.id, x: 0, y: 0, w: 1, h: 1 }] };
      lay.pages.push(page);
    }
  }

  // 空页删除(第一页除外)
  lay.pages = lay.pages.filter((p, i) => i === 0 || p.cells.length > 0);
  if (!lay.pages.length) lay.pages = [{ id: uid('p'), cells: [] }];

  const n = lay.pages.length;
  lay.currentPage = Math.min(Math.max(0, lay.currentPage | 0), n - 1);
  return lay;
}

export function healAndSave() {
  const healed = heal(layout.get());
  layout.replace(healed);
  return healed;
}

export function rowsOf(page) {
  return Math.max(4, ...(page.cells || []).map(c => c.y + c.h));
}

export function removePage(i) {
  const lay = structuredClone(layout.get());
  if (lay.pages.length <= 1 || i === 0) return false;
  if ((lay.pages[i].cells || []).length) return false;
  lay.pages.splice(i, 1);
  lay.currentPage = Math.min(lay.currentPage, lay.pages.length - 1);
  layout.replace(lay);
  return true;
}

export function addPage() {
  const lay = structuredClone(layout.get());
  lay.pages.push({ id: uid('p'), cells: [] });
  lay.currentPage = lay.pages.length - 1;
  layout.replace(lay);
}

export function setPage(i) {
  const lay = layout.get();
  if (i < 0 || i >= lay.pages.length || i === lay.currentPage) return;
  layout.set({ currentPage: i });
}

export function moveCell(pageIdx, cellId, x, y) {
  const lay = structuredClone(layout.get());
  const page = lay.pages[pageIdx];
  const cell = page?.cells.find(c => c.id === cellId);
  if (!cell) return;
  const others = page.cells.filter(c => c.id !== cellId);
  if (!fits(occupy(others), x, y, cell.w, cell.h)) return;
  cell.x = x; cell.y = y;
  layout.replace(lay);
}

export function swapCells(pageIdx, aId, bId) {
  const lay = structuredClone(layout.get());
  const page = lay.pages[pageIdx];
  const a = page?.cells.find(c => c.id === aId);
  const b = page?.cells.find(c => c.id === bId);
  if (!a || !b || a.w !== b.w || a.h !== b.h) return;
  [a.x, b.x] = [b.x, a.x];
  [a.y, b.y] = [b.y, a.y];
  layout.replace(lay);
}

export function setCellConfig(cellId, config) {
  const lay = structuredClone(layout.get());
  for (const page of lay.pages) {
    const cell = page.cells.find(c => c.id === cellId);
    if (cell) {
      cell.config = { ...(cell.config || {}), ...config };
      layout.replace(lay);
      return cell.config;
    }
  }
  return null;
}

export function findCellByWidget(widgetId) {
  for (const page of layout.get().pages) {
    const cell = page.cells.find(c => c.kind === 'widget' && c.ref === widgetId);
    if (cell) return cell;
  }
  return null;
}

export function setDockSlot(i, appId) {
  const lay = structuredClone(layout.get());
  lay.dock[i] = appId;
  layout.replace(lay);
}
