// 排便改成一次一条、各带时间与形态；角色那一份也有。
import { BASE, EXE, chromium } from './_env.mjs';
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
await page.waitForTimeout(1500);

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  acc.roots()[0] || acc.createRoot({ name: '我' });
  const a = db.characters.create({ name: '甲', persona: '人设甲', healthOn: true });
  return { char: a.id };
});

const go = async (app, route) => {
  await page.evaluate(([app, route]) => import('/src/system/nav.js').then(n => n.openApp(app, route)), [app, route]);
  await page.waitForTimeout(700);
};
const fail = [], ok = [];
const check = (c, m) => (c ? ok : fail).push(m);
const txt = () => page.evaluate(() => document.body.innerText);
const dayOf = who => page.evaluate(async w =>
  (await import('/src/system/health.js')).dayOf(w), who);
const clickText = t => page.evaluate(l => {
  const b = [...document.querySelectorAll('button')].find(e => e.innerText.trim() === l);
  if (!b) throw new Error('找不到按钮：' + l);
  b.click();
}, t);

// ---- 1 空的时候只有「记一次」 ----
await go('health', '/');
let body = await txt();
check(/排便/.test(body) && /记一次/.test(body), '首页有「排便」和「记一次」');
check(!/第 1 次/.test(body), '还没记时没有条目');

// ---- 2 记一次：时间默认填当下 ----
await clickText('记一次');
await page.waitForTimeout(500);
let d = await dayOf('me');
check(d.poops.length === 1, `记了一条（${d.poops.length}）`);
check(/^\d\d:\d\d$/.test(d.poops[0].at), `时间默认填了当下（${d.poops[0].at}）`);
body = await txt();
check(/第 1 次/.test(body), '界面上出现「第 1 次」');

// ---- 3 每条各有自己的形态 ----
await page.evaluate(() => {
  const blocks = [...document.querySelectorAll('.hl-poop')];
  const b = [...blocks[0].querySelectorAll('.chip')].find(e => e.innerText.trim() === '表面光滑');
  b.click();
});
await page.waitForTimeout(400);
await clickText('记一次');
await page.waitForTimeout(500);
await page.evaluate(() => {
  const blocks = [...document.querySelectorAll('.hl-poop')];
  const b = [...blocks[1].querySelectorAll('.chip')].find(e => e.innerText.trim() === '糊状');
  b.click();
});
await page.waitForTimeout(400);
d = await dayOf('me');
check(d.poops.length === 2 && d.poops[0].form === 'b4' && d.poops[1].form === 'b6',
  `两条各记各的形态（${d.poops.map(e => e.form).join(',')}）`);

// ---- 4 时间可以改，也可以清空 ----
const typeTime = (idx, v) => page.evaluate(([i, val]) => {
  const inp = [...document.querySelectorAll('.hl-poop')][i].querySelector('input');
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(inp, val);
  inp.dispatchEvent(new Event('input', { bubbles: true }));
}, [idx, v]);
await typeTime(0, '08:20');
await page.waitForTimeout(400);
d = await dayOf('me');
check(d.poops[0].at === '08:20', `改得了时间（${d.poops[0].at}）`);
await typeTime(1, '');
await page.waitForTimeout(400);
d = await dayOf('me');
check(d.poops[1].at === '', '清得空时间');
check(d.poops.length === 2, '清空时间之后这一条还在');

// ---- 5 非法字符进不去，拼不成 HH:MM 的当没填 ----
await typeTime(1, 'ab1:9x9');
await page.waitForTimeout(400);
d = await dayOf('me');
check(d.poops[1].at === '1:99', `只留下数字与冒号（"${d.poops[1].at}"）`);
const tt = await page.evaluate(async () => {
  const h = await import('/src/system/health.js');
  return ['1:99', '25:00', '8:2', '8:05', '23:59'].map(at => h.poopTime({ at }));
});
check(JSON.stringify(tt) === JSON.stringify(['', '', '', '08:05', '23:59']),
  `不是时刻的一律当没填，拼全的补零（${JSON.stringify(tt)}）`);

// ---- 6 删掉中间一条，别的不受影响 ----
await page.evaluate(async () => {
  const h = await import('/src/system/health.js');
  const date = h.dateKey();
  h.set(h.ME, date, { poops: [
    { at: '07:00', form: 'b1' }, { at: '12:00', form: 'b4' }, { at: '20:00', form: 'b7' }] });
});
await page.waitForTimeout(500);
await page.evaluate(() => {
  [...document.querySelectorAll('.hl-poop')][1]
    .querySelector('button[aria-label="删除第 2 次"]').click();
});
await page.waitForTimeout(500);
d = await dayOf('me');
check(d.poops.length === 2 && d.poops[0].at === '07:00' && d.poops[1].at === '20:00',
  `删中间那条，剩下的没串位（${d.poops.map(e => e.at).join(',')}）`);

// ---- 7 不设上限 ----
await page.evaluate(async () => {
  const h = await import('/src/system/health.js');
  h.set(h.ME, h.dateKey(), { poops: Array.from({ length: 30 },
    (_, i) => ({ at: '', form: '' })) });
});
d = await dayOf('me');
check(d.poops.length === 30, `30 条也存得下（${d.poops.length}）`);

// ---- 8 旧结构读得出来（从旧备份恢复的那种行）----
const old = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const h = await import('/src/system/health.js');
  const row = db.health.create({ who: 'me', date: '2020-01-02', poop: 3, poopForm: 'b2' });
  const got = h.dayOf('me', '2020-01-02');
  return { n: got.poops.length, forms: got.poops.map(e => e.form) };
});
check(old.n === 3 && old.forms[0] === 'b2' && old.forms[1] === '',
  `旧行摊成三条、形态落在第一条（${JSON.stringify(old)}）`);

// ---- 9 历史页 ----
await page.evaluate(async () => {
  const h = await import('/src/system/health.js');
  h.set(h.ME, h.dateKey(), { poops: [{ at: '08:20', form: 'b4' }, { at: '', form: '' }] });
});
await go('health', '/log');
body = await txt();
check(/排便 2 次（08:20 表面光滑）/.test(body),
  `历史摘要：次数在前，填了的写出来，没填的不占位`);
check(await page.evaluate(() => [...document.querySelectorAll('button')]
  .some(b => b.innerText.trim() === '排便')), '趋势那一排能选「排便」');

// ---- 10 上下文：自己那份两道闸 ----
const ctx = () => page.evaluate(async ([charId]) => {
  const db = await import('/src/system/db/index.js');
  const blk = await import('/src/system/ai/context/health.js');
  return blk.build({ char: db.characters.get(charId) });
}, [ids.char]);

await page.evaluate(async () => (await import('/src/system/db/index.js'))
  .settings.set({ healthInject: true, healthPoopInject: false }));
check(!/Bowel/.test(await ctx()), '排便开关关着：不写');
await page.evaluate(async () => (await import('/src/system/db/index.js'))
  .settings.set({ healthPoopInject: true }));
let c = await ctx();
check(/Bowel movements today: 2 — 08:20 \(表面光滑\); time not recorded\./.test(c),
  `写的是事实：${(c.match(/Bowel[^\n]*/) || [''])[0]}`);
check(!/constipat|diarrh|should|healthy|too /i.test(c), '没有掺进判断词');

// ---- 11 角色那一份：页面上有，上下文里也有 ----
await go('health', `/char/${ids.char}`);
body = await txt();
check(/排便/.test(body) && /记一次/.test(body), '角色页也有这一栏');
check(/为该角色设定/.test(body), '角色页的说明写的是「设定」不是「记录」');
await clickText('记一次');
await page.waitForTimeout(500);
const cd = await dayOf(ids.char);
check(cd.poops.length === 1, `角色那一条记下了（${cd.poops.length}）`);
await page.evaluate(async ([id]) => {
  const h = await import('/src/system/health.js');
  h.set(id, h.dateKey(), { poops: [{ at: '06:30', form: 'b3' }] });
}, [ids.char]);
c = await ctx();
const hisLine = (c.split('## Your own body today')[1] || '').match(/Bowel[^\n]*/) || [''];
check(/Your own body today/.test(c) && /Bowel movements today: 1 — 06:30 \(表面有裂痕\)\./.test(hisLine[0]),
  `角色那一份也写进去了，是它自己那一条：${hisLine[0]}`);

// 角色那份跟着角色卡的开关走，和用户那道闸无关
await page.evaluate(async () => (await import('/src/system/db/index.js'))
  .settings.set({ healthInject: false, healthPoopInject: false }));
c = await ctx();
check(/06:30/.test(c), '用户那两道闸关着，角色自己那份照常（它走角色卡的开关）');
await page.evaluate(async ([id]) => {
  const db = await import('/src/system/db/index.js');
  db.characters.update(id, { healthOn: false });
}, [ids.char]);
check(!/06:30/.test(await ctx()), '关掉角色卡上那个开关之后，角色这份也不写了');

// ---- 12 备份来回 ----
const rt = await page.evaluate(async () => {
  const h = await import('/src/system/health.js');
  const b = await import('/src/system/backup.js');
  const db = await import('/src/system/db/index.js');
  h.set(h.ME, h.dateKey(), { poops: [{ at: '09:09', form: 'b5' }] });
  const blob = await b.build();
  db.health.all().forEach(r => db.health.remove(r.id));
  await b.restore(blob);
  return h.today(h.ME).poops;
});
check(rt.length === 1 && rt[0].at === '09:09' && rt[0].form === 'b5',
  `备份来回一趟，时间与形态原样回来（${JSON.stringify(rt)}）`);

console.log(ok.filter(Boolean).map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errors.length) console.log('\n' + errors.slice(0, 6).join('\n'));
console.log(`\n合计 ${ok.filter(Boolean).length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
