// 交互冒烟：smoke.mjs 只把每条路由打开一遍，点下去才炸的那种它抓不到。
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);

const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const a = db.characters.create({ name: '甲', persona: '人设甲' });
  const chat = db.chats.create({ characterIds: [a.id], personaId: me.id, lastMessageAt: Date.now() });
  db.messages.create({ chatId: chat.id, role: 'user', kind: 'text', content: '嗨', status: 'done' });
  db.messages.create({ chatId: chat.id, role: 'char', authorId: a.id, kind: 'text', content: '在的', status: 'done' });
  db.memories.create({ scope: `character:${a.id}`, content: '一条记忆', category: 'fact', rank: 'A', keywords: [], personaId: me.id });
  const bookMod = await import('/src/system/book.js');
  const ebk = await bookMod.add({ title: '雨城旧事', author: '某人', kind: 'txt',
    text: Array.from({ length: 60 }, (_, i) => `第 ${i} 段。` + '一些正文内容。'.repeat(12)).join('\n\n'),
    chapters: [{ title: '第一章', start: 0, end: 3000 }, { title: '第二章', start: 3000, end: 99999 }] });
  const shelfMod = await import('/src/system/shelf.js');
  shelfMod.add(a.id, { title: '雨城旧事', author: '某人' });
  shelfMod.add(a.id, { title: '还没导入的那本', author: '别人' });
  const videoMod = await import('/src/system/video.js');
  const vid = videoMod.addVideo({ title: '一部片子', url: 'https://example.com/a.mp4',
    subtitle: '1\n00:00:01,000 --> 00:00:04,000\n第一句\n' });
  db.reviews.create({ kind: 'book', subjectId: ebk.id, charId: a.id, title: '雨城旧事',
    text: '看完之后想起一件事。', at: 10, createdAt: Date.now() });
  return { char: a.id, chat: chat.id, ebook: ebk.id, video: vid.id };
});

let bad = 0, n = 0;
const open = (app, route) => page.evaluate(async ([a, r]) => {
  const nav = await import('/src/system/nav.js');
  nav.goHome(); nav.openApp(a, r);
}, [app, route]);

async function step(name, fn) {
  n++; errors.length = 0;
  try {
    await fn();
    await page.waitForTimeout(350);
    const crashed = await page.locator('.boundary, .err-box').count().catch(() => 0);
    const text = await page.locator('.app-layer').innerText().catch(() => '');
    if (crashed || /已停止/.test(text) || errors.length) {
      bad++;
      console.log(`  FAIL ${name}  ${errors[0] || text.split('\n').slice(0, 2).join(' / ') || '崩了'}`);
    }
  } catch (e) { bad++; console.log(`  FAIL ${name}  ${e.message.split('\n')[0]}`); }
}
const tap = async sel => { await page.locator(sel).first().click({ timeout: 4000 }); await page.waitForTimeout(300); };
const tapText = async t => { await page.getByText(t, { exact: true }).first().click({ timeout: 4000 }); await page.waitForTimeout(300); };

// ---- 一起看
await step('theater 书架页导入浮层', async () => {
  await open('theater', '/books'); await page.waitForTimeout(400);
  await tap('.nav-text');
  await page.keyboard.press('Escape');
});
await step('theater 书目详情', () => open('theater', `/book/${ids.ebook}`));
await step('theater 书目 - 书评入口', () => tapText('角色写的书评'));
await step('theater 阅读器翻页', async () => {
  await open('theater', `/read/${ids.ebook}`); await page.waitForTimeout(700);
  await tap('[aria-label="下一页"]');
  await tap('[aria-label="上一页"]');
});
await step('theater 阅读器目录', async () => {
  await tap('.nav-text');
  await tapText('第二章');
});
await step('theater 个人书架', async () => {
  await open('theater', `/shelf/${ids.char}`); await page.waitForTimeout(500);
});
await step('theater 书架 - 占位书籍长按浮层', async () => {
  await page.locator('.shelf-item.is-ghost').first().click({ timeout: 4000 });
});
await step('theater 书架 - 添加浮层', async () => {
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await tap('.nav-text');
  await page.keyboard.press('Escape');
});
await step('theater 影评页', () => open('theater', `/reviews/book/${ids.ebook}`));
await step('theater 一起看设置', async () => {
  await open('theater', '/settings'); await page.waitForTimeout(400);
  const sw = page.locator('.switch, input[type=checkbox]');
  if (await sw.count()) await sw.first().click({ timeout: 3000 }).catch(() => {});
});
await step('theater 一起读', () => open('theater', `/together/${ids.chat}/${ids.ebook}`));

// ---- 会话右上角菜单
await step('chat 打开会话', async () => {
  await open('chat', `/chat/${ids.chat}`); await page.waitForTimeout(600);
});
await step('chat 右上角菜单', () => tap('[aria-label="更多"]'));
const items = await page.locator('.fullsheet .li-title').allInnerTexts().catch(() => []);
console.log(`  菜单 ${items.length} 项：${items.join(' / ')}`);
for (const t of ['角色卡', '角色主页', '主动发起对话', '搜索聊天记录', '节奏与自动回复', '翻译', '互动', '上下文与记忆']) {
  if (!items.includes(t)) continue;
  await step(`chat 菜单 - ${t}`, async () => {
    await tapText(t); await page.waitForTimeout(400);
    await open('chat', `/chat/${ids.chat}`); await page.waitForTimeout(400);
    await tap('[aria-label="更多"]');
  });
}
await step('chat 菜单 - 导出这个角色', async () => {
  if (items.includes('导出这个角色')) await tapText('导出这个角色');
  await page.waitForTimeout(1200);
});

// ---- 消息长按菜单
await step('chat 消息长按', async () => {
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await open('chat', `/chat/${ids.chat}`); await page.waitForTimeout(600);
  const b = await page.locator('.msg').first().boundingBox();
  if (!b) throw new Error('找不到气泡');
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
});

// ---- 主界面：编辑模式、文件夹、文件夹里长按
await step('home 长按进编辑模式', async () => {
  await page.evaluate(async () => (await import('/src/system/nav.js')).goHome());
  await page.waitForTimeout(500);
  await page.mouse.move(215, 700);
  await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
  await page.waitForTimeout(400);
  if (!await page.locator('.edit-bar').count()) throw new Error('没进编辑模式');
});
await step('home 退出编辑模式', async () => {
  await page.locator('.edit-acts .btn-primary').first().click({ timeout: 3000 });
});
await step('home 建一个文件夹并打开', async () => {
  await page.evaluate(async () => {
    const lay = await import('/src/screens/home/layout.js');
    const apps = ['theater', 'music'];
    lay.newFolderAuto(0, apps, '看和听');
  });
  await page.waitForTimeout(500);
  await page.locator('.folder-tile').first().click({ timeout: 4000 });
  await page.waitForTimeout(400);
  if (!await page.locator('.folder-open').count()) throw new Error('文件夹没打开');
});
await step('home 文件夹里长按改图标', async () => {
  const b = await page.locator('.folder-app').first().boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
  await page.waitForTimeout(500);
});
await step('home 文件夹改名', async () => {
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  if (await page.locator('.folder-open').count()) await tapText('改名称与内容');
});

// ---- 清空
await step('settings 存储页', async () => {
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await open('settings', '/storage'); await page.waitForTimeout(600);
});
// 清空那几项从角色卡挪到了会话菜单里 —— 要清的是这段对话的记录，
// 人在对话里，入口就在对话里（第 5 条）
await step('chat 会话菜单 - 清空入口', async () => {
  await open('chat', `/chat/${ids.chat}`); await page.waitForTimeout(700);
  await tap('[aria-label="更多"]');
  const t = await page.locator('.app-layer').innerText();
  if (!/清空记忆与聊天记录/.test(t)) throw new Error('会话菜单里找不到清空入口');
  await tapText('清空记忆与聊天记录');
  await page.keyboard.press('Escape');
});

await browser.close();
console.log(bad ? `\n${n} 步里 ${bad} 步炸了` : `\n${n} 步交互全部通过`);
process.exit(bad ? 1 : 0);
