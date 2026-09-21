import { createStore } from './store.js';
import { emit, EVENTS } from './bus.js';

const MAX_BACKGROUND = 5;

// 系统层单一栈: lock -> home -> app。Dock 只是快捷方式,不构成层级。
export const nav = createStore({
  screen: 'lock',          // lock | home | app
  appId: null,
  stacks: {},              // appId -> [route, ...]
  recents: [],             // 最近使用的 appId,最新在前
  switcher: false,
  // 「过去看一眼就回来」那一跳记下的出发地：
  // { appId, stack, to, depth } —— 出发的 app、它当时那一整条栈、
  // 去的是哪个 app、到了之后落在第几层。退到那一层时原样放回去，见 pop()
  returnTo: null,
});

/**
 * 那一趟「看一眼就回来」到此为止：去过的那个 app 收回首页。
 *
 * 不收的话它就一直停在被看的那一页上 —— 下次从桌面点进去，开的是那一页，
 * 而那一页是别人领进去的，人并不想从那儿开始。
 */
function endTrip(s, stacks) {
  const to = s.returnTo?.to;
  if (to && stacks[to]) stacks[to] = ['/'];
  return stacks;
}

export function unlock() {
  nav.set({ screen: 'home' });
  emit(EVENTS.unlock);
}

export function lock() {
  nav.set({ screen: 'lock', switcher: false, returnTo: null,
    stacks: endTrip(nav.get(), { ...nav.get().stacks }) });
  emit(EVENTS.lock);
}

/**
 * 打开一个 app。
 *
 * `opts.back` 是「过去看一眼就回来」：记下出发时那一整条栈，那一页退到底时
 * 原样放回去，而不是落在目标 app 的首页上、再一按退到桌面。
 * 跨 app 的那种「去改一下再回来」全走它 —— 从前过去了就没有回头路，
 * 人要自己重开一遍原来那个 app、再一层层点回去。
 */
export function openApp(appId, route = '/', opts = {}) {
  const s = nav.get();
  const stacks = { ...s.stacks };
  // 只记 app 之间那一跳；同一个 app 里的跳转不算
  const back = opts.back && s.screen === 'app' && s.appId && s.appId !== appId
    ? { appId: s.appId, stack: [...(s.stacks[s.appId] || ['/'])], to: appId }
    : null;
  // 上一趟「看一眼就回来」在这里结束。两种情形不收：正要回到的就是它，
  // 或者它这就是新的出发地（那条栈马上要当回头路用）
  const trip = s.returnTo?.to;
  if (trip && trip !== appId && !(back && back.appId === trip)) stacks[trip] = ['/'];
  // 直接跳到深层页面时，把根页垫在栈底。否则栈里只有一条，
  // 一按返回就退到桌面，而不是回到这个 app 自己的首页。
  //
  // **带 back 的那一跳也要垫**。从前不垫，理由是「退到底该是回去」——
  // 可那条回头路只活一趟，人中途按了桌面、或者从切换器再进来，它就没了，
  // 剩下一条底下没有首页的栈：从桌面点进去开的是那一页，再一按直接回桌面，
  // 永远上不去。回去那一下改由下面的 depth 判断，不再靠「栈里只有一条」。
  if (!stacks[appId] || route !== '/') {
    stacks[appId] = route === '/' ? ['/'] : ['/', route];
  }
  if (back) back.depth = stacks[appId].length;
  const recents = [appId, ...s.recents.filter(id => id !== appId)];
  const dropped = recents.slice(MAX_BACKGROUND);
  dropped.forEach(id => { delete stacks[id]; });
  nav.set({
    screen: 'app', appId, stacks,
    recents: recents.slice(0, MAX_BACKGROUND),
    switcher: false,
    returnTo: back,
  });
  emit(EVENTS.appOpen, appId);
}

/** 回到那一跳的出发地，连同它当时那一整条栈。没有出发地就什么也不做。 */
function returnBack() {
  const s = nav.get();
  const r = s.returnTo;
  if (!r) return false;
  const recents = [r.appId, ...s.recents.filter(id => id !== r.appId)];
  const stacks = endTrip(s, { ...s.stacks });
  stacks[r.appId] = r.stack;
  nav.set({
    screen: 'app', appId: r.appId,
    stacks,
    recents: recents.slice(0, MAX_BACKGROUND),
    switcher: false,
    returnTo: null,
  });
  emit(EVENTS.appOpen, r.appId);
  return true;
}

export function goHome() {
  const s = nav.get();
  nav.set({ screen: 'home', appId: null, switcher: false, returnTo: null,
    stacks: endTrip(s, { ...s.stacks }) });
}

export function closeApp(appId) {
  const s = nav.get();
  const stacks = { ...s.stacks };
  delete stacks[appId];
  nav.set({
    stacks,
    // 关掉的是出发地、或者关掉的就是眼下这个（于是回桌面），
    // 那条回头路都不再作数
    returnTo: (s.returnTo?.appId === appId || s.returnTo?.to === appId
      || s.appId === appId) ? null : s.returnTo,
    recents: s.recents.filter(id => id !== appId),
    appId: s.appId === appId ? null : s.appId,
    screen: s.appId === appId ? 'home' : s.screen,
  });
}

export function push(route) {
  const s = nav.get();
  if (!s.appId) return;
  const stack = s.stacks[s.appId] || ['/'];
  nav.set({ stacks: { ...s.stacks, [s.appId]: [...stack, route] } });
}

export function pop() {
  const s = nav.get();
  if (!s.appId) return false;
  const stack = s.stacks[s.appId] || ['/'];
  const r = s.returnTo;
  // 「过去看一眼就回来」的那一跳：退回出发时落在的那一层，再退就是回去，
  // 不是落在这个 app 的首页上、更不是回桌面。在那一层之下照常退
  if (r && r.to === s.appId && r.appId !== s.appId && stack.length <= (r.depth || 1)) {
    return returnBack();
  }
  if (stack.length <= 1) {
    goHome();
    return false;
  }
  nav.set({ stacks: { ...s.stacks, [s.appId]: stack.slice(0, -1) } });
  return true;
}

export function replace(route) {
  const s = nav.get();
  if (!s.appId) return;
  const stack = s.stacks[s.appId] || ['/'];
  nav.set({ stacks: { ...s.stacks, [s.appId]: [...stack.slice(0, -1), route] } });
}

export function popToRoot() {
  const s = nav.get();
  if (!s.appId) return;
  nav.set({ stacks: { ...s.stacks, [s.appId]: ['/'] } });
}

export function currentRoute() {
  const s = nav.get();
  if (!s.appId) return null;
  const stack = s.stacks[s.appId] || ['/'];
  return stack[stack.length - 1];
}

export function setSwitcher(open) { nav.set({ switcher: !!open }); }

export function back() {
  const s = nav.get();
  if (s.switcher) { setSwitcher(false); return; }
  if (s.screen === 'app') { pop(); return; }
  if (s.screen === 'home') return;
}
