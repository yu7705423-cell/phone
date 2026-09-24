// 上传的图（图标、壁纸）在页面被藏起来再回来之后不能变白、不能消失。
//
// 图以 Blob 存库，画出来用的是 blob: 地址。两种情况会让这些地址失效：
//   一、页面被藏起来（pagehide）再回来（pageshow）。从前 pagehide 时把地址全部 revoke 了
//   二、iOS 在后台把 blob 背后的数据收走，地址还在缓存里，却已经读不出来
// 两种都要在回到前台后自己换上能用的地址。另外：一张图自己加载失败也会触发换新；
// 故意删掉的图不触发
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

// 换一个应用图标、设一张主屏壁纸
await page.evaluate(async b64 => {
  const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
  const file = new File([blob], 'x.png', { type: 'image/png' });
  const look = await import('/src/system/look.js');
  await look.setAppIconFile('chat', file);
  const { images } = await import('/src/system/db/images.js');
  const { db } = await import('/src/system/db/index.js');
  const wall = await images.put(file);
  db.layout.set({ wallpaper: { ...(db.layout.get().wallpaper || {}), home: wall } });
  const n = await import('/src/system/nav.js');
  n.unlock();
}, PNG_B64);
await page.waitForTimeout(1000);

// 屏幕上所有 blob: 地址，逐个读一遍：读不出来的列出来
const scan = () => page.evaluate(async () => {
  const found = new Set();
  document.querySelectorAll('img').forEach(i => { if (i.src.startsWith('blob:')) found.add(i.src); });
  document.querySelectorAll('[style]').forEach(el => {
    (el.getAttribute('style').match(/blob:[^)"'\s]+/g) || []).forEach(u => found.add(u));
  });
  const dead = [];
  for (const u of found) {
    try { await (await fetch(u)).arrayBuffer(); } catch { dead.push(u); }
  }
  return { total: found.size, dead: dead.length };
});
const epoch = () => page.evaluate(async () => { try { return (await import('/src/system/db/blobs.js')).blobEpoch(); } catch { return -1; } });
const settle = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await page.waitForTimeout(150); }
  return null;
};

let s = await scan();
ok('图标与壁纸都画出来了（至少两个 blob 地址）', s.total >= 2 && s.dead === 0, JSON.stringify(s));

// ---- 一、藏起来再回来 ----
await page.evaluate(() => {
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
});
await page.waitForTimeout(600);
s = await scan();
ok('藏起来再回来：屏幕上的地址全都读得出', s.total >= 2 && s.dead === 0, JSON.stringify(s));

// ---- 二、后台被收走：地址还在缓存里，读不出来了 ----
const e0 = await epoch();
await page.evaluate(() => {
  const all = new Set();
  document.querySelectorAll('img').forEach(i => { if (i.src.startsWith('blob:')) all.add(i.src); });
  document.querySelectorAll('[style]').forEach(el => (el.getAttribute('style').match(/blob:[^)"'\s]+/g) || []).forEach(u => all.add(u)));
  all.forEach(u => URL.revokeObjectURL(u));
});
s = await scan();
ok('（前提）模拟收走之后，屏幕上的地址确实读不出', s.dead > 0, JSON.stringify(s));
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
s = await settle(async () => { const v = await scan(); return v.total >= 2 && v.dead === 0 ? v : null; });
ok('回到前台：自动换上新地址，屏幕上的地址全都读得出', !!s, JSON.stringify(await scan()));
ok('地址整体换过一代', (await epoch()) === e0 + 1, `${e0} -> ${await epoch()}`);

// ---- 三、没有前后台切换，一张图自己加载失败 ----
// 自己的头像是 <img>（图标、壁纸、角色卡是背景图，没有加载失败事件），到联系人列表里去
await page.evaluate(async b64 => {
  const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
  const { images } = await import('/src/system/db/images.js');
  const { db } = await import('/src/system/db/index.js');
  const face = await images.put(new File([blob], 'f.png', { type: 'image/png' }));
  db.personas.all().forEach(p => db.personas.update(p.id, { avatar: face }));
  (await import('/src/system/nav.js')).openApp('contact', '/');
}, PNG_B64);
await page.waitForTimeout(1000);
const avatars = () => page.evaluate(() => [...document.querySelectorAll('img')].filter(i => i.src.startsWith('blob:'))
  .map(i => i.complete && i.naturalWidth > 0));
ok('（前提）联系人列表里有头像 img', (await avatars()).length >= 1, JSON.stringify(await avatars()));
// 加载失败触发的换新与上一次至少隔 10 秒（防止库里的数据本身坏了时转个不停），等过这一段
await page.waitForTimeout(10500);
const e1 = await epoch();
await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('img')].filter(i => i.src.startsWith('blob:'));
  imgs.forEach(i => URL.revokeObjectURL(i.src));
  // 重新加载一下：这时它会报加载失败
  imgs.forEach(i => { const u = i.src; i.src = ''; i.src = u; });
});
s = await settle(async () => { const v = await scan(); const a = await avatars();
  return v.dead === 0 && (await epoch()) > e1 && a.length && a.every(Boolean) ? v : null; });
ok('一张图加载失败：触发换新，恢复正常', !!s, JSON.stringify(await scan()) + ` epoch ${e1} -> ${await epoch()}`);

// ---- 四、故意删掉的图不触发整体换新 ----
const e2 = await epoch();
await page.evaluate(async () => (await import('/src/system/look.js')).clearAppIconImage('chat'));
await page.waitForTimeout(800);
ok('删掉图标的图：不触发整体换新', (await epoch()) === e2, `${e2} -> ${await epoch()}`);
s = await scan();
ok('其余的图照常', s.total >= 1 && s.dead === 0, JSON.stringify(s));
await page.screenshot({ path: `${OUT}/bloburls.png` });

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
