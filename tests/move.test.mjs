// 搬家：换了网址，两个窗口之间整份传数据（system/move.js，ARCHITECTURE 4.220）。
//
// 两个源：127.0.0.1（旧网址）与 localhost（新网址），同一台静态服务器。
//   是谁：旧网址认得出自己是旧的、新网址认得出自己是新的；没配就都不是
//   拉：新网址上点「从旧网址搬过来」，旧网址的 move.html 打包发回，新网址收下（角色、消息、图片、接口设置）
//   推：旧网址上点「搬到新网址」，打开新网址 ?move=in，收下后回到平常的样子
//   只和配好的那个网址说话：move.html 被别的地址叫开时不发
//   提醒：旧网址启动时问一次要不要搬家
import { BASE, EXE, chromium } from './_env.mjs';

const OLD = BASE;
const NEW = BASE.replace('127.0.0.1', 'localhost');
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route('**/src/site.js*', r => r.fulfill({ status: 200, contentType: 'text/javascript',
  body: `export const SITE = ${JSON.stringify({ neteaseApi: '', neteaseRealIP: '', neteaseWorker: '', accounts: '',
    moveFrom: `${OLD}/`, moveTo: `${NEW}/` })};` }));
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const watch = p => p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
ctx.on('page', watch);

const open = async (base, path = '/index.html') => {
  const p = await ctx.newPage();
  await p.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);
  return p;
};
const dismiss = async p => { await p.locator('.modal button', { hasText: '稍后' }).click({ timeout: 2000 }).catch(() => {}); };

// ---- 旧网址：造一份数据 ----
const oldPage = await open(OLD);
const prompted = await oldPage.evaluate(() => document.querySelector('.modal')?.textContent || '');
ok('旧网址启动时提醒一次：已换到新网址', /Eira 已换到新网址/.test(prompted) && prompted.includes('localhost'), prompted);
await dismiss(oldPage);
const seed = await oldPage.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  const mv = await import('/src/system/move.js');
  const { images } = await import('/src/system/db/images.js');
  const svc = await import('/src/system/ai/services.js');
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  db.messages.create({ chatId: chat.id, role: 'char', authorId: c.id, kind: 'text', content: '明天见', status: 'done' });
  const cv = document.createElement('canvas'); cv.width = 8; cv.height = 8;
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  const img = await images.put(new File([blob], 'a.png', { type: 'image/png' }));
  db.characters.update(c.id, { avatar: img });
  const p = svc.newChatPreset({ name: '主用' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'sk-old', model: 'm' });
  await new Promise(r => setTimeout(r, 400));
  return { old: mv.isOld(), isNew: mv.isNew(), img };
});
ok('旧网址认得出自己是旧的', seed.old && !seed.isNew, JSON.stringify(seed));

// ---- 拉：新网址上点「从旧网址搬过来」 ----
const newPage = await open(NEW);
const who = await newPage.evaluate(async () => { const mv = await import('/src/system/move.js'); return { isNew: mv.isNew(), old: mv.isOld() }; });
ok('新网址认得出自己是新的', who.isNew && !who.old, JSON.stringify(who));
const ask = await newPage.evaluate(() => document.querySelector('.modal')?.textContent || '');
ok('新网址还没有数据：启动时问要不要搬过来', /从旧网址搬过来/.test(ask), ask);
await dismiss(newPage);
await newPage.evaluate(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('settings', '/storage'); });
await newPage.waitForTimeout(800);
const popupP = ctx.waitForEvent('page');
await newPage.locator('.list-item, [class*="list-item"]', { hasText: '从旧网址搬过来' }).first().click();
const popup = await popupP;
await newPage.waitForFunction(async () => {
  const { db } = await import('/src/system/db/index.js');
  return db.characters.all().some(c => c.name === '阿岚');
}, null, { timeout: 30000 }).catch(() => {});
await newPage.waitForTimeout(2500);   // 收完之后会刷新一次
const pulled = await newPage.evaluate(async img => {
  const { db } = await import('/src/system/db/index.js');
  const { images } = await import('/src/system/db/images.js');
  const svc = await import('/src/system/ai/services.js');
  const c = db.characters.all().find(x => x.name === '阿岚');
  return { char: !!c, msg: db.messages.all().some(m => m.content === '明天见'), avatar: c?.avatar === img,
    blob: !!(await images.blob(img)), key: svc.chatPresets?.().some?.(p => p.apiKey === 'sk-old') ?? JSON.stringify(db.settings.get().services || {}).includes('sk-old') };
}, seed.img);
ok('拉：角色、消息都搬过来了', pulled.char && pulled.msg, JSON.stringify(pulled));
ok('拉：图片按原来的 id 搬过来', pulled.avatar && pulled.blob, JSON.stringify(pulled));
ok('拉：接口设置一起带过来', pulled.key, JSON.stringify(pulled));
const popText = await popup.evaluate(() => document.body.textContent).catch(() => '（已关闭）');
ok('旧网址那一页打完包发回去（发完自己关掉或留一句话）', popText === '（已关闭）' || /已经发给新网址/.test(popText), popText);

// ---- 推：旧网址上点「搬到新网址」 ----
await newPage.evaluate(async () => { const b = await import('/src/system/backup.js'); await b.wipeAll(); });
await oldPage.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  db.characters.create({ name: '阿树' });
  const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('settings', '/storage');
});
await oldPage.waitForTimeout(800);
const inP = ctx.waitForEvent('page');
await oldPage.locator('.list-item, [class*="list-item"]', { hasText: '搬到新网址' }).first().click();
const inPage = await inP;
await oldPage.waitForFunction(() => !document.querySelector('.vd-work'), null, { timeout: 30000 }).catch(() => {});
await oldPage.waitForTimeout(3000);
const toastTxt = await oldPage.evaluate(() => document.body.textContent);
const check = await open(NEW);
await dismiss(check);
const pushed = await check.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  return db.characters.all().map(c => c.name).sort();
});
ok('推：新网址收下了旧网址的整份数据', JSON.stringify(pushed) === '["阿岚","阿树"]', JSON.stringify(pushed));
const inUrl = inPage.url();
ok('推：新网址收完回到平常的地址（去掉 ?move=in）', !inUrl.includes('move=in'), inUrl);
ok('推：旧网址提示已搬到新网址', /已搬到新网址/.test(toastTxt), toastTxt.slice(-200));

// ---- 只和配好的那个网址说话 ----
const bad = await oldPage.evaluate(async () => {
  const w = window.open('/move.html?to=https://evil.example', 'x');
  await new Promise(r => setTimeout(r, 2500));
  const t = w.document.body.textContent;
  w.close();
  return t;
});
ok('move.html 被别的地址叫开：不打包、不发', /只能从新网址/.test(bad), bad);
const direct = await open(OLD, '/move.html?to=' + encodeURIComponent(NEW));
const dt = await direct.evaluate(() => document.body.textContent);
ok('直接打开 move.html（没有开它的窗口）：同样不发', /只能从新网址/.test(dt), dt);

// ---- 没配就都不是 ----
const plain = await browser.newPage();
await plain.goto(`${OLD}/index.html`, { waitUntil: 'domcontentloaded' });
await plain.waitForTimeout(1200);
const none = await plain.evaluate(async () => { const mv = await import('/src/system/move.js'); return mv.isOld() || mv.isNew(); });
ok('site.js 没配搬家：两边都不是', none === false, String(none));
await plain.close();

// ---- app 外壳里不搬：WebView 开不出第二个窗口，新网址会被扔给系统浏览器 ----
const shellCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await shellCtx.route('**/src/site.js*', r => r.fulfill({ status: 200, contentType: 'text/javascript',
  body: `export const SITE = ${JSON.stringify({ neteaseApi: '', neteaseRealIP: '', neteaseWorker: '', accounts: '',
    moveFrom: `${OLD}/`, moveTo: `${NEW}/` })};` }));
await shellCtx.addInitScript(() => { window.phoneAppVersion = 'Android 1.0.0 (1)'; });
const shell = await shellCtx.newPage();
await shell.goto(`${OLD}/index.html`, { waitUntil: 'domcontentloaded' });
await shell.waitForTimeout(1500);
const inShell = await shell.evaluate(async () => {
  const mv = await import('/src/system/move.js');
  return { old: mv.isOld(), isNew: mv.isNew(), modal: document.querySelector('.modal')?.textContent || '' };
});
ok('app 外壳里打开旧网址：不提醒搬家，也不认作旧网址', !inShell.old && !inShell.isNew && !/新网址/.test(inShell.modal), JSON.stringify(inShell));
await shellCtx.close();

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
