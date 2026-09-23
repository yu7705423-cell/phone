// 两张脸：原本的与对话里在用的；以及浏览器分得清「跨域」和「连不上」。
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
// 「服务器活着但不给跨域」＝ no-cors 发得出去、带 cors 的读不到
await page.route('**/*', async route => {
  const u = route.request().url();
  if (u.startsWith(BASE)) return route.continue();
  if (/alive/.test(u)) {
    return route.request().method() === 'GET' && !route.request().headers().authorization
      ? route.fulfill({ status: 200, body: 'ok' })     // no-cors 探针放过
      : route.abort('failed');                          // 真请求当作被跨域拦下
  }
  return route.abort('failed');                         // 彻底连不上
});
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ok = [], fail = [];
const check = (c, m) => (c ? ok : fail).push(m);

// ---- 1 浏览器里分得清两种失败 ----
const diag = await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  const voice = await import('/src/system/ai/voice.js');
  svc.setVoice({ enabled: true, kind: 'minimax', apiKey: 'k', model: 'm',
    baseUrl: 'https://alive.example' });
  const blocked = await voice.testVoice();
  svc.setVoice({ baseUrl: 'https://dead.example' });
  const dead = await voice.testVoice();
  return { blocked, dead };
});
check(diag.blocked.step === '被跨域拦下', `服务器活着就说是跨域（${diag.blocked.step}）`);
check(/改不了/.test(diag.blocked.hint) && /中转/.test(diag.blocked.hint),
  `并且说清楚这条我们改不了（${diag.blocked.hint.slice(0, 30)}）`);
check(diag.dead.step === '没连上', `联系不上就说没连上（${diag.dead.step}）`);
check(/域名是否可解析/.test(diag.dead.hint), `指向该查的地方（${diag.dead.hint.slice(0, 24)}）`);

// ---- 2 角色换头像，原本那张留得住 ----
const face = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const av = await import('/src/system/avatar.js');
  const png = async hue => {
    const cv = document.createElement('canvas'); cv.width = 40; cv.height = 40;
    const g = cv.getContext('2d'); g.fillStyle = `hsl(${hue},70%,50%)`; g.fillRect(0, 0, 40, 40);
    const b = await new Promise(r => cv.toBlob(r, 'image/png'));
    return db.images.put(new File([b], 'a.png', { type: 'image/png' }), 256);
  };
  const first = await png(10);
  const other = await png(200);
  const c = db.characters.create({ name: '阿岚', avatar: first,
    avatarPool: [{ imageId: other, name: '短发' }] });

  const before = av.facesOf(db.characters.get(c.id));
  av.wear(c.id, '短发');
  const after = av.facesOf(db.characters.get(c.id));
  const kept = await db.images.blob(first);      // 原本那张还在库里
  av.restoreFace(c.id);
  const back = av.facesOf(db.characters.get(c.id));
  return {
    beforeSame: before.now === before.base && !before.changed,
    changed: after.changed, nowIsOther: after.now === other, baseIsFirst: after.base === first,
    keptInDb: !!kept,
    restored: back.now === first && !back.changed,
  };
});
check(face.beforeSame, '没换过时，两张就是同一张');
check(face.changed && face.nowIsOther && face.baseIsFirst,
  `换过之后两张分得开（现在=新的，原本=旧的：${JSON.stringify([face.nowIsOther, face.baseIsFirst])}）`);
check(face.keptInDb, '原本那张还留在库里，没被顺手删掉');
check(face.restored, '换得回去，换回之后又是同一张');

// ---- 3 我自己换头像也留得住原来那张 ----
await page.evaluate(async () => {
  const nav = await import('/src/system/nav.js');
  const acc = await import('/src/system/accounts.js');
  acc.roots()[0] || acc.createRoot({ name: '我' });
  nav.goHome(); nav.openApp('chat', '/profile/me');
});
await page.waitForTimeout(800);
const mine = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const av = await import('/src/system/avatar.js');
  const png = async hue => {
    const cv = document.createElement('canvas'); cv.width = 40; cv.height = 40;
    const g = cv.getContext('2d'); g.fillStyle = `hsl(${hue},70%,50%)`; g.fillRect(0, 0, 40, 40);
    const b = await new Promise(r => cv.toBlob(r, 'image/png'));
    return db.images.put(new File([b], 'a.png', { type: 'image/png' }), 256);
  };
  const me = acc.current();
  const one = await png(40);
  db.personas.update(me.id, { avatar: one });
  // 模拟在主页上换一张：新的进来，旧的记成原本
  const two = await png(300);
  const cur = db.personas.get(me.id);
  db.personas.update(me.id, { avatar: two, avatarBase: cur.avatarBase || cur.avatar });
  const f = av.facesOf(db.personas.get(me.id));
  return { changed: f.changed, base: f.base === one, now: f.now === two, oldKept: !!(await db.images.blob(one)) };
});
check(mine.changed && mine.base && mine.now, `我这边也分得开两张（${JSON.stringify(mine)}）`);
check(mine.oldKept, '我原来那张也留着');

await page.evaluate(async () => {
  const nav = await import('/src/system/nav.js');
  nav.goHome(); nav.openApp('chat', '/profile/me');
});
await page.waitForTimeout(900);
// 角标上没有文字了，它贴在头像右下角（见 ARCHITECTURE 4.149），所以查元素不查文案
const badge = await page.evaluate(() => {
  const b = document.querySelector('.ig-face .ig-face-base');
  return { has: !!b, label: b?.getAttribute('aria-label') || '',
    img: !!b?.querySelector('.avatar'), inActs: !!document.querySelector('.ig-acts .ig-face-base') };
});
check(badge.has && badge.img && badge.label === '换回原本的头像' && !badge.inActs,
  `主页上把原本那张摆出来了，且它贴在头像上（${JSON.stringify(badge)}）`);
console.log('  ..   主体：', await page.evaluate(async () => {
  const acc = await import('/src/system/accounts.js');
  const db = await import('/src/system/db/index.js');
  const av = await import('/src/system/avatar.js');
  const cur = acc.current();
  return JSON.stringify({ id: cur?.id, base: cur?.avatarBase || '', now: cur?.avatar || '',
    faces: av.facesOf(cur), personaRow: !!db.personas.get(cur?.id) });
}));

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 3).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
