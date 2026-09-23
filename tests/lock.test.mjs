// 角色手机的锁屏：挡得住、猜得对、问得出线索、看得了答案、备份带得走。
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const shelf = await import('/src/system/shelf.js');
  acc.roots()[0] || acc.createRoot({ name: '我' });
  const a = db.characters.create({ name: '季怜喻', persona: '人设正文', healthOn: true });
  shelf.add(a.id, { title: '一本书' });
  return { a: a.id };
});

// openApp(app,'/') 对已经打开的 app 会保留原来的栈（nav.js 有意如此），
// 所以回根页要自己退一下
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
const tapKey = k => page.evaluate(([x]) => {
  const b = [...document.querySelectorAll('.tp-key')].find(e => e.getAttribute('aria-label') === x);
  if (!b) throw new Error('找不到键：' + x);
  b.click();
}, [k]);
const typeCode = async c => { for (const d of String(c)) { await tapKey(d); await page.waitForTimeout(90); } };

// ---- 1 没生成过密码也锁着：按角色卡当场推一个，不调接口 ----
await go(`/home/${ids.a}`);
let body = await txt();
check(/位密码/.test(body), '没生成过也是锁屏，不是一页「先设定一个密码」');
check(!/设定密码/.test(body) && !/密码位数/.test(body), '没有那一页设置');
check(!/书架/.test(body), '没解开之前看不见主屏');
const auto = await page.evaluate(async ([id]) =>
  (await import('/src/system/theirs.js')).lockOf(id), [ids.a]);
check(/^\d{4}$/.test(auto.code) && auto.src === 'random',
  `这个角色没有生日也没有数字，推出来的是四位（${JSON.stringify(auto.src)}）`);
check((auto.hints || []).length === 1 && /无从推测/.test(auto.hints[0]),
  '推不出来的那种只给一条线索，直说推不出来');

// ---- 2 设定密码（不调真接口，直接塞一条）----
await page.evaluate(async ([id]) => {
  const t = await import('/src/system/theirs.js');
  t.setLock(id, { code: '0412', why: '它生日那天',
    hints: ['和一个日子有关', '是春天的一天', '月份是四月'] });
}, [ids.a]);
await page.waitForTimeout(400);

// ---- 3 每一页都挡，不只主屏 ----
for (const r of ['home', 'shelf', 'body', 'day']) {
  await go(`/${r}/${ids.a}`);
  const b = await txt();
  check(/位密码/.test(b), `/${r} 也被锁屏挡住了`);
}

// ---- 4 猜错 ----
await go(`/home/${ids.a}`);
await typeCode('1111');
await page.waitForTimeout(500);
body = await txt();
check(/密码错误，已尝试 1 次/.test(body), '猜错会说，而且记着次数');
check(/位密码/.test(body) === false || /密码错误/.test(body), '仍然停在锁屏上');
const dots = await page.evaluate(() => document.querySelectorAll('.tp-dots i.is-on').length);
check(dots === 0, '猜错之后输入清空');

// ---- 5 问线索：一次一条，不调接口 ----
await page.evaluate(() => { window.__toasts = []; });
const hint1 = await page.evaluate(async ([id]) => {
  const t = await import('/src/system/theirs.js');
  return t.nextHint(id);
}, [ids.a]);
check(hint1 === '和一个日子有关', `第一条线索是最远的那条：${hint1}`);
const hint2 = await page.evaluate(async ([id]) =>
  (await import('/src/system/theirs.js')).nextHint(id), [ids.a]);
const hint3 = await page.evaluate(async ([id]) =>
  (await import('/src/system/theirs.js')).nextHint(id), [ids.a]);
const hint4 = await page.evaluate(async ([id]) =>
  (await import('/src/system/theirs.js')).nextHint(id), [ids.a]);
check(hint2 === '是春天的一天' && hint3 === '月份是四月', '第二、三条依次给出');
check(hint4 === null, '问完了就没有了，不凭空编');
const shown = await page.evaluate(async ([id]) =>
  (await import('/src/system/theirs.js')).lockOf(id).shown, [ids.a]);
check(shown === 3, '问过的那几条记下来了');
await go(`/home/${ids.a}`);
check(/直接查看密码/.test(await txt()) && !/询问线索/.test(await txt()),
  '线索问完之后，界面改成「直接查看密码」');

// ---- 6 猜对了就进去 ----
await typeCode('0412');
await page.waitForTimeout(700);
body = await txt();
check(/书架/.test(body), '猜对之后进了主屏');
check(await page.evaluate(async ([id]) =>
  (await import('/src/system/theirs.js')).isOpen(id), [ids.a]), '记成已解锁');

// 解开之后别的页也不再问
await go(`/body/${ids.a}`);
check(!/位密码/.test(await txt()), '解开之后别的页也不再问');

// ---- 7 「锁上」能锁回去 ----
await go(`/home/${ids.a}`);
await page.evaluate(() => {
  [...document.querySelectorAll('.tp-dock-btn')].find(b => b.innerText.includes('锁上')).click();
});
await page.waitForTimeout(700);
check(/位密码/.test(await txt()), '按「锁上」又锁回去了');

// ---- 8 解锁状态不落库：重新载入之后还得再解 ----
await page.evaluate(async ([id]) => (await import('/src/system/theirs.js')).open(id), [ids.a]);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);
await go(`/home/${ids.a}`);
check(/位密码/.test(await txt()), '刷新之后重新锁上（解锁状态没落库）');

// ---- 9 挑人那一页写明锁着 ----
await go('/');
const pickText = await txt();
// 每一台都锁着，所以「锁着」不写 —— 写了就是每一行重复同一句。
// 解开过的那几台才标一下
check(!/已解锁/.test(pickText) && /书架 1 本/.test(pickText),
  `挑人那一页写的是这台手机上有什么，锁着是常态不写：${pickText.replace(/\n/g, ' | ').slice(0, 160)}`);
await page.evaluate(async ([id]) => (await import('/src/system/theirs.js')).open(id), [ids.a]);
await go('/');
check(/已解锁/.test(await txt()), '解开过的那一台才标「已解锁」');
await page.evaluate(async ([id]) => (await import('/src/system/theirs.js')).relock(id), [ids.a]);

// ---- 10 备份带得走 ----
const rt = await page.evaluate(async ([id]) => {
  const b = await import('/src/system/backup.js');
  const db = await import('/src/system/db/index.js');
  const t = await import('/src/system/theirs.js');
  const blob = await b.build();
  db.phones.all().forEach(r => db.phones.remove(r.id));
  const gone = t.lockOf(id);
  await b.restore(blob);
  const back = t.lockOf(id);
  return { goneSrc: gone?.src || null, code: back?.code || null, src: back?.src || null };
}, [ids.a]);
check(rt.goneSrc === 'random' && rt.code === '0412' && rt.src === 'ai',
  `备份来回一趟，存过的那个密码还在（${JSON.stringify(rt)}）`);

// ---- 11 角色不在时不炸 ----
await go('/lock/nope');
check(/这个角色已经不在了/.test(await txt()), '角色没了不白屏');

await go(`/home/${ids.a}`);
await page.screenshot({ path: `${OUT}/lock.png`, fullPage: true });

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errors.length) console.log('\n' + errors.slice(0, 6).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
