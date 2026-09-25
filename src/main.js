import { html, render } from './lib.js';
import { ready, settings } from './system/db/index.js';
import { registerApps } from './apps/index.js';
import { setConcurrency } from './system/ai/queue.js';
import { resumeClips } from './system/ai/reply.js';
import { healAndSave } from './screens/home/layout.js';
import { Root } from './shell/Root.js';
import { applyLook, applyCustomCSS } from './system/look.js';
import { migrateLegacy } from './system/ai/services.js';
import { migrateFrames } from './system/skin.js';
import { nav } from './system/nav.js';
import { forceUpdate } from './system/refresh.js';
import { lockAtBoot } from './system/pinlock.js';
import { BUILD } from './version.js';
import { gate, watch as watchAuth } from './system/auth.js';
import { Login } from './shell/Login.js';
import { install as holdViewport } from './system/viewport.js';
import { install as installFullscreen } from './system/fullscreen.js';
import { install as installDiag } from './system/diag.js';
import { install as markChannel } from './system/channel.js';
import { install as installOffline } from './system/offline.js';
import { install as installBgPush } from './system/bgpush.js';
import * as move from './system/move.js';
import './screens/home/widgets.js';
import './screens/home/insWidgets.js';

const mount = document.getElementById('app');
// 键盘收起后把整页推回原位（见 system/viewport.js）。登录页也要，所以放在最前
holdViewport();
// 地址加 ?diag 时屏幕中间显示几项布局读数，排查真机上空出来的那一条
installDiag();
// 测试版挂一枚标记（见 system/channel.js）。登录页也要，所以放在最前
markChannel();

// 启动画面在 index.html 里，第一帧就在（见那边的注释）。画出第一屏之后淡出、摘掉
function dropSplash() {
  const el = document.getElementById('splash');
  if (!el || el.classList.contains('is-gone')) return;
  el.classList.add('is-gone');
  setTimeout(() => el.remove(), 320);
}

function boot() {
  ready.then(() => {
    migrateLegacy();
    migrateFrames();
    registerApps();
    healAndSave();

    const s = settings.get();
    document.documentElement.dataset.theme = s.theme;
    applyLook(s);
    applyCustomCSS(s.customCSS);
    setConcurrency(2);
    // 没等完的视频任务接着等。不重新提交，只是接着问那个 task_id
    resumeClips();
    if (!s.showLockScreen) nav.set({ screen: 'home' });
    // 设了锁屏密码：「启动时显示锁屏」关着也先锁上（system/pinlock.js）
    lockAtBoot();
    // 浏览器标签页里点一下进全屏（见 system/fullscreen.js）
    installFullscreen();

    render(html`<${Root}/>`, mount);
    dropSplash();
    // 代码存到本机，下一次打开从本机取（sw.js，ARCHITECTURE 4.220）。版本对不上时不会走到这里
    installOffline();
    // 后台消息：离开时把任务交给推送服务器，回来时把替你发出去的取回来（system/bgpush.js）
    installBgPush();
    askToMove();
  }).catch(err => {
    console.error('[boot] 启动失败', err);
    render(html`
      <div class="boot boot-error">
        <div class="boot-title">启动失败</div>
        <div class="boot-msg">${String(err.message || err)}</div>
        <div class="boot-hint">若是首次运行，请确认浏览器允许使用 IndexedDB。</div>
      </div>`, mount);
    dropSplash();
  });
}

// 缓存里的 js 是不是旧的。
//
// 无构建方案没有文件指纹，浏览器会把 js 一直留在 HTTP 缓存里，而且是**新旧混着**：
// 这次新加的文件从没被缓存过，一定是新的；旧文件却可能还是上一版。
// 于是新页面调用了旧模块里还不存在的函数，直接炸在运行时 —— 已经这么炸过一次。
//
// index.html 是导航请求，浏览器对它的重新验证比对子资源积极得多，
// 所以拿 HTML 里那行 meta 当「真实版本」，和 version.js 一比就知道缓存有没有落后。
//
// ---- 自愈失败的时候不许安静地照常开 ----
//
// 从前是「愈过一次就记上，以后再对不上也直接开」。记号还是在真正重载**之前**
// 写的。于是只要那一次重载没能换掉 js（WKWebView 上很常见），这台设备就
// **永远**以新旧混着的代码开机，而且一声不响：屏幕上的东西时好时坏，
// 看不出和版本有关。「刷新之后图标画不出来」就是这么来的。
//
// 现在记的是**试了几次**，最多试两次：
//   第一次  把同源的 js/css 全部 cache:'reload' 取一遍，再 reload
//   第二次  同上，但换成带查询串的地址 —— 换个地址，文档本身也要重新验证
//   第三次  不再试，照常开，但顶上挂一条明说「代码是旧的」，给一个按钮
//
// 版本对上了就把记号清掉，下一版该愈照样愈。
const declared = document.querySelector('meta[name="build"]')?.content || '';
const HEAL_KEY = 'build-heal';
const HEAL_MAX = 2;

// localStorage 优先，隐私模式下退回 sessionStorage。
// 从前只记在 sessionStorage：外壳重新载入网页（回到前台、点通知进来、
// 网页进程被回收）都会开一个新 session，记号跟着没了，于是每次进来都要
// 再愈一次、再重载一遍 —— 人看到的就是「点一下通知，小手机自己刷新了一遍」。
function readHeal() {
  for (const box of [() => localStorage, () => sessionStorage]) {
    try {
      const raw = box().getItem(HEAL_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* 隐私模式会抛 */ }
  }
  return null;
}
function writeHeal(v) {
  const raw = v == null ? null : JSON.stringify(v);
  for (const box of [() => localStorage, () => sessionStorage]) {
    try { raw == null ? box().removeItem(HEAL_KEY) : box().setItem(HEAL_KEY, raw); }
    catch { /* 同上 */ }
  }
}

/** 顶上那一条。DOM 直接写，不经过任何模块 —— 出问题的正是那些模块。 */
function showStale() {
  const bar = document.getElementById('stale');
  if (!bar) return;
  bar.classList.add('is-on');
  const btn = document.getElementById('stale-go');
  if (btn) {
    btn.onclick = () => {
      writeHeal(null);
      forceUpdate().finally(() => location.replace(bustedUrl()));
    };
  }
}

/** 带查询串的本页地址。换个地址，浏览器对文档本身也要重新验证一次。 */
const bustedUrl = () =>
  `${location.pathname}?v=${encodeURIComponent(declared)}.${Date.now().toString(36)}`;

const heal = readHeal();
const tries = heal && heal.build === declared ? Math.max(0, heal.tries | 0) : 0;
const stale = !!declared && declared !== BUILD;

if (stale && tries < HEAL_MAX) {
  console.warn(`[boot] 代码版本对不上：页面声明 ${declared}，实际加载 ${BUILD}。`
    + `正在更新（第 ${tries + 1} 次）`);
  writeHeal({ build: declared, tries: tries + 1 });
  // 启动画面留着，底下那行字换成这一句，马上显示
  const note = document.getElementById('splash-note');
  if (note) { note.textContent = '正在更新到最新版本'; note.classList.add('is-now'); }
  // 第一次原地重载就够了；还不行说明连文档都在拿缓存，换个地址再来
  forceUpdate().finally(() => {
    if (tries === 0) location.reload();
    else location.replace(bustedUrl());
  });
} else {
  if (stale) {
    console.error(`[boot] 自愈 ${HEAL_MAX} 次仍然对不上：页面声明 ${declared}，实际加载 ${BUILD}`);
    showStale();
  } else if (heal) {
    writeHeal(null);        // 对上了，记号清掉
  }
  enter();
}

/**
 * 换了网址（system/move.js）：旧网址上提醒搬到新网址；新网址上还没有数据时，问要不要从旧网址搬过来。
 * 一天问一次，点「稍后」就等明天。真正的入口在「设置 - 存储」，这里只是提醒一句
 */
async function askToMove() {
  if (!move.isOld() && !move.isNew()) return;
  const KEY = 'eira-move-asked';
  try {
    if (Date.now() - Number(localStorage.getItem(KEY) || 0) < 86400000) return;
    localStorage.setItem(KEY, String(Date.now()));
  } catch { /* 隐私模式记不住，照样问 */ }
  const db = await import('./system/db/index.js');
  if (move.isNew() && (db.characters.count() || db.chats.count())) return;
  const { confirm, toast } = await import('./ui/index.js');
  const ok = await confirm(move.isOld()
    ? { title: 'Eira 已换到新网址', okText: '搬家', cancelText: '稍后',
      message: `新网址：${move.newUrl()}\n浏览器里的数据按网址分开存，直接打开新网址会是空的。`
        + '点「搬家」把这里的角色、聊天记录、图片与接口设置一起带过去。之后也可以在「设置 - 存储与备份」中操作。' }
    : { title: '从旧网址搬过来', okText: '搬过来', cancelText: '稍后',
      message: '这里是 Eira 的新网址，还没有数据。点「搬过来」把旧网址上的角色、聊天记录、图片与接口设置一起带过来。'
        + '之后也可以在「设置 - 存储与备份」中操作。' });
  if (!ok) return;
  toast('正在搬家，完成前请不要关闭这两个页面', 'ok', 5000);
  (move.isOld() ? move.push() : move.pull())
    .then(r => {
      if (move.isNew()) { toast(`已搬过来：${r.rows || 0} 条记录`, 'ok', 4000); setTimeout(() => location.reload(), 1500); }
      else toast('已搬到新网址。以后请从新网址打开', 'ok', 6000);
    })
    .catch(err => toast(`搬家没有完成：${err.message || err}。可在「设置 - 存储与备份」中重试`, 'error', 8000));
}

// 进门：本站开了账号功能就先登录（见 system/auth.js）。没开的话 gate 立刻放行
async function enter() {
  // 旧网址用 ?move=in 打开了这里（搬家，system/move.js）：先把数据收下，再按原样进门。
  // 启动画面底下那行字换成进度
  const moving = move.receive({ onStatus: t => {
    const note = document.getElementById('splash-note');
    if (note) { note.textContent = t; note.classList.add('is-now'); }
  } });
  if (moving) {
    const note = document.getElementById('splash-note');
    if (note) { note.textContent = '正在等待旧网址发来数据'; note.classList.add('is-now'); }
    try { await moving; } catch (err) {
      console.error('[move] 没搬成', err);
      if (note) note.textContent = `搬家没有完成：${err.message || err}`;
      await new Promise(r => setTimeout(r, 5000));
    }
    location.replace(location.pathname);
    return;
  }
  const g = await gate();
  if (g.ok) { watchAuth(); boot(); return; }
  render(html`<${Login} note=${g.note || ''} offline=${!!g.offline} onDone=${() => { watchAuth(); boot(); }}/>`, mount);
  dropSplash();
}
