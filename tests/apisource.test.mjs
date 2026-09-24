// @serial  有时间上的断言，和别的测试抢 CPU 时会误报
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const fail = [], ok = [];
const check = (c, m) => (c ? ok : fail).push(m);

// 先配一个聊天预设，当作可选的来源之一
await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  db.settings.set({ services: { ...db.settings.get().services,
    chat: { presets: [{ id: 'p1', name: 'SiliconFlow 聊天', provider: 'openai',
      baseUrl: 'https://api.siliconflow.cn/v1', apiKey: 'sk-chat', model: 'm' }],
      activeId: 'p1', fallbackId: null } } });
});
const go = async r => { await page.evaluate(([r]) =>
  import('/src/system/nav.js').then(n => n.openApp('settings', r)), [r]); await page.waitForTimeout(700); };
const cfgOf = name => page.evaluate(async ([n]) => {
  const svc = await import('/src/system/ai/services.js');
  const c = svc[n + 'Config']();
  return { baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model, endpointId: c.endpointId || '' };
}, [name]);

// ---- 向量页：新建一条接口 ----
await go('/embed');
check(await page.isVisible('input[placeholder="https://api.openai.com"]'),
  '没选来源时，地址输入框是露着的');
await page.click('text=在下面直接填写');
await page.waitForTimeout(500);
check(await page.isVisible('text=SiliconFlow 聊天'), '选择器里列出了聊天预设');
await page.click('text=新建一个接口');
await page.waitForTimeout(400);
await page.fill('.sheet input[placeholder="例如 SiliconFlow"]', '我的中转站');
await page.fill('.sheet input[placeholder="https://api.siliconflow.cn"]', 'https://api.siliconflow.cn');
await page.fill('.sheet input[placeholder="sk-..."]', 'sk-mine');
await page.click('text=保存并使用');
await page.waitForTimeout(800);
let c = await cfgOf('embed');
check(c.baseUrl === 'https://api.siliconflow.cn' && c.apiKey === 'sk-mine',
  `向量的地址密钥从来源取到了：${c.baseUrl} / ${c.apiKey}`);
check(!(await page.isVisible('input[placeholder="https://api.openai.com"]')),
  '选了来源之后，地址与密钥的输入框收起来了');
const epId = c.endpointId;
check(!!epId, '记的是 endpointId，不是拷贝一份地址');

// 模型名仍然是这一页自己的
await page.fill('input[placeholder="text-embedding-3-small"]', 'Qwen/Qwen3-Embedding-8B');
await page.waitForTimeout(400);
c = await cfgOf('embed');
check(c.model === 'Qwen/Qwen3-Embedding-8B', `模型名还是各页自己的：${c.model}`);

// ---- 重排页：指到聊天预设 ----
await go('/rerank');
await page.click('text=在下面直接填写');
await page.waitForTimeout(400);
await page.click('text=SiliconFlow 聊天');
await page.waitForTimeout(600);
c = await cfgOf('rerank');
check(c.baseUrl === 'https://api.siliconflow.cn/v1' && c.apiKey === 'sk-chat',
  `重排指到聊天预设：${c.baseUrl} / ${c.apiKey}`);

// ---- 识图页：指到同一条自建接口 ----
// 地址与密钥只在「单独一套接口」那一档下才有意义，来源选择器也在那一档里
await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  svc.setVision({ mode: 'api' });
});
await go('/vision');
await page.click('text=在下面直接填写');
await page.waitForTimeout(400);
await page.click('text=我的中转站');
await page.waitForTimeout(600);
c = await cfgOf('vision');
check(c.apiKey === 'sk-mine', `识图也指到同一条：${c.apiKey}`);

// ---- 改一次来源，用它的都跟着变 ----
await page.evaluate(async ([id]) => {
  const svc = await import('/src/system/ai/services.js');
  svc.updateEndpoint(id, { apiKey: 'sk-换过了' });
}, [epId]);
await page.waitForTimeout(400);
const e2 = await cfgOf('embed'), v2 = await cfgOf('vision'), r2 = await cfgOf('rerank');
check(e2.apiKey === 'sk-换过了' && v2.apiKey === 'sk-换过了',
  `改一次来源，向量与识图一起变：${e2.apiKey} / ${v2.apiKey}`);
check(r2.apiKey === 'sk-chat', '指着聊天预设的那个不受影响');

// ---- 删掉来源，退回各自填的 ----
await page.evaluate(async ([id]) => {
  const db = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  // 先在向量那页留一个自己填的地址，看删掉来源之后是不是退回它
  const s = db.settings.get().services;
  db.settings.set({ services: { ...s, embed: { ...s.embed, baseUrl: 'https://自己填的', apiKey: 'sk-自己的' } } });
  svc.removeEndpoint(id);
}, [epId]);
await page.waitForTimeout(400);
const e3 = await cfgOf('embed');
check(e3.baseUrl === 'https://自己填的' && e3.apiKey === 'sk-自己的',
  `来源被删之后退回自己填的：${e3.baseUrl} / ${e3.apiKey}`);

// ---- 密钥不进备份。自建的接口里有密钥，所以它也不该进 ----
const inBackup = await page.evaluate(async () => {
  const backup = await import('/src/system/backup.js');
  const svc = await import('/src/system/ai/services.js');
  svc.addEndpoint({ name: '带密钥的一条', baseUrl: 'https://x', apiKey: 'sk-x' });
  const data = JSON.parse(await (await backup.build({ media: false })).text());
  return JSON.stringify(data.settings?.services ?? null);
});
check(inBackup === 'null', `接口与密钥没有写进备份（services=${inBackup}）`);

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 5).join('\n'));
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
