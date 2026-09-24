// 还有别处在用的图不能被删。
//
//   一、存过外观预设，再换壁纸、换图标：旧图还在预设里，不删；套回预设，图都在
//   二、角色头像是从头像池里挑的那张，换头像时池里那张不删
//   三、没人用的照删（换掉的旧图不能越攒越多）
//   四、ins 风挂件的照片（config.cover）算作有引用，「清理无引用」不删它
//   五、不认识的挂件（更新一版新加的，此刻跑着旧代码）开机时不从主界面上抹掉
import { BASE, OUT, EXE, PNG_B64, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.addInitScript(b => { window.BASE = b; }, BASE);
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const r = await page.evaluate(async b64 => {
  const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
  const file = () => new File([blob], 'x.png', { type: 'image/png' });
  const { images } = await import('/src/system/db/images.js');
  const { db } = await import('/src/system/db/index.js');
  const look = await import('/src/system/look.js');
  const looks = await import('/src/system/looks.js');
  const purge = await import('/src/system/purge.js');
  const tick = () => new Promise(res => setTimeout(res, 50));
  const out = {};

  // ---- 一、外观预设 ----
  const w1 = await images.put(file());
  db.layout.set({ wallpaper: { ...(db.layout.get().wallpaper || {}), home: w1 } });
  const i1 = await look.setAppIconFile('chat', file());
  const preset = looks.save('预设甲');
  // 换壁纸：和设置页一样，先放新的、删旧的、再写上新 id
  const w2 = await images.put(file());
  images.remove(w1);
  db.layout.set({ wallpaper: { ...(db.layout.get().wallpaper || {}), home: w2 } });
  // 换图标
  const i2 = await look.setAppIconFile('chat', file());
  await tick();
  out.presetWallKept = images.has(w1);
  out.presetIconKept = images.has(i1);
  const applied = looks.apply(preset.id);
  out.applyMissing = applied.missing;
  out.wallBack = db.layout.get().wallpaper?.home === w1;
  out.iconBack = db.settings.get().appIcons?.chat?.imageId === i1;

  // ---- 二、头像池 ----
  const a1 = await images.put(file());
  const c = db.characters.create({ name: '阿岚', avatar: a1, avatarPool: [{ imageId: a1 }] });
  const a2 = await images.put(file());
  // 联系人页换头像：写上新的，删旧的
  db.characters.update(c.id, { avatar: a2 });
  images.remove(a1);
  await tick();
  out.poolKept = images.has(a1);

  // ---- 三、没人用的照删 ----
  const lone = await images.put(file());
  const gone = await images.remove(lone);
  out.loneGone = gone === true && !images.has(lone);
  // 换掉的旧壁纸 w2 此刻没人用了（套回了预设），删得掉
  images.remove(w2);
  await tick();
  out.oldWallGone = !images.has(w2);
  out.i2 = !!i2;

  // ---- 四、ins 挂件的照片 ----
  const cover = await images.put(file());
  const lay = structuredClone(db.layout.get());
  lay.pages[0].cells.push({ id: 'c-ins', kind: 'widget', ref: 'ins-polaroid', x: 0, y: 5, w: 2, h: 2, config: { cover } });
  db.layout.replace(lay);
  out.coverNotOrphan = !purge.orphanImageIds().includes(cover);
  images.remove(cover);
  await tick();
  out.coverKept = images.has(cover);
  return out;
}, PNG_B64);

ok('换壁纸后，存在预设里的旧壁纸还在', r.presetWallKept);
ok('换图标后，存在预设里的旧图标还在', r.presetIconKept);
ok('套回预设：没有缺图，壁纸和图标都回来了', r.applyMissing === 0 && r.wallBack && r.iconBack, JSON.stringify(r));
ok('换头像后，头像池里的那张还在', r.poolKept);
ok('没人用的图照删', r.loneGone);
ok('换下来且没人用的旧壁纸删掉了', r.oldWallGone);
ok('ins 挂件的照片不算无引用', r.coverNotOrphan);
ok('ins 挂件的照片不会被当成没人用删掉', r.coverKept);

// ---- 五、不认识的挂件 ----
await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  const lay = structuredClone(db.layout.get());
  lay.pages[0].cells.push({ id: 'c-future', kind: 'widget', ref: 'from-a-newer-build', x: 2, y: 5, w: 2, h: 2, config: { note: 'x' } });
  db.layout.replace(lay);
  const { flushWrites } = await import('/src/system/db/idb.js');
  await flushWrites();
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const kept = await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  (await import('/src/system/nav.js')).unlock();
  return db.layout.get().pages.some(p => p.cells.some(c => c.id === 'c-future'));
});
ok('重开之后，不认识的挂件还在主界面的数据里', kept);
await page.waitForTimeout(600);
ok('主界面上画成「挂件缺失」，页面不报错', /挂件缺失/.test(await page.locator('#app').innerText()));
await page.screenshot({ path: `${OUT}/imagekeep.png` });

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
