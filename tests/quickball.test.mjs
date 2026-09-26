// 悬浮球（ARCHITECTURE 4.256）
//
//   一、设置「悬浮球」里打开：出现，而且整个在屏幕里
//   二、丢不了：存的位置是坏值（不是数字、越界、大小离谱）、窗口缩小、横过来，球都完整地在屏幕里
//   三、拖到左边松手：贴左边；刷新后还在左边（用户要求：平常就是放的位置）
//   四、「恢复默认位置」：放回右边
//   五、点一下展开；聊天外看不到「当前对话」那组，聊天里看得到
//   六、世界书开关：列出书，开关改的是这个角色挂不挂这本书；展开能逐条开关
//   七、长按：选放哪些；深色模式一点就换；让角色接着说真的发出一次请求；切换主用接口
//   八、外观（用户要求：大小自己调、换自己的图可以溢出、进阶写 CSS）：
//       长按 - 外观里调大小；换一张透明底的图，按倍数画得比球大；最大、贴边、拖到左边时整张图都在屏幕里；
//       CSS 只作用于悬浮球（写 body 的碰不到别处，写 & 的整段不收）；设置 app 里不挂；
//       「恢复默认样式」清掉图与 CSS，图从库里删掉
//   九、球自己出错只自己消失，不拖垮外壳：设置读不出来时，应用的崩溃页照常出来；换个页面球又回来
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const reqs = [];
await ctx.route('**/relay.example.com/**', async route => {
  const body = JSON.parse(route.request().postData() || '{}');
  reqs.push(body);
  if (body.stream) {
    return route.fulfill({ status: 200, contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: '在呢' } }] })}\n\ndata: [DONE]\n\n` });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: '在呢' } }] }) });
});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);
const go = (app, route) => ev(async ([a, r]) => { const n = await import('/src/system/nav.js'); n.unlock(); n.goHome(); if (a) n.openApp(a, r); }, [app, route]);

// 球是不是整个在屏幕里、看得见
const seen = () => ev(() => {
  const b = document.querySelector('.qb-ball');
  const root = document.querySelector('.root');
  if (!b || !root) return { ok: false, why: 'none' };
  const r = b.getBoundingClientRect();
  const o = root.getBoundingClientRect();
  const st = getComputedStyle(b);
  const inside = r.left >= o.left - 0.5 && r.top >= o.top - 0.5 && r.right <= o.right + 0.5 && r.bottom <= o.bottom + 0.5;
  return { ok: inside && r.width > 20 && st.visibility !== 'hidden' && st.display !== 'none',
    r: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], o: [Math.round(o.right), Math.round(o.bottom)] };
});

const ids = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const a = svc.newChatPreset({ name: '甲', provider: 'openai' });
  svc.updateChatPreset(a.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm1' });
  const b = svc.newChatPreset({ name: '乙', provider: 'openai' });
  svc.updateChatPreset(b.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm2' });
  svc.setActiveChat(a.id);
  const book = db.lorebooks.create({ name: '雨城设定', global: false, entries: [
    { id: 'e1', comment: '雨城', keys: ['雨'], content: '常年下雨。', enabled: true, constant: false, priority: 100, order: 0, part: 'before', depth: 0, probability: 100 }] });
  const c = db.characters.create({ name: '阿岚', lorebookIds: [] });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '在吗', status: 'done' });
  return { char: c.id, chat: chat.id, book: book.id, a: a.id, b: b.id };
});

// 一
await go('settings', '/ball');
await page.waitForTimeout(600);
await page.locator('.list-item, [class*="list-item"]', { hasText: '显示悬浮球' }).locator('.switch, [role="switch"], input[type="checkbox"]').first().click();
await page.waitForTimeout(500);
let v = await seen();
ok('一、设置里打开：球出现，整个在屏幕里', v.ok, JSON.stringify(v));

// 二
for (const [label, bad] of [
  ['位置不是数字', { on: true, side: '??', y: 'abc', size: 48 }],
  ['比例越界', { on: true, side: 'right', y: 99, size: 48 }],
  ['比例为负', { on: true, side: 'left', y: -5, size: 48 }],
  ['大小离谱', { on: true, side: 'right', y: 1, size: 9999 }],
  ['整份是坏的', 'garbage'],
]) {
  await ev(async q => { const { db } = await import('/src/system/db/index.js'); db.settings.set({ quickBall: q }); }, bad);
  if (bad === 'garbage') await ev(async () => { const { db } = await import('/src/system/db/index.js'); db.settings.set({ quickBall: { ...db.settings.get().quickBall, on: true } }); });
  await page.waitForTimeout(300);
  v = await seen();
  ok(`二、存的是坏值（${label}）：球仍完整在屏幕里`, v.ok, JSON.stringify(v));
}
await ev(async () => { const { db } = await import('/src/system/db/index.js'); db.settings.set({ quickBall: { on: true, side: 'right', y: 1, size: 48 } }); });
await page.setViewportSize({ width: 320, height: 480 });
await page.waitForTimeout(500);
v = await seen();
ok('二、贴在最底下时窗口缩小：跟着移回屏幕里', v.ok, JSON.stringify(v));
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(500);
v = await seen();
ok('二、横过来：仍在屏幕里', v.ok, JSON.stringify(v));
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);

// 三
const box = await page.locator('.qb-ball').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(60, 300, { steps: 8 });
await page.mouse.move(40, 320, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(500);
const after = await ev(async () => (await import('/src/system/quickball.js')).cfg());
v = await seen();
ok('三、拖到左边松手：贴左边，整个在屏幕里', after.side === 'left' && v.ok && v.r[0] < 40, JSON.stringify({ after, v }));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await go('', '');
await page.waitForTimeout(500);
v = await seen();
const kept = await ev(async () => (await import('/src/system/quickball.js')).cfg());
ok('三、刷新之后：还在左边（位置记着）', kept.side === 'left' && v.ok && v.r[0] < 40, JSON.stringify({ kept, v }));

// 四
await go('settings', '/ball');
await page.waitForTimeout(600);
await page.locator('button', { hasText: '恢复默认位置' }).click();
await page.waitForTimeout(500);
v = await seen();
ok('四、恢复默认位置：放回右边', v.ok && v.r[2] > 330, JSON.stringify(v));

// 五
const openPanel = async () => { await page.locator('.qb-ball').click(); await page.waitForTimeout(400); };
await go('', '');
await page.waitForTimeout(400);
await openPanel();
let labels = await page.locator('.qb-item .qb-label').allInnerTexts();
ok('五、聊天外：展开后没有「当前对话」那组', labels.length > 0 && !labels.includes('世界书开关') && labels.includes('切换模型与接口'), JSON.stringify(labels));
await page.locator('.qb-scrim').click({ position: { x: 10, y: 10 } });
await go('chat', `/chat/${ids.chat}`);
await page.waitForTimeout(1200);
await openPanel();
labels = await page.locator('.qb-item .qb-label').allInnerTexts();
ok('五、聊天里：有世界书开关、让角色接着说、重新生成', ['世界书开关', '让角色接着说', '重新生成上一轮'].every(x => labels.includes(x)), JSON.stringify(labels));

// 六
await page.locator('.qb-item', { hasText: '世界书开关' }).click();
await page.waitForTimeout(400);
const bookRow = page.locator('.qb-book', { hasText: '雨城设定' });
await bookRow.locator('.switch, [role="switch"], input[type="checkbox"]').first().click();
await page.waitForTimeout(300);
let char = await ev(async o => (await import('/src/system/db/index.js')).db.characters.get(o.char), ids);
ok('六、打开「雨城设定」：这个角色挂上了这本书', (char.lorebookIds || []).includes(ids.book), JSON.stringify(char.lorebookIds));
await bookRow.locator('.qb-book-name').click();
await page.waitForTimeout(300);
await bookRow.locator('.qb-entry', { hasText: '雨城' }).locator('.switch, [role="switch"], input[type="checkbox"]').first().click();
await page.waitForTimeout(300);
const entry = await ev(async o => (await import('/src/system/db/index.js')).db.lorebooks.get(o.book).entries[0].enabled, ids);
ok('六、展开后逐条开关：条目停用', entry === false, String(entry));
await bookRow.locator('.qb-book-row .switch, .qb-book-row [role="switch"], .qb-book-row input[type="checkbox"]').first().click();
await page.waitForTimeout(300);
char = await ev(async o => (await import('/src/system/db/index.js')).db.characters.get(o.char), ids);
ok('六、再关掉：取消挂载', !(char.lorebookIds || []).includes(ids.book), JSON.stringify(char.lorebookIds));

// 七
await page.locator('.qb-head-btn[aria-label="返回"]').click();
await page.waitForTimeout(300);
await page.locator('.qb-head-btn', { hasText: '编辑' }).click();
await page.waitForTimeout(300);
await page.locator('.qb-panel button.chip', { hasText: /^心声$/ }).click();
await page.waitForTimeout(200);
let items = (await ev(async () => (await import('/src/system/quickball.js')).cfg())).items;
ok('七、编辑：勾选「心声」放进悬浮球', items.includes('inner'), JSON.stringify(items));
await page.locator('.qb-scrim').click({ position: { x: 10, y: 10 } });
await page.waitForTimeout(300);
// 长按也进编辑
const bb = await page.locator('.qb-ball').boundingBox();
await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
await page.mouse.down();
await page.waitForTimeout(800);
await page.mouse.up();
await page.waitForTimeout(300);
ok('七、长按悬浮球：进入选择放入的项目', /选择放入的项目/.test(await page.locator('.qb-panel').innerText().catch(() => '')));
await page.locator('.qb-head-btn[aria-label="返回"]').click();
await page.waitForTimeout(300);
await page.locator('.qb-item', { hasText: '深色模式' }).click();
await page.waitForTimeout(300);
const theme = await ev(async () => (await import('/src/system/db/index.js')).db.settings.get().theme);
ok('七、深色模式一点就换', theme === 'dark', theme);
const before = reqs.length;
await page.locator('.qb-item', { hasText: '让角色接着说' }).click();
await page.waitForTimeout(2500);
ok('七、让角色接着说：发出一次请求', reqs.length === before + 1, `${before} -> ${reqs.length}`);
await openPanel();
await page.locator('.qb-item', { hasText: '切换模型与接口' }).click();
await page.waitForTimeout(300);
await page.locator('.qb-pick', { hasText: '乙' }).click();
await page.waitForTimeout(300);
const active = await ev(async () => (await import('/src/system/ai/services.js')).services().chat.activeId);
ok('七、切换主用接口', active === ids.b, active);

// 八
// 图（含溢出那一圈）是不是整个在屏幕里
const imgSeen = () => ev(() => {
  const b = document.querySelector('.qb-img');
  const root = document.querySelector('.root');
  if (!b) return { ok: false, why: 'no img' };
  const r = b.getBoundingClientRect();
  const o = root.getBoundingClientRect();
  const ball = document.querySelector('.qb-ball').getBoundingClientRect();
  return { ok: r.left >= o.left - 0.5 && r.top >= o.top - 0.5 && r.right <= o.right + 0.5 && r.bottom <= o.bottom + 0.5,
    w: Math.round(r.width), ball: Math.round(ball.width), r: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] };
});
if (await page.locator('.qb-scrim').count()) await page.locator('.qb-head-btn[aria-label="关闭"]').click();
await go('', '');
await page.waitForTimeout(400);
const bb2 = await page.locator('.qb-ball').boundingBox();
await page.mouse.move(bb2.x + bb2.width / 2, bb2.y + bb2.height / 2);
await page.mouse.down();
await page.waitForTimeout(800);
await page.mouse.up();
await page.waitForTimeout(300);
await page.locator('.qb-panel .seg-item', { hasText: '外观' }).click();
await page.waitForTimeout(900);
const pv = await ev(() => ({ cls: document.querySelector('.qb-ball').className, op: getComputedStyle(document.querySelector('.qb-ball')).opacity }));
ok('八、长按 - 外观：面板标题是悬浮球外观，球留在屏幕上当场可见',
  /悬浮球外观/.test(await page.locator('.qb-panel').innerText()) && /is-preview/.test(pv.cls) && !/is-open/.test(pv.cls) && pv.op === '1', JSON.stringify(pv));
await page.locator('.qb-range', { hasText: '大小' }).locator('input').fill('100');
await page.waitForTimeout(300);
let look = await ev(async () => (await import('/src/system/quickball.js')).cfg());
const w100 = await ev(() => Math.round(document.querySelector('.qb-ball').getBoundingClientRect().width));
ok('八、外观里调大小：100px，球跟着变大', look.size === 100 && w100 === 100, JSON.stringify({ size: look.size, w100 }));
// 一张透明底的 png：四周留一圈透明，中间一块实心
const png = Buffer.from(await ev(() => {
  const c = document.createElement('canvas'); c.width = 200; c.height = 200;
  const x = c.getContext('2d'); x.fillStyle = '#e33'; x.fillRect(40, 40, 120, 120);
  return c.toDataURL('image/png').split(',')[1];
}), 'base64');
await page.locator('.qb-panel input[type="file"]').setInputFiles({ name: 'ball.png', mimeType: 'image/png', buffer: png });
await page.waitForTimeout(1200);
look = await ev(async () => (await import('/src/system/quickball.js')).cfg());
const imgId = look.img;
let face = await ev(() => {
  const b = document.querySelector('.qb-ball');
  return { cls: b.className, bg: getComputedStyle(b).backgroundColor, core: !!b.querySelector('.qb-core'),
    img: getComputedStyle(b.querySelector('.qb-img') || b).backgroundImage };
});
ok('八、换图：球换成图片，没有底板与圆点', !!imgId && /has-img/.test(face.cls) && face.bg === 'rgba(0, 0, 0, 0)' && !face.core && /blob:/.test(face.img), JSON.stringify(face));
// 用着的图不能被「清理无引用」删掉（CLAUDE.md 第 20 条）
const keep = await ev(async id => {
  const { orphanImageIds } = await import('/src/system/purge.js');
  const { images } = await import('/src/system/db/index.js');
  const removed = await images.remove(id);
  return { orphan: orphanImageIds().includes(id), removed, still: images.ids().includes(id) };
}, imgId);
ok('八、换上的图算作有引用：不在无引用清单里，images.remove 不删它', !keep.orphan && keep.removed === false && keep.still, JSON.stringify(keep));
await page.locator('.qb-range', { hasText: '图片大小' }).locator('input').fill('3');
await page.waitForTimeout(300);
await page.locator('.qb-range', { hasText: '大小' }).first().locator('input').fill('120');
await page.waitForTimeout(400);
let iv = await imgSeen();
ok('八、溢出：图是球的 3 倍大（120 x 3），整张仍在屏幕里', iv.ok && iv.w === 360 && iv.ball === 120, JSON.stringify(iv));
await page.locator('.qb-scrim').click({ position: { x: 5, y: 5 } }).catch(() => {});
await page.waitForTimeout(300);
if (await page.locator('.qb-scrim').count()) await page.locator('.qb-head-btn[aria-label="关闭"]').click();
await page.waitForTimeout(300);
// 贴在最底下、缩小窗口、拖到左边，整张图都在屏幕里
await ev(async () => (await import('/src/system/quickball.js')).setCfg({ y: 1, scale: 2, size: 80 }));
await page.waitForTimeout(300);
iv = await imgSeen();
ok('八、溢出的图贴在最底下：整张在屏幕里', iv.ok, JSON.stringify(iv));
await page.setViewportSize({ width: 320, height: 480 });
await page.waitForTimeout(500);
iv = await imgSeen();
ok('八、窗口缩小：溢出的图仍整张在屏幕里', iv.ok, JSON.stringify(iv));
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
const bb3 = await page.locator('.qb-ball').boundingBox();
await page.mouse.move(bb3.x + bb3.width / 2, bb3.y + bb3.height / 2);
await page.mouse.down();
await page.mouse.move(100, 400, { steps: 8 });
await page.mouse.move(0, 400, { steps: 4 });
iv = await imgSeen();
ok('八、拖动中往外拖：溢出的图也拖不出屏幕', iv.ok, JSON.stringify(iv));
await page.mouse.up();
await page.waitForTimeout(500);
iv = await imgSeen();
look = await ev(async () => (await import('/src/system/quickball.js')).cfg());
ok('八、松手贴左边：整张图在屏幕里', look.side === 'left' && iv.ok && iv.r[0] <= 12, JSON.stringify({ side: look.side, iv }));
// 点图溢出的那一圈也能展开
await page.mouse.click(iv.r[0] + 4, (iv.r[1] + iv.r[3]) / 2);
await page.waitForTimeout(400);
ok('八、点图超出球的部分：同样展开面板', await page.locator('.qb-panel').count() === 1);
await page.locator('.qb-head-btn', { hasText: '编辑' }).click();
await page.waitForTimeout(200);
await page.locator('.qb-panel .seg-item', { hasText: '外观' }).click();
await page.waitForTimeout(200);
// CSS：改得到球，改不到别处；写 & 的不收
await page.locator('.qb-panel textarea').fill('.qb-ball { outline: 3px solid rgb(255, 0, 0); }\nbody { display: none; }\n.root { opacity: 0; }\n& ~ * { display: none; }\n@keyframes qbspin { to { transform: rotate(1turn); } }\n.qb-label { letter-spacing: 3px; }');
await page.locator('.qb-panel .chip', { hasText: '应用' }).click();
await page.waitForTimeout(400);
const css = await ev(() => ({
  outline: getComputedStyle(document.querySelector('.qb-ball')).outlineColor,
  body: getComputedStyle(document.body).display,
  root: getComputedStyle(document.querySelector('.root')).opacity,
  hidden: [...document.querySelectorAll('.root > *')].filter(e => !e.classList.contains('qb-layer') && getComputedStyle(e).display === 'none').map(e => e.className),
  text: document.getElementById('qb-user-css')?.textContent || '',
}));
ok('八、自定义 CSS：作用于悬浮球', css.outline === 'rgb(255, 0, 0)', JSON.stringify(css));
ok('八、自定义 CSS：写 body、.root、& 的碰不到别处', css.body !== 'none' && css.root === '1' && !css.hidden.length && !/&/.test(css.text), JSON.stringify(css));
ok('八、自定义 CSS：@keyframes 留在最外层', /^@keyframes qbspin/m.test(css.text), css.text);
await page.locator('.qb-head-btn[aria-label="关闭"]').click();
await page.waitForTimeout(300);
// 设置 app 里不挂；「恢复默认样式」清掉图与 CSS
await go('settings', '/ball');
await page.waitForTimeout(600);
const inSet = await ev(() => ({ tag: !!document.getElementById('qb-user-css'), outline: getComputedStyle(document.querySelector('.qb-ball')).outlineStyle }));
ok('八、设置 app 里：自定义 CSS 不生效', !inSet.tag && inSet.outline === 'none', JSON.stringify(inSet));
await page.locator('button', { hasText: '恢复默认样式' }).click();
await page.waitForTimeout(400);
await page.locator('.modal .modal-btn-primary').click();
await page.waitForTimeout(500);
look = await ev(async () => (await import('/src/system/quickball.js')).cfg());
await page.waitForTimeout(300);
const gone = await ev(async id => !(await import('/src/system/db/index.js')).images.ids().includes(id), imgId);
ok('八、恢复默认样式：图、CSS、大小恢复默认，位置与项目不变',
  !look.img && !look.css && look.size === 56 && look.side === 'left' && look.items.includes('inner'), JSON.stringify(look));
ok('八、恢复默认样式：换上的图从库里删掉', gone);
v = await seen();
ok('八、恢复后：球照常在屏幕里', v.ok && !(await page.locator('.qb-img').count()), JSON.stringify(v));

// 九
await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const real = db.settings.get;
  db.settings.get = () => { throw new Error('模拟：旧代码里没有这个函数'); };
  window.__restore = () => { db.settings.get = real; };
  const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('settings', '/');
});
await page.waitForTimeout(800);
const crashed = await ev(() => ({ crash: document.querySelectorAll('.crash').length, ball: document.querySelectorAll('.qb-ball').length, root: document.querySelectorAll('.root').length }));
ok('九、设置读不出来：应用自己的崩溃页出来了，外壳还在，球自己藏起来', crashed.crash === 1 && crashed.root === 1 && crashed.ball === 0, JSON.stringify(crashed));
await ev(() => window.__restore());
await go('', '');
await page.waitForTimeout(600);
v = await seen();
ok('九、好了之后换个页面：球回来了', v.ok, JSON.stringify(v));

ok('没有页面错误', !errs.length, errs.join('\n'));
await browser.close();
const fail = R.filter(x => !x.pass).length;
console.log(`\n${R.length - fail}/${R.length} 项通过`);
process.exit(fail ? 1 : 0);
