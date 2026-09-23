// 通知与保活两座桥。用假的桥把「装成 app」那一路走一遍，
// 再确认没有桥的时候（浏览器）一切照旧。
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });

const fail = [], ok = [];
const check = (c, m) => (c ? ok : fail).push(m);

// 外壳那一层的假货。和 ios/Sources 里那两个 Bridge 的协议一一对应
const FAKE = `
window.__calls = [];
window.__perm = 'default';
window.__alive = false;
window.phoneNotify = true;
window.phoneKeepAlive = true;
window.webkit = { messageHandlers: {
  notify: { postMessage: async b => {
    window.__calls.push(b);
    if (b.action === 'status') return { permission: window.__perm };
    if (b.action === 'request') { window.__perm = window.__grant || 'granted'; return { permission: window.__perm }; }
    if (b.action === 'show') { window.__shown = b; return { shown: true }; }
    return { error: '不认识的动作' };
  } },
  keepalive: { postMessage: async b => {
    window.__calls.push(b);
    const info = on => ({ on, category: 'playback',
      mixing: window.__mixing === true, otherAudio: false });
    if (b.action === 'start') { window.__alive = true; return info(true); }
    if (b.action === 'stop') { window.__alive = false; return info(false); }
    if (b.action === 'status') return info(window.__alive);
    return { error: '不认识的动作' };
  } },
} };`;

async function openApp({ shell }) {
  const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  if (shell) await page.addInitScript(FAKE);
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);
  return { page, errs };
}

// ================= 装成 app 那一路 =================
{
  const { page, errs } = await openApp({ shell: true });
  await page.evaluate(async () => {
    const acc = await import('/src/system/accounts.js');
    const db = await import('/src/system/db/index.js');
    acc.roots()[0] || acc.createRoot({ name: '我' });
    const a = db.characters.create({ name: '甲', persona: 'x' });
    const c = db.chats.create({ characterIds: [a.id], lastMessageAt: Date.now() });
    db.messages.create({ chatId: c.id, role: 'user', authorId: 'me', kind: 'text', content: '嗨', status: 'done' });
  });

  const P = async fn => page.evaluate(async f => {
    const push = await import('/src/system/push.js');
    return (new Function('push', `return (${f})(push)`))(push);
  }, fn.toString());

  check(await P(p => p.native()), '认出了外壳这座桥');
  check(await P(p => p.supported()), '装成 app 时「支持通知」');
  check(!await P(p => p.pushSupported()), 'Web Push 仍然不支持（WKWebView 没有 PushManager）');
  check(await P(p => p.standalone()), 'standalone 为真（不是浏览器标签页）');

  // 授权
  check(await P(p => p.permission()) !== 'unsupported', `不再报「不支持」（${await P(p => p.permission())}）`);
  await P(p => p.refresh());
  check(await P(p => p.permission()) === 'default', '开机对一次状态：还没问过');
  await P(p => p.ask());
  check(await P(p => p.permission()) === 'granted', '问过之后是已授权');

  // 被拒
  await page.evaluate(() => { window.__grant = 'denied'; window.__perm = 'default'; });
  const denied = await page.evaluate(async () => {
    const p = await import('/src/system/push.js');
    try { await p.ask(); return 'no-throw'; } catch (e) { return e.message; }
  });
  check(/被拒/.test(denied), `被拒时说的是被拒，不是「不支持」：${denied}`);
  await page.evaluate(() => { window.__grant = 'granted'; });
  await P(p => p.ask());

  // 发一条
  await P(p => p.show({ title: '甲', body: '这是一条测试通知', appId: 'chat', route: '/chat/x', tag: 't1' }));
  const shown = await page.evaluate(() => window.__shown);
  check(shown && shown.title === '甲' && shown.body === '这是一条测试通知'
    && shown.appId === 'chat' && shown.route === '/chat/x' && shown.tag === 't1',
    `发出去的内容对：${JSON.stringify(shown)}`);

  // 点开通知回跳
  await page.evaluate(async () => {
    const p = await import('/src/system/push.js');
    p.installClickBridge();
  });
  const chatId = await page.evaluate(async () => (await import('/src/system/db/index.js')).chats.all()[0].id);
  await page.evaluate(([id]) => window.phoneNotifyOpen({ appId: 'chat', route: `/chat/${id}` }), [chatId]);
  await page.waitForTimeout(700);
  const where = await page.evaluate(async () => {
    const { nav } = await import('/src/system/nav.js');
    const s = nav.get();
    return { app: s.appId, route: (s.stacks[s.appId] || []).slice(-1)[0] };
  });
  check(where.app === 'chat' && where.route === `/chat/${chatId}`,
    `点开通知跳到了那一页（${JSON.stringify(where)}）`);

  // 通知设置页打得开，而且不再写「不支持」
  await page.evaluate(() => import('/src/system/nav.js').then(n => n.openApp('settings', '/notify')));
  await page.waitForTimeout(800);
  let body = await page.evaluate(() => document.body.innerText);
  check(!/这个浏览器不支持/.test(body), '通知设置页不再显示「这个浏览器不支持」');
  check(/由外壳发送/.test(body), '写明了由外壳发送');
  check(!/VAPID/.test(body), '装成 app 时不显示 Web Push 那一段');
  check(/需要浏览器的 Push API/.test(body), '并说明了为什么不显示');

  // 保活
  const K = async fn => page.evaluate(async f => {
    const k = await import('/src/system/keepalive.js');
    return (new Function('k', `return (${f})(k)`))(k);
  }, fn.toString());
  check(await K(k => k.native()), '保活也认出了外壳这座桥');
  check(await K(k => k.start()), '保活开得起来');
  check(await page.evaluate(() => window.__alive), '外壳那边真的在播');
  check(await K(k => k.state.get().on) === true && await K(k => k.state.get().needsTap) === false,
    '状态是开着的，而且没有立起「需要点一下」');
  await K(k => k.stop());
  check(!await page.evaluate(() => window.__alive), '关得掉');
  check(await K(k => k.state.get().on) === false, '关掉之后状态也是关的');

  // 界面上看得出它在不在跑 —— 上一版打开开关屏幕上什么都不变
  check(await K(k => k.state.get().note) === '', '关着的时候不写多余的字');
  await K(k => k.start());
  check(await K(k => k.state.get().note) === '外壳音频：正在运行',
    `开着时写明走的是哪条路：${await K(k => k.state.get().note)}`);
  // 混音时系统不拿它当「正在放东西」，等于白开，这一条要说出来
  await K(k => k.stop());
  await page.evaluate(() => { window.__mixing = true; });
  await K(k => k.start());
  const mixNote = await K(k => k.state.get().note);
  check(/后台可能仍会被暂停/.test(mixNote), `混音时如实说：${mixNote}`);
  await page.evaluate(() => { window.__mixing = false; });
  await K(k => k.stop());

  // 外壳那边开不起来的时候，不要去骗用户点屏幕
  await page.evaluate(() => {
    window.webkit.messageHandlers.keepalive.postMessage = async () => ({ error: '音频没能开始播放' });
  });
  await K(k => k.start());
  check(await K(k => k.state.get().on) === false && await K(k => k.state.get().needsTap) === false,
    '原生开不起来时不弹「点一下」横幅（点了也没用）');
  check(/音频没能开始播放/.test(await K(k => k.state.get().note)),
    `开不起来时把原话显示出来：${await K(k => k.state.get().note)}`);

  check(!errs.length, `装成 app 这一路没有报错${errs.length ? '：' + errs[0] : ''}`);
  await page.close();
}

// ================= 浏览器那一路，照旧 =================
{
  const { page, errs } = await openApp({ shell: false });
  const P = async fn => page.evaluate(async f => {
    const push = await import('/src/system/push.js');
    return (new Function('push', `return (${f})(push)`))(push);
  }, fn.toString());
  check(!await P(p => p.native()), '浏览器里没有那座桥');
  check(await P(p => p.supported()), '浏览器里照旧支持（Chromium 有 SW 与 Notification）');
  check(await P(p => p.permission()) === 'default', '权限读的是浏览器自己的');
  const K = async fn => page.evaluate(async f => {
    const k = await import('/src/system/keepalive.js');
    return (new Function('k', `return (${f})(k)`))(k);
  }, fn.toString());
  check(!await K(k => k.native()), '保活也走网页那条老路');
  await K(k => k.start());
  check(await K(k => k.state.get().on) === true, '网页那条路照样开得起来');
  await K(k => k.stop());
  await page.evaluate(() => import('/src/system/nav.js').then(n => n.openApp('settings', '/notify')));
  await page.waitForTimeout(800);
  const body = await page.evaluate(() => document.body.innerText);
  check(/VAPID/.test(body), '浏览器里 Web Push 那一段照常显示');
  check(/Service Worker/.test(body), '文案仍然是 Service Worker 那一套');
  check(!errs.length, `浏览器这一路没有报错${errs.length ? '：' + errs[0] : ''}`);
  await page.close();
}

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length ? 1 : 0);
