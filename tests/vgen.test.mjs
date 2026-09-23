// 生成视频：提交拿 task_id、轮询、取回来存下、重开也接着等
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const fs = await import('node:fs/promises');
const CLIP = await fs.readFile(`${OUT}/clip-test.webm`);
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// 假的 MiniMax：第一次问在排队，第二次在跑，第三次成了
let asked = 0; const seen = [];
await ctx.route('**/relay.example.com/**', async route => {
  const req = route.request(); const url = req.url();
  seen.push({ url, method: req.method(), body: req.postData() || '' });
  if (url.includes('/v2/video_generation')) {
    return route.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ task_id: '424010985738629' }) });
  }
  if (url.includes('/v2/query/video_generation/')) {
    asked++;
    const st = asked === 1 ? 'queued' : asked === 2 ? 'running' : 'succeeded';
    const task = { id:'424010985738629', model:'MiniMax-H3', status: st, duration: 5, ratio:'16:9' };
    if (st === 'succeeded') task.content = { url: 'https://cdn.example.com/out.webm' };
    return route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ task }) });
  }
  return route.fulfill({ status:404, body:'' });
});
await ctx.route('**/cdn.example.com/**', route =>
  route.fulfill({ status:200, contentType:'video/webm', body: CLIP }));

await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1600);

const ids = await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  const svc=(await import('/src/system/ai/services.js'));
  const p = svc.newVideoPreset({ name:'中转' });
  svc.updateVideoPreset(p.id, { baseUrl:'https://relay.example.com', apiKey:'sk-x',
    model:'MiniMax-H3', resolution:'768P', duration:5, ratio:'16:9', pollEvery:2, maxWait:120 });
  svc.setActiveVideo(p.id);
  const ch = db.characters.create({ name:'桐生' });
  const chat = db.chats.create({ characterIds:[ch.id], personaId:'me', title:'桐生' });
  return { preset: p.id, ch: ch.id, chat: chat.id };
});

// ---- 配置层 ----
const cfg = await page.evaluate(async () => {
  const v=(await import('/src/system/ai/video.js'));
  return { ready: v.isVideoReady(), res2k: v.resOk('MiniMax-H3','2K'),
    resMax2k: v.resOk('MiniMax-H3-Max','2K'), unknown: v.resOk('别人家的模型','2K'),
    every: v.everyOf({pollEvery:2}), wait0: v.waitOf({maxWait:0}), waitDef: v.waitOf({}) };
});
ok('填全了就算配好', cfg.ready === true);
ok('H3 认 2K，H3-Max 不认', cfg.res2k === true && cfg.resMax2k === false, JSON.stringify(cfg));
ok('自己填的模型一律放行（表是备选不是上限）', cfg.unknown === true);
ok('最长等待填 0 就是一直等', cfg.wait0 === 0 && cfg.waitDef === 600, JSON.stringify(cfg));

// ---- 提交 + 轮询 + 取回 ----
const msgId = await page.evaluate(async (chatId) => {
  const db=(await import('/src/system/db/index.js'));
  const reply=(await import('/src/system/ai/reply.js'));
  const m = db.messages.create({ chatId, role:'user', authorId:'me', kind:'clip',
    prompt:'一只猫走过屋顶', content:'[视频：一只猫走过屋顶]', status:'done', media:'pending' });
  reply.generateClip(m.id, '一只猫走过屋顶');
  return m.id;
}, ids.chat);
await page.waitForTimeout(1200);
const mid = await page.evaluate(async (id) => {
  const db=(await import('/src/system/db/index.js'));
  const m = db.messages.get(id);
  return { task: m.clipTask, state: m.clipState, media: m.media };
}, msgId);
ok('提交完立刻把 task_id 写回消息', mid.task === '424010985738629', JSON.stringify(mid));
ok('等的时候把状态也写回去', ['queued','running'].includes(mid.state), JSON.stringify(mid));

await page.waitForTimeout(7000);
const fin = await page.evaluate(async (id) => {
  const db=(await import('/src/system/db/index.js'));
  const m = db.messages.get(id);
  return { media:m.media, hasClip:!!m.clipId, hasPoster:!!m.posterId, dur:m.clipDur,
    bytes: db.files.info(m.clipId)?.bytes || 0, err:m.mediaError||'' };
}, msgId);
ok('跑完之后视频存进了本地', fin.media === 'done' && fin.hasClip && fin.bytes > 500, JSON.stringify(fin));
ok('顺手取了一帧当海报', fin.hasPoster === true, JSON.stringify(fin));

// ---- 发出去的请求长什么样 ----
const post = seen.find(x => x.method === 'POST');
const body = JSON.parse(post?.body || '{}');
ok('提交走 POST /v2/video_generation', /\/v2\/video_generation$/.test(post?.url || ''), post?.url);
ok('画面描述放在 content 的 text 里',
  body.content?.[0]?.type === 'text' && /一只猫/.test(body.content[0].text), JSON.stringify(body).slice(0,200));
ok('分辨率、时长、宽高比都带上了',
  body.resolution === '768P' && body.duration === 5 && body.ratio === '16:9', JSON.stringify(body));
const gets = seen.filter(x => x.method === 'GET');
ok('轮询走 GET /v2/query/video_generation/{task_id}',
  gets.length >= 3 && gets.every(g => /\/v2\/query\/video_generation\/424010985738629$/.test(g.url)),
  gets.map(g=>g.url).join(' | ').slice(0,200));

// ---- 失败要照实说 ----
const bad = await page.evaluate(async (chatId) => {
  const db=(await import('/src/system/db/index.js'));
  const v=(await import('/src/system/ai/video.js'));
  const svc=(await import('/src/system/ai/services.js'));
  // 换一个会回 failed 的地址
  const p = svc.newVideoPreset({ name:'会失败的' });
  svc.updateVideoPreset(p.id, { baseUrl:'https://fail.example.com', apiKey:'sk-x',
    model:'MiniMax-H3', pollEvery:2, maxWait:60 });
  try {
    const r = await v.look('x', svc.videoPresets().find(q=>q.id===p.id));
    return r;
  } catch (e) { return { err: String(e.message||e) }; }
}, ids.chat);
ok('连不上时说的是「连不上视频接口」，不是一句含糊的失败',
  /连不上视频接口/.test(bad.err || ''), JSON.stringify(bad).slice(0,200));

// ---- 重开应用接着等 ----
const resumed = await page.evaluate(async (chatId) => {
  const db=(await import('/src/system/db/index.js'));
  const reply=(await import('/src/system/ai/reply.js'));
  // 造一条「提交过但没等完」的
  const m = db.messages.create({ chatId, role:'user', authorId:'me', kind:'clip',
    prompt:'接着等', content:'[视频：接着等]', status:'done', media:'pending',
    clipTask:'424010985738629', clipPreset:'' });
  reply.resumeClips();
  return m.id;
}, ids.chat);
await page.waitForTimeout(6000);
const rs = await page.evaluate(async (id) => {
  const db=(await import('/src/system/db/index.js'));
  const m = db.messages.get(id);
  return { media:m.media, hasClip:!!m.clipId, err:m.mediaError||'' };
}, resumed);
ok('重开之后没等完的接着等，不重新提交', rs.media === 'done' && rs.hasClip === true, JSON.stringify(rs));
const posts = seen.filter(x => x.method === 'POST');
ok('接着等的那一条一次都没有重新提交', posts.length === 1, `POST 次数 ${posts.length}`);

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad2=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad2}/${R.length} 通过`);
process.exit(bad2?1:0);
