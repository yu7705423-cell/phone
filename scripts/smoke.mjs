// 把每个 app 的每条路由都打开一遍，看有没有页面炸掉。
//
// doctor 的「导入导出」只查模块之间的引用，查不到文件内部引用了一个
// 不存在的函数 —— 那种错要到运行时打开那个页面才炸。这个脚本就是补那一刀。
//
//   python3 -m http.server 8000 &
//   node scripts/smoke.mjs
//
// 需要 playwright。没装就跳过，不拦提交。

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:8000';

// 每条路由都要在「有数据」的前提下打开，空库跑不出真问题
const ROUTES = {
  chat: ['/', '/moments', '/stickers', '/context', '/templates',
    '/chat/:chat', '/profile/:char', '/edit/:char', '/proactive/:char'],
  contact: ['/', '/import', '/me', '/me/:persona', '/char/:char',
    '/edit/:char', '/profile/:char', '/net/:char', '/npc/:char'],
  memory: ['/', '/import', '/edit/:mem'],
  lorebook: ['/'],
  settings: ['/', '/api', '/voice', '/image', '/embed', '/notify',
    '/appearance', '/storage'],
};

// 本项目不装 npm 依赖（CLAUDE.md 第 8 条），所以 playwright 从别处借：
// SMOKE_PW 指向一个装了 playwright 的目录即可。
let chromium;
const pw = process.env.SMOKE_PW ? `${process.env.SMOKE_PW}/node_modules/playwright/index.mjs` : 'playwright';
try { ({ chromium } = await import(pw)); }
catch { console.log('  跳过：找不到 playwright。装一个，或者用 SMOKE_PW=<某个装了它的目录> 指过去'); process.exit(0); }

const exe = process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });

const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

// 造一点数据，否则大部分页面走的是空状态分支
const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const card = await import('/src/system/ai/tasks/card.js');
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const a = db.characters.create({ name: '甲', persona: '人设甲', age: '22', gender: '女' });
  const b = db.characters.create({ name: '乙', persona: '人设乙', isNpc: true });
  card.link(a.id, b.id, '同学', '同学');
  const chat = db.chats.create({ characterIds: [a.id], personaId: me.id, lastMessageAt: Date.now() });
  db.messages.create({ chatId: chat.id, role: 'user', kind: 'text', content: '嗨', status: 'done' });
  const mem = db.memories.create({ scope: `character:${a.id}`, content: '一条记忆', category: 'fact', rank: 'A', keywords: [], personaId: me.id });
  db.lorebooks.create({ name: '一本世界书', entries: [] });
  return { char: a.id, chat: chat.id, mem: mem.id, persona: me.id };
});
await page.waitForTimeout(400);

let bad = 0, n = 0;
for (const [appId, routes] of Object.entries(ROUTES)) {
  for (const raw of routes) {
    const route = raw.replace(/:(\w+)/g, (_, k) => ids[k]);
    n++;
    errors.length = 0;
    await page.evaluate(async ([app, r]) => {
      const nav = await import('/src/system/nav.js');
      nav.goHome();
      nav.openApp(app, r);
    }, [appId, route]);
    await page.waitForTimeout(450);
    const crashed = await page.locator('.boundary, .err-box').count().catch(() => 0);
    const text = await page.locator('.app-layer').innerText().catch(() => '');
    const stopped = /已停止/.test(text);
    if (crashed || stopped || errors.length) {
      bad++;
      const why = stopped ? text.split('\n').slice(0, 2).join(' / ') : errors[0] || '崩了';
      console.log(`  FAIL ${appId}${route}  ${why}`);
    }
  }
}

await browser.close();
console.log(bad ? `\n${n} 条路由里 ${bad} 条炸了` : `\n${n} 条路由全部打得开`);
process.exit(bad ? 1 : 0);
