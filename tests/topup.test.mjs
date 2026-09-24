// 接口的站点与充值链接；各接口页的模型都能拉取、搜索。
//
//   一、余额不足（402）且填了充值链接：失败那一条写明原因，给「去充值」直达那个链接，「重试」照旧
//   二、别的错误、只填了站点（没写 https://）：给「打开站点」，补全协议；不说余额不足
//   三、余额不足但没填链接：写明去哪儿填
//   四、主用、副用都没钱：两个链接各标上是哪一套
//   五、接口编辑页：两栏在，填了之后出现「打开站点」「打开充值页」
//   六、识图、语音识别、记忆、翻译、联网搜索、视频六页：模型栏都有「拉取并选择」，
//       拉得到列表、搜得到、点了就填上
import { BASE, OUT, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.addInitScript(b => { window.BASE = b; }, BASE);
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

// 每套接口一个域名。broke 里的回 402，down 里的回 500
const broke = new Set(); const down = new Set();
const modelsAsked = [];
await ctx.route(/https:\/\/(llm-[a-z]+|vid)\.example\.com\/.*/, route => {
  const u = new URL(route.request().url());
  const host = u.hostname.split('.')[0];
  const J = (status, o) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
  if (/\/models$/.test(u.pathname)) {
    modelsAsked.push(host);
    return J(200, { data: ['gpt-4o-mini', 'whisper-1', 'qwen-vl-max', 'sora-2', 'deepseek-chat'].map(id => ({ id })) });
  }
  if (broke.has(host)) return J(402, { error: { message: 'Insufficient balance, please recharge' } });
  if (down.has(host)) return J(500, { error: { message: 'upstream exploded' } });
  return J(200, { choices: [{ message: { content: '好' } }] });
});

await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ids = await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const a = svc.newChatPreset({ name: '甲站', provider: 'openai', baseUrl: 'https://llm-a.example.com/v1',
    apiKey: 'sk-a', model: 'm', siteUrl: 'https://a-site.example.com', topupUrl: 'https://pay.example.com/a' });
  const b = svc.newChatPreset({ name: '乙站', provider: 'openai', baseUrl: 'https://llm-b.example.com/v1',
    apiKey: 'sk-b', model: 'm', siteUrl: 'b-site.example.com' });
  const c = svc.newChatPreset({ name: '丙站', provider: 'openai', baseUrl: 'https://llm-c.example.com/v1',
    apiKey: 'sk-c', model: 'm' });
  const d = svc.newChatPreset({ name: '丁站', provider: 'openai', baseUrl: 'https://llm-d.example.com/v1',
    apiKey: 'sk-d', model: 'm', topupUrl: 'https://pay.example.com/d' });
  const ch = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [ch.id], lastMessageAt: Date.now() });
  db.settings.set({ chatFallback: false, retryMax: 0 });
  (await import('/src/system/nav.js')).unlock();
  return { a: a.id, b: b.id, c: c.id, d: d.id, chat: chat.id };
});

const use = (active, fallback, patch = {}) => page.evaluate(async ([x, y, p]) => {
  const svc = await import('/src/system/ai/services.js');
  const { db } = await import('/src/system/db/index.js');
  svc.setActiveChat(x);
  svc.setFallbackChat(y || null);
  db.settings.set(p);
}, [active, fallback, patch]);

let opened = false;
async function failOnce() {
  if (!opened) {
    await page.evaluate(r => import('/src/system/nav.js').then(n => n.openApp('chat', r)), `/chat/${ids.chat}`);
    await page.waitForTimeout(800);
    opened = true;
  }
  const before = await page.locator('.fail-note').count();
  await page.fill('.composer-input', '在吗');
  await page.click('.send-btn:not(.is-ghost):not(.is-stop)');
  await page.waitForTimeout(300);
  await page.click('.send-btn.is-ghost', { timeout: 3000 }).catch(() => {});
  for (let i = 0; i < 40; i++) {
    if ((await page.locator('.fail-note').count()) > before) break;
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(300);
  return page.locator('.fail-note').last();
}
const linksOf = note => note.locator('a').evaluateAll(as => as.map(a => ({ text: a.innerText.trim(), href: a.href, blank: a.target === '_blank' })));

// ---- 一 ----
broke.add('llm-a');
await use(ids.a);
let note = await failOnce();
let txt = await note.innerText();
let links = await linksOf(note);
ok('余额不足：写明原因与报错原文', /余额不足/.test(txt) && /Insufficient balance/.test(txt), txt);
ok('「去充值」指向这一套填的充值链接，在新页面打开',
  links.length === 1 && links[0].text === '去充值' && links[0].href === 'https://pay.example.com/a' && links[0].blank, JSON.stringify(links));
ok('「重试」还在', /重试/.test(txt));
await page.screenshot({ path: `${OUT}/topup-chat.png` });

// ---- 二 ----
down.add('llm-b');
await use(ids.b);
note = await failOnce();
txt = await note.innerText();
links = await linksOf(note);
ok('别的错误：给「打开站点」，没写协议的补上 https://',
  links.length === 1 && links[0].text === '打开站点' && links[0].href === 'https://b-site.example.com/', JSON.stringify(links));
ok('别的错误不说余额不足', !/余额不足/.test(txt), txt);

// ---- 三 ----
broke.add('llm-c');
await use(ids.c);
note = await failOnce();
txt = await note.innerText();
ok('余额不足但没填链接：写明去「设置 - 接口」填', (await linksOf(note)).length === 0 && /设置 - 接口/.test(txt), txt);

// ---- 四 ----
broke.add('llm-d');
await use(ids.a, ids.d, { chatFallback: true, failoverMax: 1 });
note = await failOnce();
links = await linksOf(note);
ok('主用副用都没钱：两个「去充值」，各标上是哪一套',
  links.length === 2 && links.some(l => l.text === '去充值（甲站）' && l.href === 'https://pay.example.com/a')
  && links.some(l => l.text === '去充值（丁站）' && l.href === 'https://pay.example.com/d'), JSON.stringify(links));
await use(ids.a, null, { chatFallback: false });

// ---- 五、接口编辑页 ----
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('settings', '/api'); });
await page.waitForTimeout(800);
await page.locator('.list-item', { hasText: '丙站' }).first().tap();
await page.waitForTimeout(500);
const sheet = page.locator('.sheet').last();
const siteBox = sheet.getByRole('textbox', { name: /^站点地址/ });
const topBox = sheet.getByRole('textbox', { name: /^充值链接/ });
ok('编辑页有「站点地址」「充值链接」两栏', await siteBox.count() === 1 && await topBox.count() === 1);
ok('没填时不出现打开的按钮', await sheet.locator('a', { hasText: '打开站点' }).count() === 0);
await siteBox.fill('c-site.example.com');
await topBox.fill('https://pay.example.com/c');
await page.waitForTimeout(300);
ok('填了之后出现「打开站点」「打开充值页」', await sheet.locator('a', { hasText: '打开站点' }).getAttribute('href') === 'https://c-site.example.com/'
  && await sheet.locator('a', { hasText: '打开充值页' }).getAttribute('href') === 'https://pay.example.com/c');
await page.screenshot({ path: `${OUT}/topup-editor.png` });
const saved = await page.evaluate(async id => (await import('/src/system/ai/services.js')).presetLinks(id), ids.c);
ok('存下来了', saved?.site === 'https://c-site.example.com/' && saved?.topup === 'https://pay.example.com/c', JSON.stringify(saved));

// ---- 六、六个页面的模型栏 ----
await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  const conn = name => ({ baseUrl: `https://llm-${name}.example.com/v1`, apiKey: 'sk-x', model: '' });
  svc.setVision({ mode: 'api', ...conn('vision') });
  svc.setAsr(conn('asr'));
  svc.setMemory({ mode: 'api', provider: 'openai', ...conn('memory') });
  svc.setTranslate({ mode: 'api', provider: 'openai', ...conn('translate') });
  svc.setSearch({ provider: 'openai', ...conn('search') });
  svc.newVideoPreset({ name: '视频甲', kind: 'openai', baseUrl: 'https://vid.example.com/v1', apiKey: 'sk-v', model: '' });
});
const PAGES = [
  { route: '/vision', key: 'visionConfig', pick: 'qwen-vl-max', q: 'vl' },
  { route: '/asr', key: 'asrConfig', pick: 'whisper-1', q: 'whisper' },
  { route: '/memoryapi', key: 'memoryConfig', pick: 'deepseek-chat', q: 'deep' },
  { route: '/translate', key: 'translateConfig', pick: 'gpt-4o-mini', q: 'mini' },
  { route: '/search', key: 'searchConfig', pick: 'gpt-4o-mini', q: '4o' },
  { route: '/video', video: '视频甲', pick: 'sora-2', q: 'sora' },
];
for (const pg of PAGES) {
  await page.evaluate(async r => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('settings', r); }, pg.route);
  await page.waitForTimeout(700);
  if (pg.video) { await page.locator('.list-item', { hasText: pg.video }).first().tap(); await page.waitForTimeout(500); }
  const btn = page.locator('.btn', { hasText: '拉取并选择' });
  const has = await btn.count() === 1;
  ok(`${pg.route}：模型栏有「拉取并选择」`, has);
  if (!has) continue;
  const n0 = modelsAsked.length;
  await btn.tap();
  await page.waitForTimeout(700);
  const picker = page.locator('.sheet', { hasText: '选择模型' }).last();
  const rows = await picker.locator('.model-row').count();
  ok(`${pg.route}：拉到了列表`, rows === 5 && modelsAsked.length > n0, `${rows}`);
  await picker.locator('input').first().fill(pg.q);
  await page.waitForTimeout(200);
  const hit = await picker.locator('.model-row').allInnerTexts();
  ok(`${pg.route}：搜得到`, hit.length >= 1 && hit.every(t => t.toLowerCase().includes(pg.q)), JSON.stringify(hit));
  await picker.locator('.model-row', { hasText: pg.pick }).first().tap();
  await page.waitForTimeout(300);
  const model = await page.evaluate(async ([k, v]) => {
    const svc = await import('/src/system/ai/services.js');
    return k ? svc[k]().model : svc.videoPresets().find(p => p.name === v)?.model;
  }, [pg.key, pg.video]);
  ok(`${pg.route}：点了就填上`, model === pg.pick, model);
}
await page.screenshot({ path: `${OUT}/topup-models.png` });

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
