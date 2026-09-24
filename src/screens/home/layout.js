import { layout } from '../../system/db/index.js';
import { hasApp, listApps, getWidget } from '../../system/registry.js';
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

// 离原来那一格最近的空位。被挤走的格子就近让开，而不是一下跳到页面最上面的空处 ——
// 拖动时这些格子是当场滑过去的，跳得远了看不出它去了哪儿。
// 只在这一页已经用到的行数（至少 MIN_ROWS）里找，不往屏幕外面放
function nearestSpot(page, w, h, ox, oy) {
  const taken = occupied(page.cells || []);
  const maxY = Math.max(MIN_ROWS, ...(page.cells || []).map(c => c.y + c.h)) - h;
  let best = null;
  let bestD = Infinity;
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= GRID_COLS - w; x++) {
      if (!fits(taken, x, y, w, h)) continue;
      // 竖着挪比横着挪更打眼，稍微加一点分量
      const d = (x - ox) ** 2 + 1.3 * (y - oy) ** 2;
      if (d < bestD) { bestD = d; best = { x, y }; }
    }
  }
  return best;
}

// 把被挤走的格子安置到别处：本页就近的空位优先，其次下一页，都没有就新建一页
function relocate(lay, pageIdx, cell) {
  const spot = nearestSpot(lay.pages[pageIdx], cell.w, cell.h, cell.x, cell.y)
    || findSpot(lay.pages[pageIdx], cell.w, cell.h);
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
  const lay = structuredClone(layout.get());
  const found = locate(lay, cellId);
  if (!found) return { ok: false, reason: '位置不存在' };
  const { cell } = found;
  found.page.cells = found.page.cells.filter(c => c.id !== cellId);
  layout.replace(lay);
  return placeAtXY(found.pageIdx, cell.x, cell.y, next);
}

// 按 id 在**整本**布局里找一个格子。跨页挪动全靠它 —— 从前每个操作
// 都只在「当前页」里找，于是先选中、再翻一页、再点目标，源头就找不着了，
// 报一句「位置不存在」，看着像整页没了。
export function locate(lay, cellId) {
  for (let i = 0; i < lay.pages.length; i++) {
    const cell = (lay.pages[i].cells || []).find(c => c.id === cellId);
    if (cell) return { pageIdx: i, page: lay.pages[i], cell };
  }
  return null;
}

// 移到某个坐标。目标被占就交换，占不下就把对方挪走。
// toPageIdx 是**目标页**，源头在哪一页由 locate 自己找。
export function moveTo(toPageIdx, cellId, x, y) {
  const lay = structuredClone(layout.get());
  const r = planMove(lay, toPageIdx, cellId, x, y);
  if (r.ok) layout.replace(lay);
  return r;
}

/**
 * 只算不存：在传进来的这份布局上把格子挪过去，挤走的、对调的都安置好。
 * 拖动时拿它算「松手会变成什么样」提前画出来（其他图标先让开），
 * 松手时 moveTo 走的是同一段 —— 预览和结果不会对不上。
 */
export function planMove(lay, toPageIdx, cellId, x, y) {
  const dest = lay.pages[toPageIdx];
  if (!dest) return { ok: false, reason: '页面不存在' };
  const found = locate(lay, cellId);
  if (!found) return { ok: false, reason: '位置不存在' };
  const { cell } = found;
  const from = found.page;
  const fromIdx = found.pageIdx;

  const px = Math.min(Math.max(0, x), GRID_COLS - cell.w);
  const others = dest.cells.filter(c => c.id !== cellId);
  const hit = others.filter(c =>
    c.x < px + cell.w && c.x + c.w > px && c.y < y + cell.h && c.y + c.h > y);

  // 正好和一个同样大小的格子重合：直接对调，最符合直觉。
  // 跨页的时候对调的是「页 + 坐标」，两个格子各自搬到对方那一页去。
  if (hit.length === 1 && hit[0].w === cell.w && hit[0].h === cell.h) {
    const other = hit[0];
    const ox = other.x, oy = other.y;
    other.x = cell.x; other.y = cell.y;
    cell.x = ox; cell.y = oy;
    if (fromIdx !== toPageIdx) {
      from.cells = from.cells.filter(c => c.id !== cell.id);
      dest.cells = dest.cells.filter(c => c.id !== other.id);
      dest.cells.push(cell);
      from.cells.push(other);
    }
    return { ok: true };
  }

  from.cells = from.cells.filter(c => c.id !== cell.id);
  dest.cells = dest.cells.filter(c => !hit.some(v => v.id === c.id));
  cell.x = px; cell.y = y;
  dest.cells.push(cell);
  hit.forEach(c => relocate(lay, toPageIdx, c));
  return { ok: true };
}

// 统一的挪动入口。来源和目标都可能是网格里的格子、网格里的空位，或 Dock 的槽位。
// 网格与 Dock 之间也要能互换，所以放在一个函数里处理，而不是各写各的。
export function movePicked(pageIdx, source, target) {
  const lay = structuredClone(layout.get());
  const page = lay.pages[pageIdx];
  if (!page) return { ok: false, reason: '页面不存在' };
  lay.dock = Array.from({ length: DOCK_SIZE }, (_, i) => (lay.dock || [])[i] || null);

  // 整本布局里找，不是只在当前页里找：先选中、翻一页、再点目标，
  // 这是最常见的跨页挪动，源头本来就不在这一页上。
  const cellOf = id => locate(lay, id)?.cell || null;

  // Dock 只放应用
  if (target.type === 'dock') {
    if (source.type === 'dock') {
      const t = lay.dock[target.i];
      lay.dock[target.i] = lay.dock[source.i];
      lay.dock[source.i] = t;
      layout.replace(lay);
      return { ok: true };
    }
    const found = locate(lay, source.id);
    if (!found) return { ok: false, reason: '来源不存在' };
    const { cell } = found;
    if (cell.kind !== 'app') return { ok: false, reason: '底部那一排只能放应用' };
    if (cell.w !== 1 || cell.h !== 1) return { ok: false, reason: '只能放 1x1 的应用' };

    const displaced = lay.dock[target.i];
    lay.dock[target.i] = cell.ref;
    // 空出来的那一格留在原来那一页上，不要跟着当前页跑
    found.page.cells = found.page.cells.filter(c => c.id !== cell.id);
    if (displaced) {
      found.page.cells.push({ id: uid('c'), kind: 'app', ref: displaced, x: cell.x, y: cell.y, w: 1, h: 1 });
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
    // 目标一定在当前页上（是点出来的），所以就地改就行
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

/**
 * 移除一个格子。
 *
 * app 格子要顺手记进 removed —— 否则下一次 heal 看见「这个 app 没摆出来」，
 * 又给它找个空位放回去，移除就成了刷新一下就复活。文件夹里装着的 app
 * 一并记上，道理一样。
 */
export function clearCell(pageIdx, cellId) {
  const lay = structuredClone(layout.get());
  const found = locate(lay, cellId);
  if (!found) return false;
  const { cell } = found;
  found.page.cells = found.page.cells.filter(c => c.id !== cellId);
  const gone = cell.kind === 'app' ? [cell.ref]
    : cell.kind === 'folder' ? (cell.apps || []) : [];
  if (gone.length) lay.removed = [...new Set([...(lay.removed || []), ...gone])];
  layout.replace(lay);
  return true;
}

// 放回来。把它从 removed 里划掉，heal 就会重新给它找位置。
export function restoreApp(appId) {
  const lay = structuredClone(layout.get());
  lay.removed = (lay.removed || []).filter(id => id !== appId);
  layout.replace(lay);
  healAndSave();
}

// 移除过、现在不在主界面上的那些。设置里那一页要列它们
export function removedApps() {
  const lay = layout.get();
  return (lay.removed || []).filter(hasApp);
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
      } else if (c.kind === 'folder') {
        // 文件夹装的是 app id。失效的、已经在别处摆着的，都从里面剔掉；
        // 剔空了这个文件夹就没有意义了，一并去掉。
        c.apps = (c.apps || []).filter(id => {
          if (!hasApp(id) || seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        if (!c.apps.length) continue;
        c.w = 1; c.h = 1;
        if (!c.name) c.name = '文件夹';
      } else if (c.kind === 'widget') {
        // 不认识的挂件留着，不删：它多半是更新一版加的，而此刻跑的是缓存里的旧代码。
        // 旧代码一删并存回去，新版回来时那个挂件连同它的照片就都没了。
        // 主界面上它画成「挂件缺失」，长按照样能移走
        if (!c.ref) continue;
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

  // 用户自己移除的那些不要再摆回来。摆着的比这张单子说了算 ——
  // 移除完又自己放回去的，要从单子上划掉，否则下次 heal 还当它是被移除的。
  lay.removed = [...new Set(lay.removed || [])].filter(id => hasApp(id) && !seen.has(id));
  const removed = new Set(lay.removed);

  // 已注册但没摆出来的 app：找个空位放上
  for (const app of listApps()) {
    if (app.showOnHome === false || seen.has(app.id) || removed.has(app.id)) continue;
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

/**
 * 自愈，然后存回去 —— **但库里没有这一条时只在内存里愈，不回写**。
 *
 * 这一条是数据丢失修回来的（ARCHITECTURE 4.124）。开机时 `main.js` 会叫一次，
 * 而 `makeKV.load()` 读不到记录就回落成默认布局。从前这里不问来路，照样
 * `replace` 一次 —— 于是「这一次没读到」被当场写成了「用户的布局就是默认的」，
 * 壁纸、自排的图标、文件夹、Dock 全部永久没了，而且一个字的报错都没有。
 *
 * heal 本身是确定的：同一份输入每次愈出同一个结果，所以**开机根本不必回写**。
 * 真正需要落盘的是用户自己改过之后那几次，而那几处都先 `layout.replace` 过了
 * （`stored()` 因此为真），照旧存。
 */
export function healAndSave() {
  const healed = heal(layout.get());
  if (layout.stored()) layout.replace(healed);
  else layout.store.replace(healed);
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

// ---- 文件夹 ----
//
// 文件夹就是一个格子，里面记着一串 app id（`cell.apps`），永远 1x1。
// 不另起一张表：它没有任何脱离主界面单独存在的意义，
// 跟着格子一起挪、一起删最省事。

export function newFolder(pageIdx, x, y, apps = [], name = '文件夹') {
  const list = [...new Set(apps.filter(hasApp))];
  if (!list.length) return { ok: false, reason: '请至少选择一个应用' };
  // 这些 app 现在要进文件夹，先把它们从别处摘下来
  detach(list);
  return placeAtXY(pageIdx, x, y, { kind: 'folder', name: String(name || '文件夹').slice(0, 12), apps: list });
}

/** 不指定位置，自己找个空位建。底栏那几个也是从这里建文件夹的。 */
export function newFolderAuto(pageIdx, apps = [], name = '文件夹') {
  const list = [...new Set(apps.filter(hasApp))];
  if (!list.length) return { ok: false, reason: '请至少选择一个应用' };
  detach(list);
  const lay = layout.get();
  const at = Math.min(pageIdx, Math.max(0, (lay.pages || []).length - 1));
  for (let i = at; i < (lay.pages || []).length; i++) {
    const spot = findSpot(lay.pages[i], 1, 1);
    if (spot) return newFolder(i, spot.x, spot.y, list, name);
  }
  const next = structuredClone(lay);
  next.pages.push({ id: uid('p'), cells: [] });
  layout.replace(next);
  return newFolder(next.pages.length - 1, 0, 0, list, name);
}

/** 改文件夹：名字和里面装什么。装空了就把这个文件夹去掉。 */
export function setFolder(cellId, { name, apps }) {
  if (Array.isArray(apps)) {
    const keep = [...new Set(apps.filter(hasApp))];
    detach(keep, cellId);
    const lay = structuredClone(layout.get());
    const found = locate(lay, cellId);
    if (!found || found.cell.kind !== 'folder') return { ok: false, reason: '这个文件夹不存在了' };
    found.cell.apps = keep;
    if (name !== undefined) found.cell.name = String(name || '文件夹').slice(0, 12);
    if (!keep.length) found.page.cells = found.page.cells.filter(c => c.id !== cellId);
    layout.replace(lay);
    return { ok: true };
  }
  const lay = structuredClone(layout.get());
  const found = locate(lay, cellId);
  if (!found || found.cell.kind !== 'folder') return { ok: false, reason: '这个文件夹不存在了' };
  found.cell.name = String(name || '文件夹').slice(0, 12);
  layout.replace(lay);
  return { ok: true };
}

/** 把这几个 app 从现在待的地方摘下来：网格、Dock、别的文件夹。 */
function detach(appIds, keepCellId) {
  const ids = new Set(appIds);
  const lay = structuredClone(layout.get());
  let dirty = false;
  for (const page of lay.pages) {
    const kept = [];
    for (const c of page.cells) {
      if (c.kind === 'app' && ids.has(c.ref)) { dirty = true; continue; }
      if (c.kind === 'folder' && c.id !== keepCellId) {
        const next = (c.apps || []).filter(id => !ids.has(id));
        if (next.length !== (c.apps || []).length) {
          dirty = true;
          if (!next.length) continue;   // 掏空了就不留这个文件夹
          c.apps = next;
        }
      }
      kept.push(c);
    }
    page.cells = kept;
  }
  lay.dock = (lay.dock || []).map(id => {
    if (id && ids.has(id)) { dirty = true; return null; }
    return id;
  });
  lay.removed = (lay.removed || []).filter(id => !ids.has(id));
  if (dirty || lay.removed.length !== (layout.get().removed || []).length) layout.replace(lay);
}

/** 从文件夹里拿一个 app 出来，摆回主界面。 */
export function takeOut(cellId, appId) {
  const lay = structuredClone(layout.get());
  const found = locate(lay, cellId);
  if (!found || found.cell.kind !== 'folder') return { ok: false, reason: '这个文件夹不存在了' };
  const rest = (found.cell.apps || []).filter(id => id !== appId);
  found.cell.apps = rest;
  if (!rest.length) found.page.cells = found.page.cells.filter(c => c.id !== cellId);
  layout.replace(lay);
  // 摆回去的位置交给 heal 找：它本来就会给「没摆出来的 app」找空位
  healAndSave();
  return { ok: true };
}

/** 把一个已经在主界面上的 app 装进某个文件夹。 */
export function putInFolder(cellId, appId) {
  const lay = layout.get();
  const found = locate(lay, cellId);
  if (!found || found.cell.kind !== 'folder') return { ok: false, reason: '这个文件夹不存在了' };
  return setFolder(cellId, { apps: [...(found.cell.apps || []), appId] });
}
