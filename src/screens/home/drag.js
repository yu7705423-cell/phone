import { createStore } from '../../system/store.js';
import { editState } from './editState.js';

/**
 * 主屏的拖动。见 ARCHITECTURE 4.169
 *
 * 从前挪一个图标要：长按进整理、点它、在弹出的表里点「移动」、再点目标 ——
 * 四步，而且手指离开屏幕之后才知道会落在哪。现在是按住就拖：
 *
 *   - 整理模式下按住一个格子，挪动超过几个像素就拿起来
 *   - 平时长按进整理模式，**手指不用松开**，接着挪就拿起来（和系统主屏一样）
 *   - 拿起来的那一格变淡留在原处，一个跟手的影子贴着手指走；
 *     网格上画出它会落在哪几格，dock 上亮出会落在哪一格
 *   - 贴着屏幕左右边缘停一会儿就翻页，可以一路拖到别的页
 *   - 松手落下；落不下（在网格和 dock 之外）就回原处
 *
 * 影子是克隆出来挂在 body 上的一份死 DOM，不归 preact 管 —— 翻页时原来那一格
 * 已经不在屏幕上了，影子得活得比它久。
 *
 * 网格与 dock 两边都能起拖、都能落，状态放在这一个 store 里两边一起读。
 * 落下之后真正怎么挪，由主屏注册进来的 onDrop 决定（它知道当前是哪一页）。
 */

export const dragState = createStore({ src: null, over: null });

// 主屏把网格的几何与落下时的处理登记进来。每次渲染都更新，
// 这样拖到一半翻了页，落下时用的是翻过去的那一页
let grid = null;
export const bindGrid = g => { grid = g; };

const START = 6;          // 挪动多少像素算拿起来
const EDGE = 22;          // 离屏幕边缘多近算贴边
const EDGE_WAIT = 520;    // 贴边停多久翻页

let g = null;             // 当前这一下手势
let endedAt = 0;

/** 刚拖完。松手时浏览器可能补一个 click，拿它把那一下吞掉 */
export const justDragged = () => Date.now() - endedAt < 350;
/** 此刻正拖着。主屏的左右滑动翻页要让路 */
export const dragging = () => !!g?.started;

export function pressStart(e, src, el) {
  if (e.button > 0 || g) return;
  g = { src, el, x0: e.clientX, y0: e.clientY, pid: e.pointerId, started: false };
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
}

function begin(e) {
  const r = g.el.getBoundingClientRect();
  const ghost = g.el.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.classList.remove('is-edit', 'is-picked', 'is-lifted');
  ghost.removeAttribute('id');
  // 影子不是格子：带着这两个记号的话，按记号找格子、找 dock 槽位的地方会把它也算进去
  ghost.removeAttribute('data-cell');
  ghost.removeAttribute('data-dock-slot');
  Object.assign(ghost.style, {
    left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
  });
  document.body.appendChild(ghost);
  g.ghost = ghost;
  g.rect = r;
  g.dx = g.x0 - r.left;
  g.dy = g.y0 - r.top;
  g.started = true;
  try { navigator.vibrate?.(8); } catch { /* 不支持就算了 */ }
  dragState.set({ src: g.src, over: null });
}

function place(x, y) {
  const tx = x - g.dx - g.rect.left;
  const ty = y - g.dy - g.rect.top;
  g.ghost.style.transform = `translate(${tx}px, ${ty}px) scale(1.06)`;
}

// 手指底下是哪里。dock 靠元素判断（影子不接指针，看得穿它），
// 网格靠算：空白处也要能落，而空白处不一定有元素
function overAt(x, y) {
  const slot = document.elementFromPoint(x, y)?.closest?.('[data-dock-slot]');
  if (slot) return { type: 'dock', i: Number(slot.dataset.dockSlot) };
  if (!grid?.el) return null;
  const box = grid.el.getBoundingClientRect();
  if (x < box.left - 8 || x > box.right + 8 || y < box.top - 8 || y > box.bottom + 8) return null;
  const step = grid.cell + grid.gap;
  const w = g.src.w || 1;
  const h = g.src.h || 1;
  // 按影子左上角算落点，不按手指：拿的是大挂件的右下角时，手指在右下，
  // 落点却是它的左上角那一格
  const left = x - g.dx - box.left;
  const top = y - g.dy - box.top;
  const cx = Math.max(0, Math.min(grid.cols - w, Math.round(left / step)));
  const cy = Math.max(0, Math.min(Math.max(0, grid.rows - h), Math.round(top / step)));
  return { type: 'slot', x: cx, y: cy, w, h };
}

function edge(x) {
  const dir = x < EDGE ? -1 : x > window.innerWidth - EDGE ? 1 : 0;
  if (dir === g.edgeDir) return;
  clearTimeout(g.edgeTimer);
  g.edgeDir = dir;
  if (!dir) return;
  const flip = () => {
    if (!g?.started || g.edgeDir !== dir) return;
    grid?.onPage?.(dir);
    g.edgeTimer = setTimeout(flip, EDGE_WAIT + 380);
  };
  g.edgeTimer = setTimeout(flip, EDGE_WAIT);
}

function onMove(e) {
  if (!g || e.pointerId !== g.pid) return;
  if (!g.started) {
    const far = Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > START;
    if (!far) return;
    // 不在整理模式里的挪动是翻页或者别的手势，不归这里管
    if (!editState.get().edit) { finish(); return; }
    begin(e);
  }
  if (e.cancelable) e.preventDefault();
  place(e.clientX, e.clientY);
  const over = overAt(e.clientX, e.clientY);
  const cur = dragState.get().over;
  if (JSON.stringify(over) !== JSON.stringify(cur)) dragState.set({ over });
  edge(e.clientX);
}

function onUp(e) {
  if (!g || e.pointerId !== g.pid) return;
  if (g.started) {
    const over = overAt(e.clientX, e.clientY);
    const at = g.ghost.getBoundingClientRect();
    grid?.onDrop?.(g.src, over, at);
    endedAt = Date.now();
  }
  finish();
}

function onCancel(e) {
  if (!g || e.pointerId !== g.pid) return;
  if (g.started) grid?.onDrop?.(g.src, null, g.ghost.getBoundingClientRect());
  finish();
}

function finish() {
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onCancel);
  if (g) {
    clearTimeout(g.edgeTimer);
    g.ghost?.remove();
    if (g.started) dragState.set({ src: null, over: null });
  }
  g = null;
}
