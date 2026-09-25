// 引用放在哪儿：气泡上方 / 气泡下方 / 包在气泡里 / 不显示（ARCHITECTURE 4.208）。
//
// 四档都只靠 CSS：外面那一条 .ph-quote 在 DOM 里排在气泡后面、默认 order: -1 画到上面；
// 第一个文字气泡里另有一份 .ph-quote-in，默认不显示。生成器「引用」一组多了「显示在哪里」，
// 写给作者的类名清单里写明了这几种写法
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ids = await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  const skin = await import('/src/system/skin.js');
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  const t = Date.now() - 60000;
  const src = db.messages.create({ chatId: chat.id, role: 'char', authorId: c.id, kind: 'text', content: '明天去看海吗', status: 'done', createdAt: t });
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '去', status: 'done',
    quoteId: src.id, quoteText: src.content, createdAt: t + 1000 });
  const s = skin.create({ name: '引用', gen: {} });
  skin.attach(chat.id, s.id);
  return { chat: chat.id, skin: s.id };
});
await page.evaluate(async id => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/chat/${id}`); }, ids.chat);
await page.waitForTimeout(1000);

// 美化是进会话页时挂上去的，改完重进一次
const reopen = async () => {
  await page.evaluate(async id => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('chat', `/chat/${id}`); }, ids.chat);
  await page.waitForTimeout(800);
};
const setAt = async at => {
  await page.evaluate(async ({ id, at }) => {
    const skin = await import('/src/system/skin.js');
    skin.update(id, { gen: { quote: { at } } });
  }, { id: ids.skin, at });
  await reopen();
};
const geo = () => page.evaluate(() => {
  const row = [...document.querySelectorAll('.ph-msg-mine')].pop();
  const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); return b.width ? { t: b.top, b: b.bottom, l: b.left, r: b.right } : null; };
  return {
    out: r(row.querySelector('.ph-quote')),
    inn: r(row.querySelector('.ph-quote-in')),
    bub: r(row.querySelector('.ph-bubble')),
    text: row.querySelector('.ph-bubble')?.innerText || '',
  };
});

let g = await geo();
ok('默认：引用在气泡上方', g.out && g.bub && g.out.b <= g.bub.t + 1, JSON.stringify(g));
ok('默认：气泡里那一份不显示', !g.inn, JSON.stringify(g));
ok('DOM 里外面那一条排在气泡后面（CSS 才放得到下面）', await page.evaluate(() => {
  const col = [...document.querySelectorAll('.ph-msg-mine .ph-col')].pop();
  const kids = [...col.children];
  return kids.findIndex(k => k.classList.contains('ph-quote')) > kids.findIndex(k => k.classList.contains('ph-bubble'));
}));

await setAt('below');
g = await geo();
ok('「气泡下方」：引用挪到气泡下面', g.out && g.bub && g.out.t >= g.bub.b - 1, JSON.stringify(g));

await setAt('inside');
g = await geo();
ok('「包在气泡里」：外面那一条收起', !g.out, JSON.stringify(g));
ok('「包在气泡里」：气泡里那一份显示，在正文上面', g.inn && g.bub && g.inn.t >= g.bub.t && g.inn.b <= g.bub.b
  && /明天去看海吗/.test(g.text) && g.text.trim().endsWith('去'), JSON.stringify(g));

await setAt('none');
g = await geo();
ok('「不显示」：两份都不显示，只剩正文', !g.out && !g.inn && g.bub, JSON.stringify(g));

// 手写 CSS 也做得到 —— 同样的写法，不经过生成器
await page.evaluate(async id => {
  const skin = await import('/src/system/skin.js');
  skin.update(id, { gen: {}, css: '.ph-quote { order: 0 }' });
}, ids.skin);
await reopen();
g = await geo();
ok('手写 .ph-quote { order: 0 } 同样放到下面', g.out && g.bub && g.out.t >= g.bub.b - 1, JSON.stringify(g));

// 生成器与类名清单
const css = await page.evaluate(async () => {
  const gen = await import('/src/system/skin-gen.js');
  return { inside: gen.emit({ quote: { at: 'inside', bg: '#123456' } }), below: gen.emit({ quote: { at: 'below' } }) };
});
ok('生成器「包在气泡里」：颜色改的是里面那一份', /\.ph-quote-in \{[^}]*background: #123456/s.test(css.inside), css.inside);
ok('生成器「气泡下方」只写 order', /\.ph-quote \{\s*order: 0 !important;\s*\}/.test(css.below), css.below);
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('skin', '/contract'); });
await page.waitForTimeout(800);
const list = await page.locator('.app-layer').innerText();
ok('写给作者的类名清单里写明了换位置的写法', /order: 0/.test(list) && /\.ph-quote-in/.test(list) && /display: none/.test(list), list.slice(0, 400));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
