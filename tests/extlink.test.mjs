// 外链加载不出来（4.284）
//   一、页面不带 Referer 去取图：meta referrer；表情的 <img> 也标了
//   二、https 页面上 http 的外链换成 https 再试；http 页面不动
//   三、链接打不开的表情画成「无法打开」，不是一个破图标
//   四、缓存到本地：配了图床中转就经中转取（绕开跨域与防盗链）；没配、被拦时写明原因
import { BASE, EXE, PNG_B64, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const hits = [];
const png = Buffer.from(PNG_B64, 'base64');
await ctx.route('**/blocked.example.com/**', route => { hits.push(route.request().url()); return route.abort('failed'); });
await ctx.route('**/relay-img.example.com/**', route => { hits.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'image/png', body: png }); });
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);

const r = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const stk = await import('/src/system/stickers.js');
  const out = {};
  out.meta = document.querySelector('meta[name="referrer"]')?.content;
  out.up = stk.displayUrl('http://img.example.com/a.png', true);
  out.keep = stk.displayUrl('http://img.example.com/a.png', false);
  out.https = stk.displayUrl('https://img.example.com/a.png', true);
  const s = db.stickers.create({ name: '打不开', keywords: ['x'], url: 'https://blocked.example.com/a.png', imageId: null, group: '外链', useCount: 0 });
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  db.messages.create({ chatId: chat.id, role: 'char', authorId: c.id, kind: 'sticker', stickerId: s.id, content: '[表情：打不开]', status: 'done' });
  const n = await import('/src/system/nav.js'); n.unlock(); n.goHome(); n.openApp('chat', `/chat/${chat.id}`);
  return { ...out, s: s.id };
});
ok('一、页面声明了 no-referrer', r.meta === 'no-referrer', r.meta);
ok('二、https 页面上 http 换成 https；http 页面不动；https 原样', r.up === 'https://img.example.com/a.png' && r.keep === 'http://img.example.com/a.png' && r.https === 'https://img.example.com/a.png', JSON.stringify(r));
await page.waitForTimeout(1200);
ok('三、链接打不开的表情画成「无法打开」', await page.locator('.stk-miss', { hasText: '无法打开' }).count() >= 1);
// 面板里的表情图标了 no-referrer
await ev(async () => { const { db } = await import('/src/system/db/index.js'); db.stickers.create({ name: '好的', keywords: ['好'], url: 'https://relay-img.example.com/ok.png', imageId: null, group: '外链', useCount: 0 }); });
await page.locator('button[aria-label="表情"]').first().click();
await page.waitForTimeout(600);
const attr = await page.locator('.stk-panel img.stk-img').first().getAttribute('referrerpolicy');
ok('一、表情的 img 标了 no-referrer', attr === 'no-referrer', attr);

// 四
const r4 = await ev(async id => {
  const { db } = await import('/src/system/db/index.js');
  const stk = await import('/src/system/stickers.js');
  const imghost = await import('/src/system/imghost.js');
  const out = {};
  const s = db.stickers.get(id);
  imghost.setRelay({ url: '', token: '' });
  const a = await stk.cacheRemote([s]);
  out.noRelay = { fail: a.fail, why: a.why };
  imghost.setRelay({ url: 'https://relay-img.example.com', token: 'tok' });
  const b = await stk.cacheRemote([s]);
  out.viaRelay = { ok: b.ok, imageId: !!db.stickers.get(id).imageId };
  return out;
}, r.s);
ok('四、没配中转、被拦：失败并写明跨域', r4.noRelay.fail === 1 && /跨域|中转/.test((r4.noRelay.why || []).join('')), JSON.stringify(r4.noRelay));
ok('四、配了中转：经中转取回，缓存成功', r4.viaRelay.ok === 1 && r4.viaRelay.imageId && hits.some(u => /relay-img\.example\.com\/fetch\?url=/.test(u)), JSON.stringify([r4.viaRelay, hits.slice(-2)]));

console.log(`\n${R.filter(x => x.pass).length}/${R.length} 通过`);
if (errs.length) console.log(errs.join('\n'));
await browser.close();
process.exit(R.every(x => x.pass) && !errs.length ? 0 : 1);
