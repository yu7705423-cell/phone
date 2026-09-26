// 恢复备份时切片存坏了（ARCHITECTURE 4.273）：存进库之前把切片抄成独立的 Blob；内容是 ZIP 的图一律不存；
// 诊断认得出「几张图都是同一个 ZIP 的开头」
import { BASE, EXE, PNG_B64, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const r = await page.evaluate(async b64 => {
  const png = await (await fetch(`data:image/png;base64,${b64}`)).blob();
  const { db } = await import('/src/system/db/index.js');
  const { idb } = await import('/src/system/db/idb.js');
  const { zip } = await import('/src/system/zip.js');
  const backup = await import('/src/system/backup.js');
  const diag = await import('/src/system/imgdiag.js');
  const out = {};

  // 一、切片：把图放在一个大文件中间，切出来存，读回来必须是图本身
  const pad = new Uint8Array(100000);
  const big = new Blob([pad, png, pad]);
  const slice = big.slice(pad.length, pad.length + png.size, 'image/png');
  await db.images.putRaw('img_slice', slice);
  const row = await idb.get('images', 'img_slice');
  const a = new Uint8Array(await row.blob.arrayBuffer());
  const b = new Uint8Array(await png.arrayBuffer());
  out.sliceOk = a.length === b.length && a.every((x, i) => x === b[i]) && row.blob.type === 'image/png';
  // 存进去的不再是那个切片对象
  out.solid = row.blob !== slice;

  // 二、内容是 ZIP 的一律不存
  const z = await zip([{ name: 'a.txt', text: 'x' }]);
  let refused = '';
  try { await db.images.putRaw('img_zip', z); } catch (e) { refused = String(e.message || e); }
  out.refused = /ZIP/.test(refused) && !(await idb.get('images', 'img_zip'));

  // 三、恢复一份图片条目是 ZIP 的备份：那几张跳过、报出来，其余照常
  const c = db.characters.create({ name: '阿岚' });
  db.characters.update(c.id, { avatar: 'img_good' });
  const json = JSON.stringify({ _format: 'mini-phone-backup', _data: 0, characters: [{ id: c.id, name: '阿岚', avatar: 'img_good', cover: 'img_bad' }] });
  const pack = await zip([
    { name: 'backup.json', text: json },
    { name: 'images/img_good.png', blob: png },
    { name: 'images/img_bad.png', blob: z },
  ]);
  let res;
  try { res = await backup.restore(new File([pack], 'b.zip', { type: 'application/zip' })); } catch (e) { out.restoreErr = String(e.message || e); }
  out.res = res;
  out.goodIn = !!(await idb.get('images', 'img_good'));
  out.badIn = !!(await idb.get('images', 'img_bad'));
  return out;
}, PNG_B64);

ok('切片存进去读出来是图本身', r.sliceOk, JSON.stringify(r));
ok('存进去的不再是切片对象', r.solid, '');
ok('内容是 ZIP 的图不存，报错说明', r.refused, JSON.stringify(r));
ok('恢复备份：好的放回，坏的跳过并报出来', r.res && r.res.bad?.length === 1 && /img_bad/.test(r.res.bad[0]) && r.res.media === 1 && r.goodIn && !r.badIn, JSON.stringify(r.res || r.restoreErr));

// 四、诊断认得出同一个 ZIP 的开头
const d = await page.evaluate(async () => {
  const { idb } = await import('/src/system/db/idb.js');
  const { db } = await import('/src/system/db/index.js');
  const { zip } = await import('/src/system/zip.js');
  const diag = await import('/src/system/imgdiag.js');
  const z = await zip([{ name: 'backup.json', text: '{}' }, { name: 'images/x.png', text: 'PNG' }]);
  // 直接往库里塞两张「同一个 ZIP 的开头」（绕过 putRaw，模拟坏掉的库）
  await idb.put('images', { id: 'img_z1', blob: z.slice(0, 90), w: 1, h: 1, bytes: 90, createdAt: Date.now() });
  await idb.put('images', { id: 'img_z2', blob: z.slice(0, 70), w: 1, h: 1, bytes: 70, createdAt: Date.now() });
  const c = db.characters.create({ name: '阿沅', avatar: 'img_z1', cover: 'img_z2' });
  const r = await diag.check();
  return diag.summary(r);
});
ok('诊断说出是恢复备份时切片存坏了，并给出复原办法', /同一个 ZIP 的开头/.test(d) && /再恢复一次/.test(d), d);

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
