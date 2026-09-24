// ins 风小组件：拍立得、胶片、快拍、主页卡、九宫格、一句、在一起、天气。
// 各自读到对的数据；点跳转的那几个只跳转、不顺带弹出编辑面板；
// 整理模式里「编辑内容」按 fields 生成表单；挑小组件的列表按分组列出
import { BASE, OUT, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

// ---- 造数据：两个角色、头像、朋友圈照片、相册、聊天记录、今天的天气 ----
const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const album = await import('/src/system/album.js');
  const day = await import('/src/system/day.js');
  const svc = await import('/src/system/ai/services.js');
  // 一张纯色图。色相各不相同，截图上看得出是不同的照片
  const pic = async (hue, text) => {
    const c = document.createElement('canvas'); c.width = 240; c.height = 240;
    const g = c.getContext('2d');
    g.fillStyle = `hsl(${hue} 35% 62%)`; g.fillRect(0, 0, 240, 240);
    g.fillStyle = `hsl(${hue} 35% 40%)`; g.beginPath(); g.arc(120, 150, 70, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = '28px serif'; g.fillText(text, 20, 50);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    return db.images.put(new File([blob], `${text}.png`, { type: 'image/png' }), 480);
  };
  svc.setQweather({ host: 'qw.example.com', key: 'k' });
  const a = db.characters.create({ name: '林晚', persona: 'x', signature: '慢一点也没关系', dayOn: true, region: '成都', avatar: await pic(20, 'L') });
  const b = db.characters.create({ name: '阿岚', persona: 'y', avatar: await pic(200, 'A') });
  const chat = db.chats.create({ characterIds: [a.id], personaId: acc.current().id, lastMessageAt: Date.now() });
  db.messages.create({ chatId: chat.id, role: 'char', authorId: a.id, kind: 'text', content: '今天的风很温柔，适合慢慢走回家', status: 'done' });
  db.messages.create({ chatId: chat.id, role: 'char', authorId: a.id, kind: 'text', content: '嗯', status: 'done' });
  for (let i = 0; i < 5; i++) {
    db.moments.create({ authorId: i % 2 ? b.id : a.id, text: `动态${i}`, images: [await pic(i * 50, `M${i}`), await pic(i * 50 + 25, `N${i}`)], likes: [], comments: [] });
  }
  for (let i = 0; i < 4; i++) album.saveImage({ imageId: await pic(300 - i * 40, `P${i}`), from: { chatId: chat.id, charId: a.id, name: '林晚', at: Date.now() } });
  const date = day.dateKey(a);
  day.save(a.id, { date, items: [], weather: { city: '成都', date, textDay: '小雨', textNight: '阴', tempMin: 18, tempMax: 24, humidity: 80 } });
  const cover = await pic(35, 'Sun');
  return { a: a.id, b: b.id, chat: chat.id, cover };
});

// ---- 摆三页 ----
const pages = await page.evaluate(async o => {
  const db = await import('/src/system/db/index.js');
  const lay = structuredClone(db.layout.get());
  const w = (ref, x, y, ww, hh, config = {}) => ({ id: `c_${ref}_${x}_${y}_${Math.random().toString(36).slice(2, 6)}`, kind: 'widget', ref, x, y, w: ww, h: hh, config });
  lay.pages.push({ id: 'p_ins1', cells: [
    w('ins-stories', 0, 0, 4, 1),
    w('ins-profile', 0, 1, 4, 2, { charId: o.a }),
    w('ins-polaroid', 0, 3, 2, 3, { cover: o.cover, caption: 'a quiet sunday', tilt: 'l', at: new Date('2026-09-20T10:00:00').getTime() }),
    w('ins-days', 2, 3, 2, 2, { charId: o.a, since: '2026-01-01' }),
    w('ins-weather', 2, 5, 2, 1, { charId: o.a }),
  ] });
  lay.pages.push({ id: 'p_ins2', cells: [
    w('ins-film', 0, 0, 4, 1, { source: 'album' }),
    w('ins-quote', 0, 1, 4, 2, { charId: o.a }),
    w('ins-grid', 0, 3, 2, 2, { source: 'moments' }),
    w('ins-weather', 2, 3, 2, 2, { charId: o.a }),
    w('ins-film', 0, 5, 2, 1, { source: 'moments', label: 'PORTRA' }),
    w('ins-days', 2, 5, 2, 1 === 1 ? 1 : 1, {}),
  ].filter(c => !(c.ref === 'ins-days' && c.h === 1)) });
  lay.pages.push({ id: 'p_ins3', cells: [
    w('ins-grid', 0, 0, 4, 4, { source: 'album' }),
    w('ins-days', 0, 4, 4, 2, { charId: o.a, lang: 'zh' }),
  ] });
  lay.currentPage = lay.pages.length - 3;
  db.layout.replace(lay);
  return lay.pages.length;
}, ids);
const n = await import('node:fs');
const show = async (idx, theme, name) => {
  await page.evaluate(async ([i, t]) => {
    document.documentElement.dataset.theme = t;
    const nav = await import('/src/system/nav.js'); nav.unlock(); nav.goHome();
    (await import('/src/screens/home/layout.js')).setPage(i);
  }, [idx, theme]);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/ins-${name}-${theme}.png` });
};
const p1 = pages - 3;
await show(p1, 'light', 'p1');
const cellText = ref => page.locator(`[data-cell^="c_${ref}"]`).first().innerText();

// ---- 各自的数据 ----
let t = await cellText('ins-stories');
ok('快拍：「你的快拍」在前，角色的名字都在', /你的快拍/.test(t) && /林晚/.test(t) && /阿岚/.test(t), t);
const rings = await page.locator('[data-cell^="c_ins-stories"] .ins-round.is-new').count();
ok('快拍：二十四小时内发过动态的两个角色带一圈实线', rings === 2, rings);
t = await cellText('ins-profile');
ok('主页卡：名字、签名、动态数、照片数', /林晚/.test(t) && /慢一点也没关系/.test(t) && /\b3\b\s*posts/.test(t.replace(/\n/g, ' ')) && /\b4\b\s*photos/.test(t.replace(/\n/g, ' ')), t);
ok('主页卡不露人设（第 6 条）', !/\bx\b/.test(t.replace(/posts|photos|days/g, '')), t);
t = await cellText('ins-polaroid');
ok('拍立得：文字与照片那一天的日期', /a quiet sunday/.test(t) && /2026\.09\.20/.test(t), t);
t = await cellText('ins-days');
const expect = Math.floor((Date.now() - new Date('2026-01-01T00:00:00').getTime()) / 86400000) + 1;
ok('在一起：从设定的那天算起的天数', t.includes(String(expect)) && /since 2026\.01\.01/.test(t), `${t} 期望 ${expect}`);
t = await cellText('ins-weather');
ok('天气（2 x 1）：城市与气温', /成都/.test(t) && /18°/.test(t) && /24°/.test(t), t);
await show(p1, 'dark', 'p1');

await show(p1 + 1, 'light', 'p2');
const filmBg = await page.locator('[data-cell^="c_ins-film"]').first().locator('.ins-frame-img').evaluateAll(els => els.map(e => !!e.style.backgroundImage));
ok('胶片（相册）：四格都是照片', filmBg.length === 4 && filmBg.every(Boolean), JSON.stringify(filmBg));
t = await cellText('ins-quote');
ok('一句：摘的是角色说过的话，太短的「嗯」不摘', /今天的风很温柔/.test(t) && /— 林晚/.test(t), t);
const gridBg = await page.locator('[data-cell^="c_ins-grid"]').first().locator('.ins-tile').evaluateAll(els => els.filter(e => e.style.backgroundImage).length);
ok('九宫格（朋友圈）：九格都是照片', gridBg === 9, gridBg);
await show(p1 + 1, 'dark', 'p2');
await show(p1 + 2, 'light', 'p3');
t = await cellText('ins-days');
ok('在一起（中文、没设起点）：从这段对话开始那天算起', /在一起的第 1 天/.test(t) && /始于/.test(t), t);
await show(p1 + 2, 'dark', 'p3');
await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });

// ---- 点跳转的只跳转，不顺带弹编辑面板 ----
await show(p1, 'light', 'p1');
await page.locator('[data-cell^="c_ins-profile"] .ins-profile').click();
await page.waitForTimeout(700);
let where = await page.evaluate(async () => { const nv = await import('/src/system/nav.js'); return `${nv.nav.get().appId} ${nv.currentRoute()}`; });
ok('点主页卡：进角色主页', where === `chat /profile/${ids.a}`, where);
await page.evaluate(async () => (await import('/src/system/nav.js')).goHome());
await page.waitForTimeout(500);
ok('回到主屏：没有一张没人要的编辑表摆着', await page.locator('.sheet').count() === 0);

// ---- 整理模式：「编辑内容」按 fields 生成 ----
await page.evaluate(async () => (await import('/src/screens/home/editState.js')).setEdit(true));
await page.waitForTimeout(400);
await page.locator('[data-cell^="c_ins-days"]').first().click({ force: true });
await page.waitForTimeout(400);
await page.locator('.sheet .list-item', { hasText: '编辑内容' }).click();
await page.waitForTimeout(500);
t = await page.locator('.sheet').last().innerText();
ok('编辑内容：角色、从哪天算起、文字三项', /角色/.test(t) && /最近聊过的/.test(t) && /阿岚/.test(t) && /从哪天算起/.test(t) && /English/.test(t), t.slice(0, 300));
await page.locator('.sheet .chip', { hasText: '阿岚' }).click();
await page.locator('.sheet .seg-item', { hasText: '中文' }).click();
await page.waitForTimeout(300);
const cfg = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  return db.layout.get().pages.flatMap(p => p.cells).find(c => c.ref === 'ins-days' && c.x === 2 && c.y === 3).config;
});
ok('改了就存上', cfg.charId === ids.b && cfg.lang === 'zh', JSON.stringify(cfg));
await page.screenshot({ path: `${OUT}/ins-editor.png` });
await page.locator('.sheet .btn', { hasText: '完成' }).click();
await page.waitForTimeout(300);

// ---- 挑小组件：按分组列 ----
await page.locator('.cell-slot, [data-slot]').first().click().catch(() => {});
const picker = await page.evaluate(async () => {
  const reg = await import('/src/system/registry.js');
  return reg.listWidgets().filter(w => w.group === 'ins').map(w => w.id);
});
ok('ins 风一组共八个', picker.length === 8, JSON.stringify(picker));
await page.evaluate(async () => (await import('/src/screens/home/editState.js')).setEdit(false));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
