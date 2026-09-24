// 角色卡展示页（拍立得）与在会话里换头像（ARCHITECTURE 4.202）。
//
//   会话菜单「角色卡」进展示页：形象照做成拍立得，白边写名字与签名，人设一个字不露
//   形象照与聊天头像、锁脸照片分开存；登记在清理与角色包里
//   会话菜单里直接换角色的头像、自己的头像；换下来的那张留着（avatarBase），
//   而且登记在引用表里 —— 从前没登记，「清理无引用」会把它删掉
import { BASE, EXE, OUT, chromium } from './_env.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

// 在页面里画两张真的图
mkdirSync(OUT, { recursive: true });
const draw = color => page.evaluate(async c => {
  const cv = document.createElement('canvas'); cv.width = 80; cv.height = 100;
  const g = cv.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 80, 100);
  const b = new Uint8Array(await (await new Promise(r => cv.toBlob(r, 'image/png'))).arrayBuffer());
  let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s);
}, color);
writeFileSync(`${OUT}/card-a.png`, Buffer.from(await draw('#c96'), 'base64'));
writeFileSync(`${OUT}/card-b.png`, Buffer.from(await draw('#369'), 'base64'));

const ids = await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  const c = db.characters.create({ name: '阿岚', signature: '雨天不出门', persona: '人设正文不该出现在展示页' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/chat/${chat.id}`);
  return { char: c.id, chat: chat.id };
});
await page.waitForTimeout(800);
const charRow = () => page.evaluate(async id => (await import('/src/system/db/index.js')).db.characters.get(id), ids.char);
const has = id => page.evaluate(async i => (await import('/src/system/db/images.js')).images.has(i), id);
const used = id => page.evaluate(async i => (await import('/src/system/purge.js')).usedImageIds().has(i), id);

// ---- 会话菜单进展示页 ----
await page.locator('[aria-label="更多"]').click();
await page.waitForTimeout(400);
await page.locator('.fullsheet .list-item', { hasText: '角色卡' }).first().click();
await page.waitForTimeout(600);
const route = await page.evaluate(async () => (await import('/src/system/nav.js')).currentRoute());
ok('会话菜单「角色卡」进展示页', route === `/card/${ids.char}`, route);
let t = await page.locator('.app-layer').innerText();
ok('白边上写名字与签名', /阿岚/.test(t) && /雨天不出门/.test(t), t.slice(0, 200));
ok('展示页一个字人设都不露', !/人设正文/.test(t));
ok('还没有形象照：写着「上传形象照」', /上传形象照/.test(t));

// ---- 形象照 ----
await page.locator('.app-layer input[type=file][accept="image/*"]').first().setInputFiles(`${OUT}/card-a.png`);
await page.waitForTimeout(900);
let c = await charRow();
ok('上传之后存成形象照', !!c.portrait, JSON.stringify(c.portrait));
ok('形象照和聊天头像是两样', c.portrait !== c.avatar);
const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.pola-photo')).backgroundImage);
ok('拍立得的相纸上铺着这张图', /url\("blob:/.test(bg), bg.slice(0, 60));
ok('形象照登记在引用表里', await used(c.portrait));
ok('导出角色包时形象照跟着走', await page.evaluate(async ({ a, p }) =>
  (await import('/src/system/charpack.js')).collect(a).imgIds.includes(p), { a: ids.char, p: c.portrait }));
const first = c.portrait;
await page.locator('.app-layer input[type=file][accept="image/*"]').first().setInputFiles(`${OUT}/card-b.png`);
await page.waitForTimeout(900);
c = await charRow();
ok('再换一张：旧的那张删掉', c.portrait && c.portrait !== first && !(await has(first)));
await page.screenshot({ path: `${OUT}/charcard.png` });
await page.locator('.list-item', { hasText: '编辑资料' }).click();
await page.waitForTimeout(500);
ok('「编辑资料」进编辑页', (await page.evaluate(async () => (await import('/src/system/nav.js')).currentRoute())) === `/edit/${ids.char}`);

// ---- 会话里换头像 ----
await page.evaluate(async id => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('chat', `/chat/${id}`); }, ids.chat);
await page.waitForTimeout(800);
const oldAvatar = await page.evaluate(async id => {
  const { db } = await import('/src/system/db/index.js');
  const { images } = await import('/src/system/db/images.js');
  const blob = await (await fetch('data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==')).blob();
  const img = await images.put(new File([blob], 'a.gif', { type: 'image/gif' }));
  db.characters.update(id, { avatar: img });
  return img;
}, ids.char);
await page.locator('[aria-label="更多"]').click();
await page.waitForTimeout(400);
ok('会话菜单里有「更换角色的头像」「更换我的头像」',
  (await page.locator('.fullsheet .list-item', { hasText: '更换角色的头像' }).count()) === 1
  && (await page.locator('.fullsheet .list-item', { hasText: '更换我的头像' }).count()) === 1);
// 两个文件框在会话页上（菜单里那两行只是点它们）
const inputs = page.locator('.app-layer > .page input[type=file][accept="image/*"]');
const n = await inputs.count();
await inputs.nth(n - 2).setInputFiles(`${OUT}/card-a.png`);
await page.waitForTimeout(900);
c = await charRow();
ok('换了角色的头像', c.avatar && c.avatar !== oldAvatar, JSON.stringify({ a: c.avatar, old: oldAvatar }));
ok('换下来的那张留着（avatarBase），换得回去', c.avatarBase === oldAvatar && await has(oldAvatar));
ok('留着的那张登记在引用表里（清理无引用时不被删）', await used(oldAvatar));

await inputs.nth(n - 1).setInputFiles(`${OUT}/card-b.png`);
await page.waitForTimeout(900);
const me = await page.evaluate(async () => {
  const acc = await import('/src/system/accounts.js');
  return acc.current()?.avatar || '';
});
ok('换了我的头像', !!me, me);

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
