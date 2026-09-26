// App 外壳的原生接口不许被沙盒里的网页调到（ARCHITECTURE 4.249）
//
// 安卓的 addJavascriptInterface 会把 EiraNative 注入进每一个 frame，iOS 的 messageHandlers 子 frame 里也在，
// 沙盒（system/sandbox.js）挡不住它们。修法：
//
//   一、bridge.js 只在主页面里装；所有调用带口令，口令子 frame 拿不到；主页面有 EiraShell 与 phoneFrameGuard
//   二、NativeBridge.kt 每个接口先核口令；MainActivity 把口令写进 bridge.js
//   三、iOS 每个接口先核 isMainFrame，并声明 phoneFrameGuard
//   四、网页：旧外壳（认不出 phoneFrameGuard）里沙盒不给运行脚本；浏览器与新外壳照旧
//   五、网页调外壳一律经 shellApi()：新外壳走 EiraShell（带口令），旧外壳走 EiraNative
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, EXE, chromium } from './_env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

// ---- 一、bridge.js 在主页面与沙盒子 frame 里各是什么样 ----
{
  const ctx = await browser.newContext();
  // 假的 EiraNative：安卓会把它注入进每一个 frame（沙盒里也在），bridge.js 也按 "*" 在每个文档开头跑一遍
  const MOCK = `(function(){var calls=window.__calls=[];var rec=function(n){return function(){var a=[].slice.call(arguments);`
    + `calls.push([n].concat(a));return n==='version'?'9.9':1;};};`
    + `window.EiraNative=new Proxy({},{get:function(_,k){return rec(String(k));}});})();`;
  const BRIDGE = read('android/app/src/main/assets/bridge.js').replace('__EIRA_TOKEN__', 'TKN');
  await ctx.addInitScript(MOCK);
  await ctx.addInitScript(BRIDGE);
  const page = await ctx.newPage();
  await ctx.route(`${BASE}/__shellguard.html`, r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
  let res0; const got = new Promise(res => { res0 = res; });
  await page.exposeFunction('__got', d => res0(d));
  await page.addInitScript(() => { addEventListener('message', e => window.__got?.(e.data)); });
  await page.goto(`${BASE}/__shellguard.html`);
  // 子 frame：照外壳的样子，文档一开始先有注入的对象，再跑 bridge.js，然后才是网页自己的脚本
  await page.evaluate(({ mock, bridge }) => {
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    const tag = 'script';
    f.srcdoc = `<${tag}>${mock}</${tag}><${tag}>${bridge}</${tag}><${tag}>parent.postMessage({
      injected: typeof window.EiraNative,
      shell: typeof window.EiraShell,
      guard: window.phoneFrameGuard === true,
      net: !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.net),
      reply: typeof window.__eiraReply,
    }, '*')</${tag}>`;
    document.body.appendChild(f);
  }, { mock: MOCK, bridge: BRIDGE.replace(/<\/script/gi, '<\\/script') });
  const inner = await Promise.race([got, new Promise(r => setTimeout(() => r(null), 5000))]);
  const top = await page.evaluate(async () => {
    window.EiraShell.setFloat('{"on":true}');
    window.EiraShell.setSystemBars(true);
    window.webkit.messageHandlers.net.postMessage({ action: 'fetch', url: 'https://x' });
    return { calls: window.__calls, guard: window.phoneFrameGuard, ver: window.phoneAppVersion };
  });
  const tokened = top.calls.filter(c => c[1] === 'TKN').map(c => c[0]);
  ok('主页面：有 EiraShell，声明 phoneFrameGuard', top.guard === true, JSON.stringify(top));
  ok('主页面：版本号、悬浮窗、状态栏、发请求都带着口令调外壳',
    ['version', 'setFloat', 'setSystemBars', 'post'].every(n => tokened.includes(n)), JSON.stringify(top.calls));
  ok('主页面：没有一次调用漏了口令', top.calls.every(c => c[1] === 'TKN'), JSON.stringify(top.calls));
  ok('沙盒子 frame：外壳对象确实注入进去了（测试前提）', inner?.injected === 'object', JSON.stringify(inner));
  ok('沙盒子 frame：bridge.js 不装，拿不到 EiraShell、发请求的入口、回调',
    inner && inner.shell === 'undefined' && !inner.net && inner.reply === 'undefined' && !inner.guard, JSON.stringify(inner));
  await ctx.close();
}

// ---- 二、三：外壳源码 ----
{
  const kt = read('android/app/src/main/java/com/eira/phone/NativeBridge.kt');
  const funs = [...kt.matchAll(/@JavascriptInterface\s+fun (\w+)\(([^)]*)\)([^\n]*\n[^\n]*)/g)];
  const bad = funs.filter(m => !/^t: String\b/.test(m[2]) || !/ok\(t\)/.test(m[3])).map(m => m[1]);
  ok(`安卓：${funs.length} 个外壳接口，第一个参数都是口令，并先核口令`, funs.length >= 11 && !bad.length, bad.join(', '));
  const act = read('android/app/src/main/java/com/eira/phone/MainActivity.kt');
  ok('安卓：口令写进 bridge.js，并交给 NativeBridge',
    /replace\("__EIRA_TOKEN__", shellToken\)/.test(act) && /NativeBridge\(this, web, shellToken\)/.test(act));
  const js = read('android/app/src/main/assets/bridge.js');
  const loose = [...js.matchAll(/\bN\.(\w+)\(([^)]*)/g)].filter(m => !/^T\b/.test(m[2])).map(m => m[1]);
  ok('bridge.js：每一处调外壳都带口令', !loose.length, loose.join(', '));
  ok('bridge.js：子 frame 里一开头就退出', /if \(window\.top !== window\) return;/.test(js));

  const dir = join(root, 'ios/Sources');
  const miss = readdirSync(dir).filter(f => f.endsWith('.swift')).flatMap(f => {
    const s = readFileSync(join(dir, f), 'utf8');
    return [...s.matchAll(/func userContentController\([\s\S]{0,400}?\{([\s\S]{0,300})/g)]
      .filter(m => !/guard message\.frameInfo\.isMainFrame/.test(m[1])).map(() => f);
  });
  const handlers = (read('ios/Sources/ShellViewController.swift').match(/addScriptMessageHandler\(/g) || []).length;
  ok(`iOS：${handlers} 个接口都只收主页面的消息`, handlers >= 6 && !miss.length, miss.join(', '));
  ok('iOS：声明 phoneFrameGuard', /window\.phoneFrameGuard = true;/.test(read('ios/Sources/ShellViewController.swift')));
}

// ---- 四、五：网页这一侧 ----
async function app(init) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/src/site.js*', async r => {
    const res = await r.fetch();
    r.fulfill({ response: res, body: (await res.text()).replace(/accounts:\s*'[^']*'/, "accounts: ''") });
  });
  await ctx.addInitScript(() => { try { localStorage.setItem('eira-terms-test', '1'); } catch { /* 无 */ } });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/index.html`);
  await page.waitForTimeout(1500);
  const flags = await page.evaluate(async () => {
    const sb = await import('/src/system/sandbox.js');
    return { flags: sb.sandboxFlags(), scripts: sb.scriptsAllowed() };
  });
  return { ctx, page, ...flags };
}
{
  const plain = await app();
  ok('浏览器里：沙盒照旧运行脚本', plain.flags === 'allow-scripts' && plain.scripts, JSON.stringify(plain.flags));
  await plain.ctx.close();

  const old = await app(() => { window.EiraNative = { setSystemBars() {}, exitApp() {} }; window.phoneAppVersion = 'Android 1.0'; });
  ok('旧安卓外壳：沙盒不给运行脚本', old.flags === '' && !old.scripts, JSON.stringify(old.flags));
  await old.ctx.close();

  const oldIos = await app(() => { window.webkit = { messageHandlers: { net: { postMessage() {} } } }; });
  ok('旧 iOS 外壳：沙盒不给运行脚本', oldIos.flags === '' && !oldIos.scripts, JSON.stringify(oldIos.flags));
  await oldIos.ctx.close();

  const fresh = await app(() => {
    window.__raw = []; window.__shell = [];
    window.EiraNative = { setSystemBars: (...a) => window.__raw.push(a) };
    window.EiraShell = { setSystemBars: (...a) => window.__shell.push(a) };
    window.phoneFrameGuard = true;
    window.phoneAppVersion = 'Android 2.0';
  });
  ok('新外壳：沙盒照旧运行脚本', fresh.flags === 'allow-scripts', JSON.stringify(fresh.flags));
  const used = await fresh.page.evaluate(async () => {
    const fs = await import('/src/system/fullscreen.js');
    fs.applyWindowed();
    return { raw: window.__raw.length, shell: window.__shell.length };
  });
  ok('新外壳：网页经 EiraShell 调外壳，不直接碰 EiraNative', used.shell > 0 && used.raw === 0, JSON.stringify(used));
  await fresh.ctx.close();
}

await browser.close();
const fail = R.filter(r => !r.pass).length;
console.log(`\n${R.length - fail}/${R.length} 项通过`);
process.exit(fail ? 1 : 0);
