// 生图从头到尾走一遍。用一个假中转站，把常见的几种回包形状都试到
import { BASE, EXE, chromium, PNG_PATH } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const fs = await import('node:fs/promises');
const PNG = (await fs.readFile(PNG_PATH,'utf-8')).trim();
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// 假中转站。记下它收到了什么
const seen = [];
let mode = 'b64';
await page.route('**/images/generations', async route => {
  const req = route.request();
  seen.push({ url: req.url(), method: req.method(),
    headers: req.headers(), body: req.postData() });
  const body = mode === 'b64' ? { data: [{ b64_json: PNG }] }
    : mode === 'dataurl' ? { data: [{ b64_json: `data:image/png;base64,${PNG}` }] }
    : mode === 'url' ? { data: [{ url: `${BASE}/__fake.png` }] }
    : mode === 'images' ? { images: [{ image: PNG }] }
    : mode === 'bare' ? [{ b64_json: PNG }]
    : mode === 'err200' ? { error: { message: '上游余额不足' } }
    : { data: [] };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await page.route('**/__fake.png', route => route.fulfill({
  status: 200, contentType: 'image/png', body: Buffer.from(PNG, 'base64') }));

await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1800);

// 配一套生图接口
const cfg = await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newImagePreset({ name:'测试中转' });
  svc.updateImagePreset(p.id, { baseUrl:'https://relay.example.com/v1',
    apiKey:'sk-test', model:'gpt-image-1', size:'1024x1024' });
  const s = await import('/src/system/ai/services.js');
  return { id: p.id, active: s.activeImage()?.id, ready: (await import('/src/system/ai/image.js')).isImageReady() };
});
ok('配完之后认得出「已配置」', cfg.ready, JSON.stringify(cfg));
ok('新建的那一套就是当前生效的那一套', cfg.active === cfg.id, JSON.stringify(cfg));

const run = async (m, prompt='a small black circle') => {
  mode = m;
  return page.evaluate(async ([p]) => {
    const img = await import('/src/system/ai/image.js');
    try {
      const blob = await img.generate({ prompt: p, key: 'img:' + Math.random() });
      const id = await img.toLibrary(blob, 512);
      return { okk: true, size: blob.size, type: blob.type, id };
    } catch (e) { return { okk: false, err: String(e.message || e) }; }
  }, [prompt]);
};

for (const [m, label] of [['b64','纯 base64'], ['dataurl','带 data: 前缀的 base64'],
  ['url','只给链接'], ['images','images[].image'], ['bare','最外层就是数组']]) {
  const r = await run(m);
  ok(`回包是「${label}」时能出图`, r.okk && r.size > 0, JSON.stringify(r));
}
const e200 = await run('err200');
ok('200 里带 error 时，把对面那句话说出来',
  !e200.okk && /余额不足/.test(e200.err), JSON.stringify(e200));
const empty = await run('empty');
ok('回包里没有图时，把原文带出来',
  !empty.okk && /接口没有返回图片/.test(empty.err), JSON.stringify(empty));

// ---- 发出去的那个请求长什么样 ----
const first = seen[0];
ok('地址拼对了', first && first.url === 'https://relay.example.com/v1/images/generations',
  first && first.url);
ok('带了 Authorization', first && /^Bearer sk-test$/.test(first.headers.authorization || ''),
  JSON.stringify(first && first.headers.authorization));
ok('content-type 是 json', first && /application\/json/.test(first.headers['content-type'] || ''),
  JSON.stringify(first && first.headers['content-type']));
const sent = first && JSON.parse(first.body || '{}');
ok('提示词真的发出去了', sent && sent.prompt === 'a small black circle', JSON.stringify(sent));
ok('模型与尺寸都在', sent && sent.model === 'gpt-image-1' && sent.size === '1024x1024',
  JSON.stringify(sent));
ok('默认不发 response_format（gpt-image-1 不认它）',
  sent && !('response_format' in sent), JSON.stringify(sent));

// ---- 地址填法的几种变体 ----
const urls = await page.evaluate(async ([id]) => {
  const svc = await import('/src/system/ai/services.js');
  const img = await import('/src/system/ai/image.js');
  const out = {};
  for (const [label, u] of [['带 /v1','https://a.com/v1'], ['不带 /v1','https://a.com'],
    ['末尾斜杠','https://a.com/v1/'], ['前后空格',' https://a.com/v1 '],
    ['带换行','https://a.com/v1\n']]) {
    svc.updateImagePreset(id, { baseUrl: u });
    const p = svc.activeImage();
    // 端点是内部函数，借一次 generate 的报错拿不到，所以直接算
    out[label] = p.baseUrl;
  }
  svc.updateImagePreset(id, { baseUrl: 'https://relay.example.com/v1' });
  return out;
}, [cfg.id]);
console.log('  地址原样存着：', JSON.stringify(urls));

console.log('\n收到的第一个请求：');
console.log('  ', JSON.stringify({ url:first?.url, body:first?.body?.slice(0,160) }, null, 0));
ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
