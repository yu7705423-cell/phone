// 生成视频：OpenAI 视频格式（/v1/videos）、中转站统一格式（/v1/video/generations）、
// 聊天接口出视频（/v1/chat/completions）三种接法，各自提交、查询、取回；设置页按类型显示字段
import { BASE, OUT, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
const MP4 = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0, 109, 112, 52, 50, 105, 115, 111, 109]);
const seen = [];
let polls = { openai: 0, unified: 0 };
let chatReply = '生成好了：[点击查看](https://cdn.example.com/c.mp4?sig=1)';
await ctx.route('**/relay.example.com/**', async route => {
  const req = route.request();
  const u = new URL(req.url());
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  seen.push({ m: req.method(), p: u.pathname, body, auth: req.headers().authorization || '' });
  const J = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
  if (req.headers().authorization !== 'Bearer k') return J({ error: { message: 'bad key' } }, 401);
  // OpenAI /v1/videos
  if (u.pathname === '/v1/videos' && req.method() === 'POST') return J({ id: 'video_1', object: 'video', status: 'queued' });
  if (u.pathname === '/v1/videos/video_1') return J({ id: 'video_1', status: ++polls.openai < 2 ? 'in_progress' : 'completed' });
  if (u.pathname === '/v1/videos/video_1/content') return route.fulfill({ status: 200, contentType: 'video/mp4', body: MP4 });
  // 中转站统一格式
  if (u.pathname === '/v1/video/generations' && req.method() === 'POST') return J({ task_id: 't1', status: 'queued' });
  if (u.pathname === '/v1/video/generations/t1') {
    return J(++polls.unified < 2 ? { task_id: 't1', status: 'processing' }
      : { task_id: 't1', status: 'succeeded', url: 'https://cdn.example.com/u.mp4', format: 'mp4' });
  }
  // 聊天接口
  if (u.pathname === '/v1/chat/completions') return J({ choices: [{ message: { role: 'assistant', content: chatReply } }] });
  if (u.pathname === '/v1/models') return J({ data: [{ id: 'veo3' }, { id: 'sora-2' }] });
  return J({ error: { message: 'not found' } }, 404);
});
await ctx.route('**/cdn.example.com/**', r => r.fulfill({ status: 200, contentType: 'video/mp4', body: MP4 }));
const page = await ctx.newPage();
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

const run = (preset, first = '') => page.evaluate(async ([p, f]) => {
  const v = await import('/src/system/ai/video.js');
  const states = [];
  try {
    const id = await v.submit({ prompt: '一只纸船漂在水面上', preset: p, first: f, key: `t:${Math.random()}` });
    const blob = await v.wait({ taskId: id, preset: p, onTick: r => states.push(r.state) });
    return { id, type: blob.type, size: blob.size, states };
  } catch (e) { return { error: e.message, states }; }
}, [preset, first]);
const base = { apiKey: 'k', baseUrl: 'https://relay.example.com/v1', pollEvery: 2, maxWait: 60 };

// ---- 一、OpenAI 视频格式 ----
let r = await run({ ...base, kind: 'openai', model: 'sora-2', duration: 8, size: '720x1280' });
const oPost = seen.find(s => s.p === '/v1/videos' && s.m === 'POST');
ok('OpenAI 格式：提交到 /v1/videos，seconds 是字符串，尺寸照填', oPost?.body?.model === 'sora-2'
  && oPost.body.seconds === '8' && oPost.body.size === '720x1280' && oPost.body.prompt, JSON.stringify(oPost?.body));
ok('排队、生成中，完成后从 /content 带着密钥取回视频', r.type === 'video/mp4' && r.size === MP4.length
  && r.states.includes('running') && seen.some(s => s.p === '/v1/videos/video_1/content' && s.auth === 'Bearer k'), JSON.stringify(r));
seen.length = 0;
await run({ ...base, kind: 'openai', model: 'sora-2', duration: 4 }, 'data:image/png;base64,AAAA');
ok('带首帧：input_reference 里放那张图', seen.find(s => s.p === '/v1/videos')?.body?.input_reference?.image_url === 'data:image/png;base64,AAAA');

// ---- 二、中转站统一格式 ----
seen.length = 0;
r = await run({ ...base, kind: 'unified', model: 'kling-v2', duration: 5, size: '1920x1080' });
const uPost = seen.find(s => s.p === '/v1/video/generations' && s.m === 'POST');
ok('统一格式：提交到 /v1/video/generations，宽高拆开', uPost?.body?.model === 'kling-v2' && uPost.body.duration === 5
  && uPost.body.width === 1920 && uPost.body.height === 1080, JSON.stringify(uPost?.body));
ok('processing 认成生成中，succeeded 之后从 url 取回', r.type === 'video/mp4' && r.states.includes('running') && r.states.includes('succeeded'), JSON.stringify(r));

// ---- 三、聊天接口出视频 ----
seen.length = 0;
r = await run({ ...base, kind: 'chat', model: 'veo3' });
const cPost = seen.find(s => s.p === '/v1/chat/completions');
ok('聊天格式：描述当成一句话发过去，不流式', cPost?.body?.model === 'veo3' && cPost.body.stream === false
  && cPost.body.messages?.[0]?.content === '一只纸船漂在水面上', JSON.stringify(cPost?.body));
ok('从回复里挑出视频链接取回来', r.type === 'video/mp4' && !r.error, JSON.stringify(r));
chatReply = '抱歉，这次没有生成成功。';
r = await run({ ...base, kind: 'chat', model: 'veo3' });
ok('回复里没有链接：照实报出来', /回复里没有视频链接/.test(r.error || ''), JSON.stringify(r));
const lost = await page.evaluate(async () => (await import('/src/system/ai/video.js')).look('chat-gone', { kind: 'chat' }));
ok('重开应用之后接不回来的那一段：说清楚为什么', lost.dead && /重新打开过/.test(lost.error), JSON.stringify(lost));

// ---- 四、没填地址的类型不算配好 ----
const ready = await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  const v = await import('/src/system/ai/video.js');
  const p = svc.newVideoPreset({ name: '中转', kind: 'unified', apiKey: 'k', model: 'kling-v2' });
  svc.setActiveVideo(p.id);
  const before = v.isVideoReady();
  svc.updateVideoPreset(p.id, { baseUrl: 'https://relay.example.com/v1' });
  return { before, after: v.isVideoReady(), id: p.id };
});
ok('统一格式没填地址时不算配好，填了才算', ready.before === false && ready.after === true, JSON.stringify(ready));

// ---- 五、设置页按类型显示字段；聊天那一类的自检不真的生成 ----
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('settings', '/video'); });
await page.waitForTimeout(700);
await page.locator('.list-item', { hasText: '中转' }).click();
await page.waitForTimeout(500);
let sheet = await page.locator('.sheet').last().innerText();
ok('统一格式：有尺寸与时长，没有海螺那几档分辨率与宽高比', /尺寸/.test(sheet) && !/宽高比/.test(sheet) && !/768P/.test(sheet), sheet.slice(0, 300));
await page.screenshot({ path: `${OUT}/videokinds-unified.png` });
await page.evaluate(async id => (await import('/src/system/ai/services.js')).updateVideoPreset(id, { kind: 'chat', model: 'veo3' }), ready.id);
await page.waitForTimeout(300);
sheet = await page.locator('.sheet').last().innerText();
ok('聊天格式：没有尺寸、没有查询间隔，写明中途关掉接不回来', !/尺寸/.test(sheet) && !/查询间隔/.test(sheet) && /接不回来/.test(sheet), sheet.slice(0, 400));
seen.length = 0;
await page.locator('.sheet button', { hasText: '自检' }).click();
await page.waitForTimeout(1200);
sheet = await page.locator('.sheet').last().innerText();
ok('聊天格式的自检只查模型列表，不提交生成', /自检通过/.test(sheet) && /不真的生成/.test(sheet) && seen.some(s => s.p === '/v1/models')
  && !seen.some(s => s.p === '/v1/chat/completions'), sheet.slice(-300));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
