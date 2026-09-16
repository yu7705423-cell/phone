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
});

export function unlock() {
  nav.set({ screen: 'home' });
  emit(EVENTS.unlock);
}

export function lock() {
  nav.set({ screen: 'lock', switcher: false });
  emit(EVENTS.lock);
}

export function openApp(appId, route = '/') {
  const s = nav.get();
  const stacks = { ...s.stacks };
  // 直接跳到深层页面时，把根页垫在栈底。否则栈里只有一条，
  // 一按返回就退到桌面，而不是回到这个 app 自己的首页。
  if (!stacks[appId] || route !== '/') {
    stacks[appId] = route === '/' ? ['/'] : ['/', route];
  }
  const recents = [appId, ...s.recents.filter(id => id !== appId)];
  const dropped = recents.slice(MAX_BACKGROUND);
  dropped.forEach(id => { delete stacks[id]; });
  nav.set({
    screen: 'app', appId, stacks,
    recents: recents.slice(0, MAX_BACKGROUND),
    switcher: false,
  });
  emit(EVENTS.appOpen, appId);
}

export function goHome() {
  nav.set({ screen: 'home', appId: null, switcher: false });
}

export function closeApp(appId) {
  const s = nav.get();
  const stacks = { ...s.stacks };
  delete stacks[appId];
  nav.set({
    stacks,
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
  if (stack.length <= 1) { goHome(); return false; }
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
