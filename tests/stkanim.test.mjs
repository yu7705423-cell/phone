// 表情包三件事（4.280）
//   一、动图原样存：gif / 动态 webp / apng 不过画布（过一遍只剩第一帧）；静态的照旧压成 webp
//   二、分组多了：分组条横着滚，名字不挤不溢出
//   三、转发：说这几句话的角色所在的会话不在可选列表里（它的小号那边、它在的群都不列）
import { BASE, EXE, PNG_B64, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);

const r = await ev(async b64 => {
  const { db, images } = await import('/src/system/db/index.js');
  const { idb } = await import('/src/system/db/idb.js');
  const { isAnimated } = await import('/src/system/db/images.js');
  const stk = await import('/src/system/stickers.js');
  const forward = await import('/src/system/forward.js');
  const acc = await import('/src/system/accounts.js');
  const out = {};
  // 一张 1×1、两帧的 gif，手工拼的
  const gif = new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
    0x00, 0x00, 0x00, 0xff, 0xff, 0xff,
    0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, 0x03, 0x01, 0x00, 0x00, 0x00,
    0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00,
    0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x4c, 0x01, 0x00,
    0x3b]);
  const gifFile = new File([gif], 'a.gif', { type: 'image/gif' });
  const png = await (await fetch(`data:image/png;base64,${b64}`)).blob();
  const pngFile = new File([png], 'p.png', { type: 'image/png' });
  out.animGif = await isAnimated(gifFile);
  out.animPng = await isAnimated(pngFile);
  // 类型丢了也认得出（远程取回来的 blob 常常没有 type）
  out.animGifNoType = await isAnimated(new Blob([gif]));
  const gid = await images.put(gifFile, 512);
  const grow = await idb.get('images', gid);
  out.gifKept = grow.blob.size === gif.length && /gif/.test(grow.blob.type) && grow.animated === true && grow.noThumb === true;
  const pid = await images.put(pngFile, 512);
  const prow = await idb.get('images', pid);
  out.pngCompressed = /webp|jpeg/.test(prow.blob.type) && !prow.animated;
  // 表情导入走同一条路
  const s = await stk.addFromBlob({ name: '摇头', keywords: ['摇头'], blob: gifFile, group: '动图' });
  const srow = await idb.get('images', s.imageId);
  out.stickerKept = srow.blob.size === gif.length;

  // 二、三十个分组
  for (let i = 1; i <= 30; i++) {
    await stk.addFromBlob({ name: `表情${i}`, keywords: [`k${i}`], blob: pngFile, group: `第${i}个分组名字比较长` });
  }

  // 三、转发目标
  const me = acc.roots()[0] || acc.createRoot({ name: '阿园' });
  const alt = acc.createAlt(me.id, { name: '小号' });
  const a = db.characters.create({ name: '阿岚' });
  const bch = db.characters.create({ name: '沈砚' });
  const ca = db.chats.create({ characterIds: [a.id], personaId: me.id, lastMessageAt: Date.now() });
  const caAlt = db.chats.create({ characterIds: [a.id], personaId: alt.id, lastMessageAt: Date.now() });
  const cb = db.chats.create({ characterIds: [bch.id], personaId: me.id, lastMessageAt: Date.now() });
  const grp = db.chats.create({ characterIds: [a.id, bch.id], personaId: me.id, lastMessageAt: Date.now() });
  const m1 = db.messages.create({ chatId: ca.id, role: 'char', authorId: a.id, kind: 'text', content: '明天下雨', status: 'done' });
  const m2 = db.messages.create({ chatId: ca.id, role: 'user', authorId: 'me', kind: 'text', content: '好', status: 'done' });
  const names = list => list.map(c => c.id).sort();
  // 老账号数据：小号那段可能没有 personaId，也要挡住
  const caOld = db.chats.create({ characterIds: [a.id], lastMessageAt: Date.now() });
  out.withChar = names(forward.targets(ca.id, me.id, [a.id, 'me']));
  out.onlyMine = names(forward.targets(ca.id, me.id, ['me']));
  out.expectWithChar = [cb.id].sort();
  out.expectOnlyMine = [cb.id, grp.id, caOld.id].sort();
  const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/chat/${ca.id}`);
  return { ...out, ca: ca.id, m1: m1.id, m2: m2.id };
}, PNG_B64);
ok('一、gif 认成动图，png 不是', r.animGif && !r.animPng && r.animGifNoType, JSON.stringify([r.animGif, r.animPng, r.animGifNoType]));
ok('一、动图原样存：字节数、类型都没变，标了 animated', r.gifKept);
ok('一、静态图照旧压', r.pngCompressed);
ok('一、表情导入走同一条路，动图不动', r.stickerKept);
ok('三、说这话的角色所在的会话都不列（小号那段、群、没 personaId 的老数据）', JSON.stringify(r.withChar) === JSON.stringify(r.expectWithChar), JSON.stringify([r.withChar, r.expectWithChar]));
ok('三、只转发自己说的：那个角色的群与老数据照列', JSON.stringify(r.onlyMine) === JSON.stringify(r.expectOnlyMine), JSON.stringify([r.onlyMine, r.expectOnlyMine]));

// 二、界面：分组条
await page.waitForTimeout(1000);
await page.locator('button[aria-label="表情"]').first().click();
await page.waitForTimeout(600);
const tabs = await ev(() => {
  const bar = document.querySelector('.stk-tabs');
  if (!bar) return null;
  // 最后一个是设置的小图标，不算名字
  const chips = [...bar.querySelectorAll('.chip')].filter(c => c.textContent.trim());
  return {
    n: chips.length, scrolls: bar.scrollWidth > bar.clientWidth + 5,
    squeezed: chips.filter(c => c.scrollWidth > c.clientWidth + 1).length,
    minW: Math.min(...chips.map(c => c.getBoundingClientRect().width)),
  };
});
ok('二、分组条列出了全部分组', tabs && tabs.n >= 31, JSON.stringify(tabs));
ok('二、分组多了横着滚，没有一个被挤得溢出', tabs && tabs.scrolls && tabs.squeezed === 0 && tabs.minW > 40, JSON.stringify(tabs));

// 三、界面：多选转发时的列表
await page.keyboard.press('Escape').catch(() => {});
await ev(async () => { const n = await import('/src/system/nav.js'); n.goHome(); });
await page.waitForTimeout(300);
await ev(async id => { const n = await import('/src/system/nav.js'); n.openApp('chat', `/chat/${id}`); }, r.ca);
await page.waitForTimeout(1000);
const first = page.locator('.msg').filter({ hasText: '明天下雨' }).first();
await first.dispatchEvent('contextmenu');
await page.waitForTimeout(400);
const multi = page.locator('.overlay .list-item, .menu-item, button', { hasText: '多选' }).first();
if (await multi.count()) {
  await multi.click(); await page.waitForTimeout(400);
  await page.locator('button', { hasText: '转发' }).first().click();
  await page.waitForTimeout(500);
  const sheet = await page.locator('.sheet').innerText().catch(() => '');
  ok('三、界面上转发列表里没有阿岚（只有沈砚那一段）', /沈砚/.test(sheet) && !/阿岚/.test(sheet), sheet.slice(0, 160));
} else {
  ok('三、找到了多选入口', false);
}

console.log(`\n${R.filter(x => x.pass).length}/${R.length} 通过`);
if (errs.length) console.log(errs.join('\n'));
await browser.close();
process.exit(R.every(x => x.pass) && !errs.length ? 0 : 1);
