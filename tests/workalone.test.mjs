// 长篇不挂会话（ARCHITECTURE 4.262）
//
// 用户拍板：长篇独立出来。人物直接从联系里选，不需要先有一段会话；没有会话就没有「带上原来的记忆」。
//   一、首页新建：长篇可以「直接选人物」，建出来的作品 chatId 为空、castIds 是选的人
//   二、提示词拼得出来：角色人设在里面，不带任何会话的东西
//   三、角色包带上它；删掉那个角色时作品连章带正文一起删；番外仍必须挂会话
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);

const ids = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const a = db.characters.create({ name: '沈砚', persona: '旧书店的老板，说话慢。' });
  const b = db.characters.create({ name: '阿岚', persona: '刚搬来的房客。' });
  const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('us', '/');
  return { a: a.id, b: b.id };
});
await page.waitForTimeout(800);

// 一
await page.locator('.navbar button[aria-label="新建"], .navbar [aria-label="新建"]').first().click();
await page.waitForTimeout(400);
await page.locator('.seg-item', { hasText: '长篇' }).click();
await page.waitForTimeout(200);
await page.locator('.seg-item', { hasText: '直接选人物' }).click();
await page.waitForTimeout(200);
await page.locator('.list-item', { hasText: '沈砚' }).click();
await page.waitForTimeout(200);
await page.locator('input[placeholder="这部作品叫什么"]').fill('雨落之前');
const sheetText = await ev(() => document.body.innerText);
ok('一、新建长篇可以直接选人物，没有「带上原来的记忆」这一项', /直接选人物/.test(sheetText) && !/带上原来的记忆与关系/.test(sheetText), JSON.stringify({ pick: /直接选人物/.test(sheetText), carry: /带上原来的记忆与关系/.test(sheetText), seg: sheetText.match(/一段会话[^\n]*/)?.[0], list: sheetText.match(/人物[^\n]*\n[^\n]*/)?.[0] }));
await page.locator('button', { hasText: '建立' }).click();
await page.waitForTimeout(600);
const w = await ev(async () => (await import('/src/system/work.js')).all()[0]);
ok('一、建出来的作品：不挂会话，人物是选的那个', w && w.chatId === '' && w.castIds?.[0] === ids.a && w.kind === 'saga' && w.carry === false, JSON.stringify(w));
ok('一、建完进了作品页', /雨落之前/.test(await page.locator('.navbar').innerText()));

// 二
const sys = await ev(async id => {
  const work = await import('/src/system/work.js');
  const engine = await import('/src/system/ai/engine.js');
  const { db } = await import('/src/system/db/index.js');
  const w = work.get(id);
  const ch = work.addChapter(id, { title: '到站' });
  const r = engine.buildWorkSystem(w, ch, db.characters.get(w.castIds[0]), []);
  return r.system;
}, w?.id);
ok('二、提示词拼得出来，带着角色人设', /旧书店的老板/.test(sys) && /沈砚/.test(sys), sys.slice(0, 200));

// 三
const pack = await ev(async o => {
  const cp = await import('/src/system/charpack.js');
  const g = cp.collect(o.a, { history: false });
  return g ? { works: g.works?.length ?? (g.rows?.works || []).length, raw: Object.keys(g).slice(0, 12) } : { none: true };
}, ids);
ok('三、角色包带上不挂会话的长篇', pack.works === 1, JSON.stringify(pack));
const extraErr = await ev(async o => { try { (await import('/src/system/work.js')).create({ kind: 'extra', castIds: [o.a] }); return ''; } catch (e) { return String(e.message); } }, ids);
ok('三、番外仍必须挂会话', /会话/.test(extraErr), extraErr);
const gone = await ev(async o => {
  const purge = await import('/src/system/purge.js');
  const { db } = await import('/src/system/db/index.js');
  purge.dropCharacter(o.a);
  return { works: db.works.all().length, chapters: db.chapters.all().length };
}, ids);
ok('三、删掉人物：作品连章一起删', gone.works === 0 && gone.chapters === 0, JSON.stringify(gone));

ok('没有页面错误', !errs.length, errs.join('\n'));
await browser.close();
const fail = R.filter(x => !x.pass).length;
console.log(`\n${R.length - fail}/${R.length} 项通过`);
process.exit(fail ? 1 : 0);
