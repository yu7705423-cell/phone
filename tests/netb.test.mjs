// 跨域走不通就交给外壳发；测试连接要说得出卡在哪一步。
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.route('**/*', async route => {
  const u = route.request().url();
  if (u.startsWith(BASE)) return route.continue();
  return route.abort('failed');       // 浏览器直连一律失败，模拟跨域被拦
});
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ok = [], fail = [];
const check = (c, m) => (c ? ok : fail).push(m);

// ---- 1 没有外壳：直连，连不上要提跨域 ----
const noShell = await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  const voice = await import('/src/system/ai/voice.js');
  const net = await import('/src/system/net.js');
  svc.setVoice({ enabled: true, kind: 'minimax', apiKey: 'sk-cp-x', model: 'speech-01', baseUrl: '' });
  return { native: net.canNative(), route: net.routeOf('https://api.minimaxi.com/x'),
    report: await voice.testVoice() };
});
check(!noShell.native && noShell.route === 'direct', '没装 app 时就是浏览器直连');
check(!noShell.report.ok && noShell.report.step === '没连上',
  `连不上报的是「没连上」（${noShell.report.step}）`);
// 这一份里连 no-cors 探针都发不出去，那就是真的联系不上 —— 这种不该再提跨域，
// 提了就是把人往错的方向支（分辨的办法见 system/net.js 的 reachable）
check(!/跨域/.test(noShell.report.hint) && /可解析/.test(noShell.report.hint),
  `彻底连不上时不提跨域，指向地址与网络（${noShell.report.hint}）`);
check(noShell.report.route === '浏览器直连', `说清楚走的哪条路（${noShell.report.route}）`);

// ---- 2 装上外壳：同样的请求，交给外壳就通 ----
const withShell = await page.evaluate(async () => {
  window.phoneNet = true;
  window.__sent = [];
  window.webkit = { messageHandlers: { net: { postMessage: async d => {
    window.__sent.push(d);
    const body = btoa(JSON.stringify({ base_resp: { status_code: 0 }, data: { audio: '4944330300' } }));
    return { status: 200, headers: { 'content-type': 'application/json' }, body };
  } } } };
  const voice = await import('/src/system/ai/voice.js');
  const net = await import('/src/system/net.js');
  const report = await voice.testVoice();
  return { native: net.canNative(), route: net.routeOf('https://api.minimaxi.com/x'),
    report, sent: window.__sent };
});
check(withShell.native && withShell.route === 'native', '装了 app 就走外壳那条');
check(withShell.report.ok, `同样的请求交给外壳就通了（${withShell.report.step}）`);
check(withShell.report.route === '外壳转发', `报告里写明是外壳发的（${withShell.report.route}）`);
const sent = withShell.sent[0];
check(sent && sent.action === 'fetch' && /t2a_v2/.test(sent.url),
  `交过去的是原样的请求（${sent && sent.url}）`);
check(sent && /Bearer sk-cp-x/.test(sent.headers.authorization || ''), '请求头原样带过去了');
// atob 回来的是字节，中文还要按 UTF-8 再解一次
const decodeB64 = b64 => {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};
const bodyText = sent && JSON.parse(decodeB64(sent.body)).text;
check(bodyText === '测试。', `请求体原样带过去了（${bodyText}）`);

// ---- 3 外壳那条路连不上时，不该再叫人去改跨域 ----
const shellFail = await page.evaluate(async () => {
  window.webkit.messageHandlers.net.postMessage = async () => ({ error: '找不到服务器' });
  const voice = await import('/src/system/ai/voice.js');
  return voice.testVoice();
});
check(!shellFail.ok && shellFail.step === '没连上', '外壳也连不上时照实说');
check(/与跨域无关/.test(shellFail.hint), `不再让人去折腾跨域（${shellFail.hint}）`);

// ---- 4 连上了但对方拒绝，是另一回事 ----
const denied = await page.evaluate(async () => {
  window.webkit.messageHandlers.net.postMessage = async () => ({
    status: 401, headers: { 'content-type': 'application/json' },
    body: btoa(JSON.stringify({ base_resp: { status_code: 1004, status_msg: 'invalid api key' } })),
  });
  const voice = await import('/src/system/ai/voice.js');
  return voice.testVoice();
});
check(!denied.ok && denied.step === '接口报错', `连上了但被拒是另一种（${denied.step}）`);
check(/密钥|模型名|音色/.test(denied.hint), `指向该查的地方（${denied.hint}）`);
check(/invalid api key/.test(denied.detail || ''), `把对方的原话摆出来（${denied.detail}）`);

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 3).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
