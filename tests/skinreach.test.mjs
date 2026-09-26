// 美化契约：作者写单个契约钩子 { ... } 就要盖得住（ARCHITECTURE 4.257）
//
// 用户反馈：「图标换不动，一直在原地」「按钮颜色不能改，像整个按钮被固定了」。
// 原因是应用自己带状态的规则（.send-btn.is-ghost、.tab.is-active、.app-tile.has-image、
// :root[data-wallpaper="on"] .app-tile ……）是两个以上类名，
// 比作者写的单个钩子更特异，于是「写了没反应」。现在这些规则一律 :where() 压回 (0,1,0)。
//
//   一、发送键：输入框为空（「让对方回复」那个样子）时底色与颜色改得动
//   二、底部标签栏：选中的那个标签颜色改得动
//   三、主屏图标：换过图片、开着壁纸的图标，背景图与底色改得动；能挪
//   四、会话：我发的那一条能挪到左边，气泡底色改得动，列表最后一行的分隔线改得动，顶栏高度改得动
//   五、其余能自己写 CSS 的地方同一条规矩：
//       悬浮球（长按 - 外观 - 自定义 CSS）：换了图还保留底板时底色改得动，面板上开着的项的图标底色改得动
//       外观 - 自定义 CSS：播放器挂件靠右排时方向改得动，衬线字时 .pl-line 字体改得动
//       线下的自定义 CSS：我那一侧的气泡底色、固定比例的卡片比例改得动
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
const cs = (sel, prop) => ev(([s, p]) => { const el = document.querySelector(s); return el ? getComputedStyle(el).getPropertyValue(p) : 'MISSING'; }, [sel, prop]);

const IMG = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Crect width='10' height='10' fill='%23ff00ff'/%3E%3C/svg%3E\")";
const CSS = `
.ph-send { background: rgb(255, 0, 0); color: rgb(0, 255, 0); }
.ph-tab-on { color: rgb(255, 0, 0); }
.ph-tile { background-image: ${IMG}; background-color: rgb(255, 0, 0); transform: translate(30px, 30px); }
.ph-msg-mine { flex-direction: row; }
.ph-col { align-items: flex-start; }
.ph-bubble-mine { background-color: rgb(0, 0, 255); color: rgb(255, 255, 0); }
.ph-list-item { border-bottom: 3px solid rgb(255, 0, 0); }
.ph-chat-body { padding-top: 77px; }
.ph-navbar { height: 99px; }
.ph-back { color: rgb(255, 0, 255); }
`;
const ids = await ev(async ({ css, b64 }) => {
  const { db, images } = await import('/src/system/db/index.js');
  const skin = await import('/src/system/skin.js');
  const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
  const icon = await images.putIcon(new File([blob], 'i.png', { type: 'image/png' }));
  const wall = await images.put(new File([blob], 'w.png', { type: 'image/png' }));
  db.settings.set({ appIcons: { chat: { imageId: icon } } });
  db.layout.set({ wallpaper: { home: wall } });
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], title: '阿岚', lastMessageAt: Date.now() });
  db.messages.create({ chatId: chat.id, role: 'char', authorId: c.id, kind: 'text', content: '在', status: 'done' });
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '你好', status: 'done' });
  const s = skin.create({ name: '探针', scope: ['chat', 'shell'], css });
  skin.attach(chat.id, s.id);
  db.settings.set({ globalSkinId: s.id });
  const n = await import('/src/system/nav.js'); n.unlock(); n.goHome();
  return { chat: chat.id };
}, { css: CSS, b64: PNG_B64 });
await page.waitForTimeout(1500);

// 三
const tileSel = '.ph-tile.has-image';
ok('三、换过图片的主屏图标：确实带着 has-image', await cs(tileSel, 'display') !== 'MISSING');
ok('三、换过图片的主屏图标：背景图换得动', /ff00ff/.test(await cs(tileSel, 'background-image')), await cs(tileSel, 'background-image'));
ok('三、开着壁纸时图标底色改得动', await cs(tileSel, 'background-color') === 'rgb(255, 0, 0)', await cs(tileSel, 'background-color'));
ok('三、图标挪得动', /30, 30\)$/.test(await cs(tileSel, 'transform')), await cs(tileSel, 'transform'));

// 二、四（列表页）
await ev(async () => { const n = await import('/src/system/nav.js'); n.openApp('chat', '/'); });
await page.waitForTimeout(800);
ok('二、选中的标签颜色改得动', await cs('.ph-tab-on', 'color') === 'rgb(255, 0, 0)', await cs('.ph-tab-on', 'color'));
ok('四、顶栏高度改得动', await cs('.ph-navbar', 'height') === '99px', await cs('.ph-navbar', 'height'));
// 找一页有列表的（设置 app 不上美化，不能拿它试）
for (const r of ['/caps', '/me', '/contacts']) {
  await ev(async r => { const n = await import('/src/system/nav.js'); n.openApp('chat', r); }, r);
  await page.waitForTimeout(700);
  if (await cs('.ph-list-item:last-child', 'display') !== 'MISSING') break;
}
ok('四、列表最后一行的分隔线改得动', await cs('.ph-list-item:last-child', 'border-bottom-width') === '3px', await cs('.ph-list-item:last-child', 'border-bottom-width'));

// 一、四（会话页）
await ev(async id => { const n = await import('/src/system/nav.js'); n.openApp('chat', `/chat/${id}`); }, ids.chat);
await page.waitForTimeout(1200);
const sendCls = await ev(() => document.querySelector('.ph-send')?.className || '');
ok('一、输入框为空时发送键是「让对方回复」那个样子', /is-ghost/.test(sendCls), sendCls);
ok('一、这时底色改得动', await cs('.ph-send', 'background-color') === 'rgb(255, 0, 0)', await cs('.ph-send', 'background-color'));
ok('一、这时图标颜色改得动', await cs('.ph-send', 'color') === 'rgb(0, 255, 0)', await cs('.ph-send', 'color'));
ok('四、我发的那一条挪到左边', await cs('.ph-msg-mine', 'flex-direction') === 'row', await cs('.ph-msg-mine', 'flex-direction'));
ok('四、我那一栏的对齐改得动', await cs('.ph-msg-mine .ph-col', 'align-items') === 'flex-start', await cs('.ph-msg-mine .ph-col', 'align-items'));
ok('四、我的气泡底色与字色改得动', await cs('.ph-bubble-mine', 'background-color') === 'rgb(0, 0, 255)' && await cs('.ph-bubble-mine', 'color') === 'rgb(255, 255, 0)', await cs('.ph-bubble-mine', 'background-color'));
ok('四、消息列表顶部留白改得动', await cs('.ph-chat-body', 'padding-top') === '77px', await cs('.ph-chat-body', 'padding-top'));
ok('四、返回键颜色改得动', await cs('.ph-back', 'color') === 'rgb(255, 0, 255)', await cs('.ph-back', 'color'));

// 五、悬浮球
await ev(async ({ b64 }) => {
  const { images } = await import('/src/system/db/index.js');
  const q = await import('/src/system/quickball.js');
  const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
  const id = await images.putIcon(new File([blob], 'b.png', { type: 'image/png' }));
  q.setCfg({ on: true, img: id, plate: true, items: ['theme', 'home'],
    css: '.qb-ball { background-color: rgb(1, 2, 3); } .qb-item .qb-icon { background-color: rgb(4, 5, 6); }' });
  const n = await import('/src/system/nav.js'); n.goHome();
}, { b64: PNG_B64 });
await page.waitForTimeout(800);
ok('五、悬浮球：换了图还保留底板时，底色改得动', await cs('.qb-ball.has-img.has-plate', 'background-color') === 'rgb(1, 2, 3)', await cs('.qb-ball.has-img.has-plate', 'background-color'));
await ev(async () => { const { db } = await import('/src/system/db/index.js'); db.settings.set({ theme: 'dark' }); });
await page.locator('.qb-ball').click();
await page.waitForTimeout(400);
ok('五、悬浮球：面板上开着的项，图标底色改得动', await cs('.qb-item.is-on .qb-icon', 'background-color') === 'rgb(4, 5, 6)', await cs('.qb-item.is-on .qb-icon', 'background-color'));
await page.locator('.qb-scrim').click({ position: { x: 5, y: 5 } });
await page.waitForTimeout(200);
// 五、外观 - 自定义 CSS：播放器挂件（直接放一段挂件的标记进去，不依赖有没有歌在放）
await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  db.settings.set({ customCSS: '.wg-player { flex-direction: column; } .pl-line { font-family: monospace; }' });
  document.body.insertAdjacentHTML('beforeend', '<div id="wgprobe"><div class="wg wg-player is-right is-serif"><div class="pl-text"><div class="pl-line">x</div></div></div></div>');
});
await page.waitForTimeout(300);
const wgp = await ev(() => ({ dir: getComputedStyle(document.querySelector('#wgprobe .wg-player')).flexDirection,
  line: getComputedStyle(document.querySelector('#wgprobe .pl-line')).fontFamily }));
ok('五、播放器挂件靠右排、衬线字时：方向与字体都改得动', wgp.dir === 'column' && /monospace/.test(wgp.line), JSON.stringify(wgp));
await ev(() => document.getElementById('wgprobe')?.remove());
// 五、线下
await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  db.settings.set({ customCSS: '' });
  const stage = await import('/src/system/stage.js');
  stage.mountCSS('.sg-bub { background-color: rgb(7, 8, 9); } .sg-card { aspect-ratio: 2 / 1; }');
  document.body.insertAdjacentHTML('beforeend', '<div id="sgprobe" class="sg"><div class="sg-bub is-mine">a</div><div class="sg-card is-fixed"><div class="sg-card-body">b</div></div></div>');
});
await page.waitForTimeout(200);
const sg = await ev(() => ({ bub: getComputedStyle(document.querySelector('#sgprobe .sg-bub')).backgroundColor, card: getComputedStyle(document.querySelector('#sgprobe .sg-card')).aspectRatio }));
ok('五、线下：我那一侧的气泡底色、固定比例卡片的比例改得动', sg.bub === 'rgb(7, 8, 9)' && /^2 \/ 1$/.test(sg.card), JSON.stringify(sg));
await ev(async () => { document.getElementById('sgprobe')?.remove(); (await import('/src/system/stage.js')).unmountCSS(); });

ok('没有页面错误', !errs.length, errs.join('\n'));
await browser.close();
const fail = R.filter(x => !x.pass).length;
console.log(`\n${R.length - fail}/${R.length} 项通过`);
process.exit(fail ? 1 : 0);
