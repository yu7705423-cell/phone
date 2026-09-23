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

const charId = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const shelf = await import('/src/system/shelf.js');
  const a = db.characters.create({ name: '甲', persona: '在旧书店做店员。' });
  shelf.add(a.id, { title: '雨城旧事', author: '某人' });
  db.settings.set({ services: { chat: {
    presets: [{ id: 'p1', name: '副用', provider: 'openai', kind: 'openai',
      baseUrl: 'https://example.com/v1', apiKey: 'k', model: 'm' }],
    activeId: 'p1', fallbackId: 'p1' } } });
  window.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content:
    JSON.stringify({ books: [
      { title: '潮湿气候下的纸张保存', author: '某研究所', note: '为了店里的书买的' },
      { title: '店里卖不掉的那本图鉴', author: '佚名', note: '压柜台用' },
    ] }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  return a.id;
});

const fail = [];
const check = async (name, cond) => { if (!cond) fail.push(name); };

await page.evaluate(async id => {
  const nav = await import('/src/system/nav.js');
  nav.goHome(); nav.openApp('theater', `/shelf/${id}`);
}, charId);
await page.waitForTimeout(700);

await check('入口在书架页上', await page.getByText('按角色设定生成', { exact: true }).count() > 0);
await page.getByText('按角色设定生成', { exact: true }).first().click();
await page.waitForTimeout(500);
await check('生成浮层打得开', await page.getByText('这一批生成几本', { exact: true }).count() > 0);
await check('两档范围都在', await page.getByText('现实中存在的书', { exact: true }).count() > 0);

await page.getByText('生成 8 本', { exact: true }).first().click();
await page.waitForTimeout(1200);
await check('进了确认页', await page.getByText('确认放上书架', { exact: true }).count() > 0);
await check('两本都列出来了', await page.getByText('潮湿气候下的纸张保存', { exact: true }).count() > 0);

// 取消勾选一本，只存另一本
await page.getByText('店里卖不掉的那本图鉴', { exact: true }).first().click();
await page.waitForTimeout(300);
await check('勾选数跟着变', await page.getByText('放上勾选的 1 本', { exact: true }).count() > 0);
await page.getByText('放上勾选的 1 本', { exact: true }).first().click();
await page.waitForTimeout(600);

const titles = await page.evaluate(async id => {
  const shelf = await import('/src/system/shelf.js');
  return shelf.listOf(id).map(x => x.title);
}, charId);
await check('只放上了勾选的那一本', titles.length === 2 && titles.includes('潮湿气候下的纸张保存'));
await check('回到了书架页', await page.getByText('确认放上书架', { exact: true }).count() === 0);

const crashed = await page.locator('.boundary, .err-box').count();
await check('没有页面炸掉', !crashed && !errors.length);

console.log(JSON.stringify({ titles }, null, 2));
console.log(fail.length ? '失败：' + fail.join('、') : '生成流程全部通过');
if (errors.length) console.log('ERRORS', errors);
await browser.close();
process.exit(fail.length ? 1 : 0);
