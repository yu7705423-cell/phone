import { layout } from '../../system/db/index.js';
import { hasApp, hasWidget, listApps, getWidget } from '../../system/registry.js';
import { GRID_COLS, DOCK_SIZE } from '../../system/db/defaults.js';
import { uid } from '../../system/store.js';

export const MIN_ROWS = 6;

// 没有「占位格」这种记录。空位是算出来的：网格里凡是没被占的坐标都可以点。
// 这样图标可以直接挪到任何空白处，而不是只能和同样大小的位置交换。
export function occupied(cells, skipId) {
  const taken = new Map();
  for (const c of cells) {
    if (c.id === skipId) continue;
    for (let dy = 0; dy < c.h; dy++) {
      for (let dx = 0; dx < c.w; dx++) taken.set(`${c.x + dx},${c.y + dy}`, c);
    }
  }
  return taken;
}

export function fits(taken, x, y, w, h) {
  if (x < 0 || x + w > GRID_COLS || y < 0) return false;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) if (taken.has(`${x + dx},${y + dy}`)) return false;
  }
  return true;
}

// 整理时多留一行，页面摆满了也有地方可以放东西
export function rowsOf(page, editing = false) {
  const need = Math.max(0, ...(page.cells || []).map(c => c.y + c.h));
  return Math.max(MIN_ROWS, need + (editing ? 1 : 0));
}

// 页面里所有空坐标，供渲染成可点的空格子
export function freeSlots(page, rows) {
  const taken = occupied(page.cells || []);
  const out = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < GRID_COLS; x++) {
      if (!taken.has(`${x},${y}`)) out.push({ x, y });
    }
  }
  return out;
}

function findSpot(page, w, h, skipId) {
  const taken = occupied(page.cells || [], skipId);
  for (let y = 0; y < 60; y++) {
    for (let x = 0; x <= GRID_COLS - w; x++) {
      if (fits(taken, x, y, w, h)) return { x, y };
    }
  }
  return null;
}

// 把被挤走的格子安置到别处：本页空位优先，其次下一页，都没有就新建一页
function relocate(lay, pageIdx, cell) {
  const spot = findSpot(lay.pages[pageIdx], cell.w, cell.h);
  if (spot) { lay.pages[pageIdx].cells.push({ ...cell, ...spot }); return; }
  for (let i = pageIdx + 1; i < lay.pages.length; i++) {
    const s = findSpot(lay.pages[i], cell.w, cell.h);
    if (s) { lay.pages[i].cells.push({ ...cell, ...s }); return; }
  }
  lay.pages.push({ id: uid('p'), cells: [{ ...cell, x: 0, y: 0 }] });
}

// 在指定坐标放东西。挡路的格子会被挪走，而不是拒绝放置。
export function placeAtXY(pageIdx, x, y, next) {
  const lay = structuredClone(layout.get());
  const page = lay.pages[pageIdx];
  if (!page) return { ok: false, reason: '页面不存在' };

  const w = Math.max(1, Math.min(GRID_COLS, next.w || 1));
  const h = Math.max(1, next.h || 1);
  const px = Math.min(x, GRID_COLS - w);
  if (px < 0) return { ok: false, reason: '一行只有四格，放不下这个宽度' };

  const displaced = page.cells.filter(c =>
    c.x < px + w && c.x + c.w > px && c.y < y + h && c.y + c.h > y);
  page.cells = page.cells.filter(c => !displaced.some(d => d.id === c.id));
  page.cells.push({ id: uid('c'), x: px, y, w, h, ...next });
  displaced.forEach(c => relocate(lay, pageIdx, c));

  layout.replace(lay);
  return { ok: true };
}

export function placeAt(pageIdx, cellId, next) {
  const page = layout.get().pages[pageIdx];
  const cell = page?.cells.find(c => c.id === cellId);
  if (!cell) return { ok: false, reason: '位置不存在' };
  const lay = structuredClone(layout.get());
  lay.pages[pageIdx].cells = lay.pages[pageIdx].cells.filter(c => c.id !== cellId);
  layout.replace(lay);
  return placeAtXY(pageIdx, cell.x, cell.y, next);
}

// 移到某个坐标。目标被占就交换，占不下就把对方挪走。
export function moveTo(pageIdx, cellId, x, y) {
  const lay = structuredClone(layout.get());
  const page = lay.pages[pageIdx];
  const cell = page?.cells.find(c => c.id === cellId);
  if (!cell) return { ok: false, reason: '位置不存在' };

  const px = Math.min(Math.max(0, x), GRID_COLS - cell.w);
  const others = page.cells.filter(c => c.id !== cellId);
  const hit = others.filter(c =>
    c.x < px + cell.w && c.x + c.w > px && c.y < y + cell.h && c.y + c.h > y);

  // 正好和一个同样大小的格子重合：直接对调，最符合直觉
  if (hit.length === 1 && hit[0].w === cell.w && hit[0].h === cell.h) {
    const other = hit[0];
    const ox = other.x, oy = other.y;
    other.x = cell.x; other.y = cell.y;
    cell.x = ox; cell.y = oy;
    layout.replace(lay);
    return { ok: true };
  }

  page.cells = page.cells.filter(c => !hit.some(v => v.id === c.id));
  cell.x = px; cell.y = y;
  hit.forEach(c => relocate(lay, pageIdx, c));
  layout.replace(lay);
  return { ok: true };
}

// 统一的挪动入口。来源和目标都可能是网格里的格子、网格里的空位，或 Dock 的槽位。
// 网格与 Dock 之间也要能互换，所以放在一个函数里处理，而不是各写各的。
export function movePicked(pageIdx, source, target) {
  const lay = structuredClone(layout.get());
  const page = lay.pages[pageIdx];
  if (!page) return { ok: false, reason: '页面不存在' };
  lay.dock = Array.from({ length: DOCK_SIZE }, (_, i) => (lay.dock || [])[i] || null);

  const cellOf = id => page.cells.find(c => c.id === id);

  // Dock 只放应用
  if (target.type === 'dock') {
    if (source.type === 'dock') {
      const t = lay.dock[target.i];
      lay.dock[target.i] = lay.dock[source.i];
      lay.dock[source.i] = t;
      layout.replace(lay);
      return { ok: true };
    }
    const cell = cellOf(source.id);
    if (!cell) return { ok: false, reason: '来源不存在' };
    if (cell.kind !== 'app') return { ok: false, reason: '底部那一排只能放应用' };
    if (cell.w !== 1 || cell.h !== 1) return { ok: false, reason: '只能放 1x1 的应用' };

    const displaced = lay.dock[target.i];
    lay.dock[target.i] = cell.ref;
    page.cells = page.cells.filter(c => c.id !== cell.id);
    if (displaced) {
      page.cells.push({ id: uid('c'), kind: 'app', ref: displaced, x: cell.x, y: cell.y, w: 1, h: 1 });
    }
    layout.replace(lay);
    return { ok: true };
  }

  if (source.type === 'dock') {
    const appId = lay.dock[source.i];
    if (!appId) return { ok: false, reason: '这个位置是空的' };

    if (target.type === 'slot') {
      lay.dock[source.i] = null;
      page.cells.push({ id: uid('c'), kind: 'app', ref: appId, x: target.x, y: target.y, w: 1, h: 1 });
      layout.replace(lay);
      return { ok: true };
    }
    const cell = cellOf(target.id);
    if (!cell) return { ok: false, reason: '目标不存在' };
    if (cell.kind !== 'app' || cell.w !== 1 || cell.h !== 1) {
      return { ok: false, reason: '底部那一排只能和 1x1 的应用互换' };
    }
    lay.dock[source.i] = cell.ref;
    cell.kind = 'app'; cell.ref = appId;
    layout.replace(lay);
    return { ok: true };
  }

  // 网格内部的挪动交给 moveTo
  const dest = target.type === 'slot' ? target : cellOf(target.id);
  if (!dest) return { ok: false, reason: '目标不存在' };
  return moveTo(pageIdx, source.id, dest.x, dest.y);
}

export function clearDockSlot(i) {
  const lay = structuredClone(layout.get());
  lay.dock = Array.from({ length: DOCK_SIZE }, (_, k) => (lay.dock || [])[k] || null);
  lay.dock[i] = null;
  layout.replace(lay);
}

export function clearCell(pageIdx, cellId) {
  const lay = structuredClone(layout.get());
  const page = lay.pages[pageIdx];
  if (!page) return false;
  const before = page.cells.length;
  page.cells = page.cells.filter(c => c.id !== cellId);
  if (page.cells.length === before) return false;
  layout.replace(lay);
  return true;
}

// 自愈。引用失效的直接去掉，留下的空位本来就可点，不需要再造占位记录。
export function heal(raw) {
  const lay = structuredClone(raw);
  lay.pages = Array.isArray(lay.pages) && lay.pages.length ? lay.pages : [{ id: uid('p'), cells: [] }];
  const seen = new Set();

  for (const page of lay.pages) {
    const kept = [];
    for (const cell of (page.cells || [])) {
      const c = { ...cell };
      c.w = Math.max(1, Math.min(GRID_COLS, c.w | 0 || 1));
      c.h = Math.max(1, Math.min(6, c.h | 0 || 1));
      if (!c.id) c.id = uid('c');

      if (c.kind === 'app') {
        if (!hasApp(c.ref) || seen.has(c.ref)) continue;
        seen.add(c.ref);
      } else if (c.kind === 'widget') {
        if (!hasWidget(c.ref)) continue;
      } else {
        continue;                       // 旧数据里的 placeholder 记录一并清掉
      }

      const taken = occupied(kept);
      if (!fits(taken, c.x, c.y, c.w, c.h)) {
        const spot = findSpot({ cells: kept }, c.w, c.h);
        if (!spot) continue;
        c.x = spot.x; c.y = spot.y;
      }
      kept.push(c);
    }
    page.cells = kept;
  }

  const dock = Array.from({ length: DOCK_SIZE }, (_, i) => {
    const id = (lay.dock || [])[i];
    return id && hasApp(id) ? id : null;
  });
  dock.forEach(id => id && seen.add(id));
  lay.dock = dock;

  // 已注册但没摆出来的 app：找个空位放上
  for (const app of listApps()) {
    if (app.showOnHome === false || seen.has(app.id)) continue;
    let done = false;
    for (let i = 0; i < lay.pages.length && !done; i++) {
      const spot = findSpot(lay.pages[i], 1, 1);
      if (spot) {
        lay.pages[i].cells.push({ id: uid('c'), kind: 'app', ref: app.id, ...spot, w: 1, h: 1 });
        done = true;
      }
    }
    if (!done) {
      lay.pages.push({ id: uid('p'), cells: [{ id: uid('c'), kind: 'app', ref: app.id, x: 0, y: 0, w: 1, h: 1 }] });
    }
    seen.add(app.id);
  }

  lay.pages = lay.pages.filter((p, i) => i === 0 || p.cells.length > 0);
  if (!lay.pages.length) lay.pages = [{ id: uid('p'), cells: [] }];
  lay.currentPage = Math.min(Math.max(0, lay.currentPage | 0), lay.pages.length - 1);
  return lay;
}

export function healAndSave() {
  const healed = heal(layout.get());
  layout.replace(healed);
  return healed;
}

export function addPage() {
  const lay = structuredClone(layout.get());
  lay.pages.push({ id: uid('p'), cells: [] });
  lay.currentPage = lay.pages.length - 1;
  layout.replace(lay);
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

export function setPage(i) {
  const lay = layout.get();
  if (i < 0 || i >= lay.pages.length || i === lay.currentPage) return;
  layout.set({ currentPage: i });
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

export function setDockSlot(i, appId) {
  const lay = structuredClone(layout.get());
  lay.dock[i] = appId;
  layout.replace(lay);
}
