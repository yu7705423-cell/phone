// 没有顶栏、整页就是一块屏的页（Page hideBar：线下、长篇、角色手机）：刘海那一条只让一次（4.277）
//
// 用户截图：长篇正文页上方先空出一条，才是刊头；开了左上角悬浮返回键之后，刊头里自己那个返回箭头
// 和悬浮键一上一下两个。原因是外壳那一层（.app-layer）按 --top-inset 让了一次，刊头又按 env() 让了一次。
// 这里把 --top-inset 定成 44px，查：页面从这一层的顶边开始；刊头自己让 44px；悬浮键开着时刊头的箭头让位。
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);

const ids = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const work = await import('/src/system/work.js');
  const scene = await import('/src/system/scene.js');
  const c = db.characters.create({ name: '阿岚', persona: 'x' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  const w = work.create({ chatId: chat.id, kind: work.SAGA, title: '雨落之前', charAs: { name: '沈砚' }, meAs: { name: '林一' } });
  const cp = work.addChapter(w.id, { title: '到站', place: '车站' });
  scene.addBeat({ sceneId: cp.id, role: 'char', authorId: c.id, text: '雨还没停。' });
  const sc = scene.create({ chatId: chat.id, title: '旧书店', place: '旧书店', castIds: [c.id] });
  scene.addBeat({ sceneId: sc.id, role: 'char', authorId: c.id, text: '门上的铃响了一声。' });
  // 模拟 iOS 上的刘海：外壳把那一条交给里面各层让
  document.querySelector('.root').style.setProperty('--top-inset', '44px');
  return { charId: c.id, chatId: chat.id, chapterId: cp.id, sceneId: sc.id };
});
const open = (app, route) => ev(async ([a, r]) => { const n = await import('/src/system/nav.js'); n.unlock(); n.goHome(); n.openApp(a, r); }, [app, route]);
const measure = sel => ev(sel => {
  const layer = document.querySelector('.app-layer');
  const el = document.querySelector(sel);
  if (!layer || !el) return null;
  const cs = getComputedStyle(el);
  return { layerPad: getComputedStyle(layer).paddingTop, top: el.getBoundingClientRect().top - layer.getBoundingClientRect().top,
    pad: cs.paddingTop, bare: !!document.querySelector('.app-layer > .page.is-bare') };
}, sel);

// 一、长篇正文页
await open('us', `/read/${ids.chapterId}`); await page.waitForTimeout(700);
let m = await measure('.sg');
ok('长篇：页面从外壳顶边开始，外壳那一层不再让', m && m.layerPad === '0px' && m.top === 0, JSON.stringify(m));
m = await measure('.sg-head');
ok('长篇：刊头自己让出刘海那一条（44 + 8）', m && m.pad === '52px', JSON.stringify(m));

// 二、线下
await open('chat', `/scene/${ids.sceneId}`); await page.waitForTimeout(700);
m = await measure('.sg');
ok('线下：同样从顶边开始', m && m.layerPad === '0px' && m.top === 0, JSON.stringify(m));

// 三、角色手机：桌面自己让
await open('theirs', `/home/${ids.charId}`); await page.waitForTimeout(700);
m = await measure('.tp-desk, .tp-lock');
// 点进去先是锁屏（.tp-lock，原来让 24）；解开是桌面（.tp-desk，原来让 20）。两者都在 44 之上再加自己那一份
ok('角色手机：整页从顶边开始，锁屏或桌面自己让 44px 加原来的', m && m.layerPad === '0px' && m.top === 0 && ['64px', '68px'].includes(m.pad), JSON.stringify(m));

// 四、开了悬浮返回键：刊头里的箭头让位；有顶栏的页照旧
await ev(async () => { const { db } = await import('/src/system/db/index.js'); db.settings.set({ navStyle: 'back' }); });
await open('us', `/read/${ids.chapterId}`); await page.waitForTimeout(700);
const hid = await ev(() => ({
  nav: document.documentElement.dataset.nav,
  arrow: getComputedStyle(document.querySelector('.sg-head > .sg-icon')).visibility,
  key: !!document.querySelector('.navback'),
}));
ok('悬浮返回键开着：刊头的返回箭头藏起来，只剩悬浮键', hid.nav === 'back' && hid.key && hid.arrow === 'hidden', JSON.stringify(hid));
await ev(async () => { const { db } = await import('/src/system/db/index.js'); db.settings.set({ navStyle: 'bar' }); });
await open('us', `/read/${ids.chapterId}`); await page.waitForTimeout(500);
ok('底部横条那一档：刊头的箭头照旧', await ev(() => getComputedStyle(document.querySelector('.sg-head > .sg-icon')).visibility) === 'visible');

// 五、有顶栏的页不受影响：顶栏自己把那一条加上
await open('settings', '/'); await page.waitForTimeout(500);
m = await ev(() => {
  const layer = document.querySelector('.app-layer'); const bar = document.querySelector('.app-layer > .page > .navbar');
  return { layerPad: getComputedStyle(layer).paddingTop, barPad: bar && getComputedStyle(bar).paddingTop };
});
ok('有顶栏的页：外壳不让，顶栏自己让 44px', m.layerPad === '0px' && m.barPad === '44px', JSON.stringify(m));

console.log(`\n${R.filter(r => r.pass).length}/${R.length} 通过`);
if (errs.length) console.log(errs.join('\n'));
await browser.close();
process.exit(R.every(r => r.pass) && !errs.length ? 0 : 1);
