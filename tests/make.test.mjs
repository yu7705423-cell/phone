// 逐项生成：一个 app 一次请求、失败只坏那一个、再生成是追加不是重掷。
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => {
  // 第 6 条那一项是故意让它 500 的，那条控制台错误是预期内的
  const t = m.text();
  if (m.type() === 'error' && !/status of 500/.test(t)) errors.push('CONSOLE: ' + t.slice(0, 200));
});

// 假模型在**网络层**拦。ESM 的命名空间对象不能重定义，改不了 runJSONTask，
// 而且从这一层拦还顺带把 engine、队列、JSON 解析那几层都真的跑了一遍
let calls = [];
let failNext = null;
await page.route('**/*', async route => {
  const u = route.request().url();
  if (u.startsWith(`${BASE}`)) return route.continue();
  if (!u.includes('/v1/messages') && !u.includes('/chat/completions')) return route.abort();
  const post = route.request().postDataJSON?.() || {};
  const sys = String(post.system || '');
  const kind = /notes app/.test(sys) ? 'notes'
    : /search history/.test(sys) ? 'visits'
    : /List the conversations/.test(sys) ? 'chats'
    : /List the photos/.test(sys) ? 'album' : 'other';
  calls.push({ kind, sys });
  if (failNext === kind) { failNext = null; return route.fulfill({ status: 500, body: 'nope' }); }
  const n = Number((sys.match(/- (\d+) (?:notes|entries)/) || [])[1] || 3);
  const tag = calls.length;
  const body = kind === 'notes'
    ? JSON.stringify({ notes: Array.from({ length: n }, (_, i) => ({ title: `记${tag}-${i}`, text: '正文' })) })
    : kind === 'chats'
    ? JSON.stringify({ chats: Array.from({ length: n }, (_, i) => ({ name: `人${tag}-${i}`, preview: '一句' })) })
    : kind === 'album'
    ? JSON.stringify({ photos: Array.from({ length: n }, (_, i) => ({ note: `照片${tag}-${i}` })) })
    : JSON.stringify({ visits: Array.from({ length: n }, (_, i) => ({ query: `查${tag}-${i}`, site: '某站' })) });
  return route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ content: [{ type: 'text', text: body }] }) });
});

await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const svc = await import('/src/system/ai/services.js');
  svc.newChatPreset({ name: 'T', provider: 'anthropic', apiKey: 'k', model: 'm' });
  acc.roots()[0] || acc.createRoot({ name: '我' });
  const a = db.characters.create({ name: '乃木绿实', persona: '人设正文' });
  // 锁屏挡着每一页（见 lock.mjs），这一份测的不是锁，先解开
  (await import('/src/system/theirs.js')).open(a.id);
  return { a: a.id };
});
await page.waitForTimeout(400);

const go = async route => {
  await page.evaluate(async ([r]) => {
    const n = await import('/src/system/nav.js');
    n.openApp('theirs', r);
    if (r === '/') n.popToRoot();
  }, [route]);
  await page.waitForTimeout(700);
};
const txt = () => page.evaluate(() => document.body.innerText);
const fail = [], ok = [];
const check = (c, m) => (c ? ok : fail).push(m);
const counts = () => page.evaluate(async ([id]) => {
  const t = await import('/src/system/theirs.js');
  return { notes: t.notesOf(id).length, visits: t.visitsOf(id).length };
}, [ids.a]);
const kinds = () => calls.map(c => c.kind);

// ---- 1 空手机：主屏说得清楚，而且给得出入口 ----
await go(`/home/${ids.a}`);
let body = await txt();
// 桌面是一块桌面：自带的四个空着也画，点进去才是空的（见 theirs.mjs）
check(/聊天/.test(body) && /相册/.test(body) && /备忘录/.test(body) && /浏览器/.test(body),
  '空手机上自带的四个照常在桌面上');
check(/生成/.test(body), '底下那一条里给得出入口');

// ---- 2 逐项生成：一个 app 一次请求 ----
await go(`/make/${ids.a}`);
check(/备忘录/.test(await txt()) && /浏览记录/.test(await txt()), '生成页列出了每一项');
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.list-item')].find(e => e.innerText.startsWith('备忘录'));
  [...row.querySelectorAll('button')].find(b => b.innerText.trim() === '生成').click();
});
await page.waitForTimeout(900);
check(JSON.stringify(kinds()) === JSON.stringify(['notes']),
  `只发了备忘录这一个请求：${JSON.stringify(kinds())}`);
let c = await counts();
check(c.notes === 6 && c.visits === 0, `只生成了备忘录（${JSON.stringify(c)}）`);

// ---- 3 再生成一次是追加，不是重掷 ----
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.list-item')].find(e => e.innerText.startsWith('备忘录'));
  [...row.querySelectorAll('button')].find(b => b.innerText.trim() === '生成').click();
});
await page.waitForTimeout(900);
c = await counts();
check(c.notes === 12, `再生成一次是往后加（${c.notes}）`);
const sys = calls[1]?.sys || '';
check(/Already there/.test(sys) && /记1-0/.test(sys), '第二次把已有的发过去了，让它别重复');

// ---- 4 条数可改，不设上限 ----
await page.evaluate(() => {
  // 按所属的那一栏找，不按下标：MAKERS 多一项下标就错位
  const field = [...document.querySelectorAll('.field')]
    .find(f => f.innerText.startsWith('备忘录每次生成多少'));
  const inp = field.querySelector('input[type="number"]');
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(inp, '40');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.list-item')].find(e => e.innerText.startsWith('备忘录'));
  [...row.querySelectorAll('button')].find(b => b.innerText.trim() === '生成').click();
});
await page.waitForTimeout(900);
c = await counts();
check(c.notes === 52, `一次要 40 条也照给（${c.notes}）`);

// ---- 5 全部生成：一个一个发 ----
calls = [];
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '全部生成').click();
});
await page.waitForTimeout(1500);
const all = kinds();
check(JSON.stringify(all) === JSON.stringify(['chats', 'album', 'notes', 'visits']),
  `全部生成也是一个一个发：${JSON.stringify(all)}`);

// ---- 6 中间坏一个，前面的留着，后面的照常 ----
calls = []; failNext = 'notes';
const before = await counts();
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find(b => b.innerText.trim() === '全部生成').click();
});
await page.waitForTimeout(1600);
const after = await counts();
check(after.notes === before.notes, '坏掉那一项没动数据');
check(after.visits > before.visits, '后面那一项照常生成了');
check(JSON.stringify(kinds()) === JSON.stringify(['chats', 'album', 'notes', 'visits']),
  `坏了一个不打断后面的：${JSON.stringify(kinds())}`);

// ---- 7 两个新 app 出现在主屏上 ----
await go(`/home/${ids.a}`);
body = await txt();
check(/备忘录/.test(body) && /浏览器/.test(body), '主屏上多了备忘录与浏览器两格');
check(await page.evaluate(() =>
  [...document.querySelectorAll('.tp-dock-btn')].some(e => e.innerText.includes('生成'))),
  '有内容之后那一条还在原处，不换说法');

// ---- 8 两个页面点得开、列得出、删得掉 ----
await go(`/notes/${ids.a}`);
check(/共 \d+ 条/.test(await txt()), '备忘录列出来了');
const n0 = (await counts()).notes;
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(e => (e.getAttribute('aria-label') || '').startsWith('删除 '));
  b.click();
});
await page.waitForTimeout(500);
await page.evaluate(() => {
  [...document.querySelectorAll('.overlay button')].find(b => b.innerText.trim() === '删除')?.click();
});
await page.waitForTimeout(600);
check((await counts()).notes === n0 - 1, '备忘录逐条删得掉');

await go(`/browser/${ids.a}`);
check(/搜索记录 \d+ 条/.test(await txt()), '浏览记录列出来了');
check(/新的在上/.test(await txt()), '说明了排序');

// ---- 9 空状态给得出去生成的路 ----
await page.evaluate(async ([id]) => {
  const t = await import('/src/system/theirs.js');
  t.set(id, { notes: [], visits: [] });
}, [ids.a]);
await go(`/notes/${ids.a}`);
check(/还没有备忘录/.test(await txt()) && /去生成/.test(await txt()), '空的时候给得出去生成的路');

// ---- 10 备份带得走 ----
const rt = await page.evaluate(async ([id]) => {
  const t = await import('/src/system/theirs.js');
  const b = await import('/src/system/backup.js');
  const db = await import('/src/system/db/index.js');
  t.addNotes(id, [{ title: '一条', text: '正文' }]);
  t.addVisits(id, [{ query: '查一下', site: '某站' }]);
  const blob = await b.build();
  db.phones.all().forEach(r => db.phones.remove(r.id));
  await b.restore(blob);
  return { notes: t.notesOf(id).length, visits: t.visitsOf(id).length };
}, [ids.a]);
check(rt.notes === 1 && rt.visits === 1, `备份来回一趟都在（${JSON.stringify(rt)}）`);

await go(`/make/${ids.a}`);
await page.screenshot({ path: `${OUT}/make.png`, fullPage: true });

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errors.length) console.log('\n' + errors.slice(0, 6).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
