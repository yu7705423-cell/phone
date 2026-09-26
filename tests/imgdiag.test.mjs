// 图片诊断与删图日志（ARCHITECTURE 4.272）：每次删图留痕；检查能分出「记录不在」「数据是空的」「显示那一层」
import { BASE, EXE, PNG_B64, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);

const r = await ev(async b64 => {
  const { db } = await import('/src/system/db/index.js');
  const { idb } = await import('/src/system/db/idb.js');
  const diag = await import('/src/system/imgdiag.js');
  const png = await (await fetch(`data:image/png;base64,${b64}`)).blob();
  const file = new File([png], 'a.png', { type: 'image/png' });
  const a = await db.images.put(file);
  const b = await db.images.put(file);
  const c = await db.images.put(file);
  const ch = db.characters.create({ name: '阿岚', avatar: a });
  db.settings.set({ appIcons: { chat: { imageId: b } } });
  const out = {};
  out.clean = await diag.check();
  // 一张被删了（记录不在）
  await db.images.destroy(b, '测试：直接删');
  // 一张记录在、数据是空的（浏览器把 blob 背后的文件收走了那种）
  await idb.put('images', { id: c, blob: new Blob([]), w: 10, h: 10, bytes: 999, createdAt: Date.now() });
  db.characters.update(ch.id, { cover: c });
  out.after = await diag.check();
  out.text = diag.summary(out.after);
  out.logs = await diag.entries();
  // remove 那条路（没有别处引用才删）也留痕
  const d = await db.images.put(file);
  await db.images.remove(d);
  await new Promise(res => setTimeout(res, 100));
  out.logs2 = await diag.entries();
  return out;
}, PNG_B64);
ok('都在时：没有缺、没有空', r.clean.missing.length === 0 && r.clean.empty.length === 0 && r.clean.referenced >= 2, JSON.stringify(r.clean));
ok('删掉的那张：报「记录不在」并写明是图标', r.after.missing.length === 1 && /图标 chat/.test(r.after.missing[0].where), JSON.stringify(r.after.missing));
ok('数据是空的那张：报「记录在、数据是空的」并写明是封面', r.after.empty.length === 1 && /封面 阿岚/.test(r.after.empty[0].where), JSON.stringify(r.after.empty));
ok('几行说明写得出来', /记录不在库里 1 处：图标 chat/.test(r.text) && /数据是空的 1 张：封面 阿岚/.test(r.text), r.text);
ok('删图日志记着那一笔：哪张、为什么、从哪儿', r.logs[0]?.kind === 'destroy' && /测试：直接删/.test(r.logs[0].why) && r.logs[0].from.length > 0, JSON.stringify(r.logs[0]));
ok('remove 那条路删的也留痕', r.logs2[0]?.why.includes('没有别处引用'), JSON.stringify(r.logs2[0]));

// 存储页上有这一栏
await ev(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('settings', '/storage'); });
await page.waitForTimeout(900);
await page.getByText('检查图片', { exact: true }).click();
await page.waitForTimeout(1200);
const txt = await ev(() => document.body.innerText);
ok('存储页「检查图片」给出结果', /库里记录/.test(txt) && /记录不在库里 1 处/.test(txt), txt.slice(0, 300));
await page.getByText('删图日志', { exact: true }).click();
await page.waitForTimeout(600);
const txt2 = await ev(() => document.body.innerText);
ok('存储页「删图日志」列出记录', /测试：直接删/.test(txt2), '');

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
