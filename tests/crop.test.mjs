// 按角色说的那句话裁图：开关默认关、没配识图不裁、看不出来不裁、
// 裁成了换成新图并标出来、裁挂了照存原图。
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => {
  const t = m.text();
  if (m.type() === 'error' && !/status of 500/.test(t)) errors.push('CONSOLE: ' + t.slice(0, 200));
});

let vcalls = [];
let answer = { keep: true, x: 0.5, y: 0, w: 0.5, h: 1 };   // 只留右半边
let vfail = false;
await page.route('**/*', async route => {
  const u = route.request().url();
  if (u.startsWith(`${BASE}`)) return route.continue();
  if (!u.includes('/chat/completions') && !u.includes('/v1/messages')) return route.abort();
  const body = route.request().postDataJSON?.() || {};
  const parts = body.messages?.[0]?.content;
  const isVision = Array.isArray(parts) && parts.some(p => p.type === 'image_url');
  if (!isVision) return route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: '{}' } }] }) });
  vcalls.push(String(parts.find(p => p.type === 'text')?.text || ''));
  if (vfail) return route.fulfill({ status: 500, body: 'x' });
  return route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }) });
});
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);

const fail = [], ok = [];
const check = (c, m) => (c ? ok : fail).push(m);

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  acc.roots()[0] || acc.createRoot({ name: '我' });
  const a = db.characters.create({ name: '季怜喻', persona: '人设' });
  const me = acc.roots()[0];
  const chat = db.chats.create({ characterIds: [a.id], personaId: me.id, lastMessageAt: Date.now() });
  // 真的造一张 40x20 的图，裁出来才量得出宽高
  const c = document.createElement('canvas');
  c.width = 40; c.height = 20;
  const g = c.getContext('2d');
  g.fillStyle = '#f00'; g.fillRect(0, 0, 20, 20);
  g.fillStyle = '#00f'; g.fillRect(20, 0, 20, 20);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const imgId = await db.images.put(new File([blob], 'x.png', { type: 'image/png' }));
  // 锁屏挡着每一页（见 lock.mjs），这一份测的不是锁，先解开
  (await import('/src/system/theirs.js')).open(a.id);
  return { a: a.id, chat: chat.id, img: imgId };
});

// 一轮：用户发图 + 角色写存图
const run = async note => page.evaluate(async ([id, chatId, imgId, n]) => {
  const db = await import('/src/system/db/index.js');
  const r = await import('/src/system/ai/reply.js');
  const t = await import('/src/system/theirs.js');
  db.messages.create({ chatId, role: 'user', authorId: 'me', kind: 'image',
    imageId: imgId, content: '', status: 'done' });
  const turn = 't' + Math.random().toString(36).slice(2);
  for (const p of r.splitReply(`[存图：${n}]`)) {
    r.materialize(p, { chatId, role: 'char', authorId: id, turnId: turn, status: 'done' },
      db.characters.get(id));
  }
  await new Promise(res => setTimeout(res, 900));    // 裁是后台做的
  const photo = t.photosOf(id)[0];
  const size = photo.imageId === imgId ? null : await (async () => {
    const b = await db.images.blob(photo.imageId);
    const bmp = await createImageBitmap(b);
    return { w: bmp.width, h: bmp.height };
  })();
  return { imageId: photo.imageId, cropped: photo.cropped, from: photo.from, note: photo.note, size };
}, [ids.a, ids.chat, ids.img, note]);

const setCfg = patch => page.evaluate(async ([p]) =>
  (await import('/src/system/db/index.js')).settings.set(p), [patch]);
const setVision = () => page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  svc.setVision({ baseUrl: 'https://x.test/v1', apiKey: 'k', model: 'm' });
});

// ---- 1 默认关：不裁，也不去问识图 ----
check(!await page.evaluate(async () =>
  (await import('/src/system/db/index.js')).settings.get().cropKeptPhoto), '开关默认关着');
let r = await run('只留你');
check(r.imageId === ids.img && !r.cropped, '关着的时候存原图');
check(vcalls.length === 0, '关着的时候一次识图都不问');

// ---- 2 开了但没配识图：还是不裁，也不报错 ----
await setCfg({ cropKeptPhoto: true });
r = await run('只留你');
check(r.imageId === ids.img && !r.cropped, '没配识图接口时存原图');
check(vcalls.length === 0, '没配的时候也不去问');

// ---- 3 配上了：裁出右半边 ----
await setVision();
vcalls = [];
r = await run('把左边那个人切掉');
check(vcalls.length === 1, `问了一次识图（${vcalls.length}）`);
check(/把左边那个人切掉/.test(vcalls[0]), '把角色那句话发过去了');
check(r.imageId !== ids.img && r.cropped === true, '换成了裁过的那张，并且标了已裁');
check(r.size && r.size.w === 20 && r.size.h === 20,
  `裁出来的尺寸对（40x20 取右半 -> ${JSON.stringify(r.size)}）`);
check(await page.evaluate(async ([old]) =>
  (await import('/src/system/db/index.js')).images.has(old), [ids.img]),
  '原图还在，没被动过（消息里还指着它）');

// ---- 4 模型说看不出来：不裁 ----
answer = { keep: false, x: 0, y: 0, w: 0, h: 0 };
r = await run('随便存一下');
check(r.imageId === ids.img && !r.cropped, '模型说看不出来就不裁');

// ---- 5 框等于整张：不裁（省得白换一张一样的） ----
answer = { keep: true, x: 0, y: 0, w: 1, h: 1 };
r = await run('整张都要');
check(r.imageId === ids.img && !r.cropped, '框等于整张时不换图');

// ---- 6 识图挂了：照存原图，不连累这张照片 ----
answer = { keep: true, x: 0.5, y: 0, w: 0.5, h: 1 };
vfail = true;
r = await run('只留右边');
check(r.imageId === ids.img && !r.cropped, '识图挂了照存原图');
check(r.note === '只留右边', '那句描述还在');
vfail = false;

// ---- 7 相册里标出来 ----
answer = { keep: true, x: 0, y: 0, w: 0.5, h: 1 };
await run('只留左边');
await page.evaluate(async ([id]) => {
  const n = await import('/src/system/nav.js');
  n.openApp('theirs', `/album/${id}`);
}, [ids.a]);
await page.waitForTimeout(800);
const body = await page.evaluate(() => document.body.innerText);
check(/你发的 · 已裁/.test(body), '相册里标出「已裁」');
check(/与你发送的原图不同/.test(body), '说明了已裁那张和原图不一样');

// ---- 8 登记在账上 ----
const listed = await page.evaluate(async () => {
  const cost = await import('/src/system/ai/cost.js');
  const e = cost.EXTRA_CALLS.find(x => x.id === 'cropKeptPhoto');
  return { has: !!e, off: e?.off, on: e?.on({ cropKeptPhoto: true }) };
});
check(listed.has && listed.off === false && listed.on === true,
  `登记在 EXTRA_CALLS 里，默认关（${JSON.stringify(listed)}）`);

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errors.length) console.log('\n' + errors.slice(0, 6).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
