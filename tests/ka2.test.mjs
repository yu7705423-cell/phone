// 保活：装成 app 的那一路，从「打开开关」一路走到「界面上写着什么」。
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 200)); });

// 外壳那一层的假货，记下每一次调用
await page.addInitScript(`
window.__ka = [];
window.__alive = false;
window.phoneNativeBack = true;
window.phoneNotify = true;
window.phoneKeepAlive = true;
window.webkit = { messageHandlers: {
  keepalive: { postMessage: async b => {
    window.__ka.push(b.action);
    if (b.action === 'start') { window.__alive = true; window.__mix = b.mix === true; }
    if (b.action === 'stop') window.__alive = false;
    return { on: window.__alive, playing: window.__alive, category: 'playback',
      mixing: window.__mix === true, otherAudio: false };
  } },
  notify: { postMessage: async () => ({ permission: 'default' }) },
} };`);
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1800);

const fail = [], ok = [];
const check = (c, m) => (c ? ok : fail).push(m);
const calls = () => page.evaluate(() => window.__ka.slice());
const row = () => page.evaluate(() => {
  const el = [...document.querySelectorAll('.list-item')].find(e => e.innerText.startsWith('保活'));
  return el ? el.innerText.replace(/\n/g, ' ') : '(找不到那一行)';
});

// ---- 1 开机时开关是关的：外壳那边不该被叫起来 ----
await page.evaluate(() => import('/src/system/nav.js').then(n => n.openApp('settings', '/')));
await page.waitForTimeout(900);
check(/保活/.test(await row()), '设置里有「保活」那一行');
check((await calls()).filter(x => x === 'start').length === 0, '关着的时候没去叫外壳');

// ---- 2 打开开关 ----
await page.evaluate(async () =>
  (await import('/src/system/db/index.js')).settings.set({ keepAlive: true }));
await page.waitForTimeout(1200);
const c1 = await calls();
check(c1.includes('start'), `打开开关之后叫了外壳：${JSON.stringify(c1)}`);
check(await page.evaluate(() => window.__alive), '外壳那边开始播了');
const st = await page.evaluate(async () => (await import('/src/system/keepalive.js')).state.get());
check(st.on === true, `状态记成开着（${JSON.stringify(st)}）`);
check(st.note === '外壳音频：正在运行', `note 写明了走的是哪条路：${st.note}`);

// ---- 3 界面上看得见 ----
const text = await row();
check(/当前：外壳音频：正在运行/.test(text), `设置那一行显示了状态：${text.slice(-60)}`);
check(/独占音频/.test(text), '文案是装成 app 的那一套');

// ---- 4 关掉 ----
await page.evaluate(async () =>
  (await import('/src/system/db/index.js')).settings.set({ keepAlive: false }));
await page.waitForTimeout(900);
check((await calls()).includes('stop'), '关掉时叫了外壳停');
check(!await page.evaluate(() => window.__alive), '外壳那边停了');
check(!/当前：/.test(await row()), '关掉之后那一行不再写当前状态');

// ---- 5 外壳那边开不起来：界面要把原话显示出来 ----
await page.evaluate(() => {
  window.webkit.messageHandlers.keepalive.postMessage = async b => {
    window.__ka.push(b.action);
    if (b.action === 'stop') return { on: false };
    return { error: '音频会话没拿到：The operation couldn’t be completed.' };
  };
});
await page.evaluate(async () =>
  (await import('/src/system/db/index.js')).settings.set({ keepAlive: true }));
await page.waitForTimeout(1200);
const bad = await row();
check(/音频会话没拿到/.test(bad), `开不起来时把原话显示出来：${bad.slice(-80)}`);

// ---- 6 网页那条老路也要写清楚是哪条 ----
//     装成 app 之后还看到「网页音频」，就说明外壳那座桥没接上
const web = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
await web.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await web.waitForTimeout(1600);
await web.evaluate(async () =>
  (await import('/src/system/db/index.js')).settings.set({ keepAlive: true }));
await web.waitForTimeout(1000);
const wnote = await web.evaluate(async () => (await import('/src/system/keepalive.js')).state.get().note);
check(/^网页音频：/.test(wnote), `浏览器里那一行写明是网页音频：${wnote}`);
await web.evaluate(() => import('/src/system/nav.js').then(n => n.openApp('settings', '/')));
await web.waitForTimeout(900);
const wrow = await web.evaluate(() => {
  const el = [...document.querySelectorAll('.list-item')].find(e => e.innerText.startsWith('保活'));
  return el ? el.innerText.replace(/\n/g, ' ') : '';
});
check(/当前：网页音频/.test(wrow), `浏览器里也显示得出来：${wrow.slice(-40)}`);
await web.close();

// ---- 7 混音时那句警告还在 ----
await page.evaluate(() => {
  window.webkit.messageHandlers.keepalive.postMessage = async b => {
    if (b.action === 'stop') return { on: false };
    return { on: true, playing: true, category: 'playback', mixing: true, otherAudio: false };
  };
});
await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  db.settings.set({ keepAlive: false });
  await new Promise(r => setTimeout(r, 300));
  db.settings.set({ keepAlive: true });
});
await page.waitForTimeout(1200);
check(/与其他应用混音/.test(await row()), `混音时那句警告还在：${(await row()).slice(-50)}`);

// ---- 8 会话起来了但播放器没在播，也说得出来 ----
await page.evaluate(() => {
  window.webkit.messageHandlers.keepalive.postMessage = async b => {
    if (b.action === 'stop') return { on: false };
    return { on: true, playing: false, category: 'playback', mixing: false, otherAudio: false };
  };
});
await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  db.settings.set({ keepAlive: false });
  await new Promise(r => setTimeout(r, 300));
  db.settings.set({ keepAlive: true });
});
await page.waitForTimeout(1200);
check(/播放器没有在播/.test(await row()), `播放器没在播也说得出来：${(await row()).slice(-40)}`);

// ---- 9 混音那个开关：传得过去，而且不再被当成毛病说 ----
// 前面几条换过假桥，这里先装回原来那个 —— 不然测的是上一条留下的桩
await page.evaluate(async () => {
  window.webkit.messageHandlers.keepalive.postMessage = async b => {
    window.__ka.push(b.action);
    if (b.action === 'start') { window.__alive = true; window.__mix = b.mix === true; }
    if (b.action === 'stop') window.__alive = false;
    return { on: window.__alive, playing: window.__alive, category: 'playback',
      mixing: window.__mix === true, otherAudio: false };
  };
  const db = await import('/src/system/db/index.js');
  db.settings.set({ keepAlive: false });
  await new Promise(r => setTimeout(r, 300));
  db.settings.set({ keepAliveMix: true, keepAlive: true });
});
await page.waitForTimeout(1200);
check(await page.evaluate(() => window.__mix) === true, '混音这个选择传到外壳了');
const mixNote = await page.evaluate(async () =>
  (await import('/src/system/keepalive.js')).state.get().note);
check(mixNote === '外壳音频：正在运行，与其他应用混音',
  `自己选的混音不当成毛病说：${mixNote}`);

// 没选混音却混上了，那才是毛病
await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  db.settings.set({ keepAlive: false, keepAliveMix: false });
  await new Promise(r => setTimeout(r, 300));
  window.webkit.messageHandlers.keepalive.postMessage = async b => {
    if (b.action === 'stop') return { on: false };
    return { on: true, playing: true, category: 'playback', mixing: true };
  };
  db.settings.set({ keepAlive: true });
});
await page.waitForTimeout(1200);
check(/后台可能仍会被暂停/.test(await page.evaluate(async () =>
  (await import('/src/system/keepalive.js')).state.get().note)),
  '没选混音却混上了，仍然当成毛病说');

// 界面上那个开关在
await page.evaluate(() => import('/src/system/nav.js').then(n => n.openApp('settings', '/')));
await page.waitForTimeout(900);
const body = await page.evaluate(() => document.body.innerText);
check(/不打断其他应用的声音/.test(body), '设置里有那个开关');
check(/后台三分钟以上再回来/.test(body), '并且告诉用户怎么自己验');

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errors.length) console.log('\n' + errors.slice(0, 6).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
