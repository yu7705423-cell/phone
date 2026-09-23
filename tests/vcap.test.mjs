// 角色发视频：默认关着、登记在账上、标记解析、落成一条消息
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};
const posts=[];
await ctx.route('**/relay.example.com/**', async route => {
  const u = route.request().url();
  if (u.includes('/v2/video_generation')) { posts.push(u);
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({task_id:'t1'})}); }
  return route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({task:{id:'t1',status:'running'}})});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1600);

// ---- 默认关着 ----
const def = await page.evaluate(async () => {
  const d=(await import('/src/system/db/defaults.js'));
  const c=(await import('/src/system/ai/cost.js'));
  const row = c.EXTRA_CALLS.find(x => x.id === 'videoOn');
  return { dflt: d.DEFAULT_SETTINGS.videoOn, listed: !!row,
    offValue: row?.off, setting: row?.setting };
});
ok('DEFAULT_SETTINGS 里默认关着', def.dflt === false, JSON.stringify(def));
ok('登记在 EXTRA_CALLS 里', def.listed === true && def.setting === 'videoOn', JSON.stringify(def));
ok('登记的「关」就是 false', def.offValue === false, JSON.stringify(def));

// ---- 标记解析 ----
const parsed = await page.evaluate(async () => {
  const r=(await import('/src/system/ai/reply.js'));
  const p = r.splitReply('看这个\n[视频：一只猫走过屋顶，尾巴甩了一下]\n好看吧');
  return p.map(x => ({ t:x.type, v:x.prompt || x.text || '' }));
});
ok('[视频：…] 被认出来，切成单独一条',
  parsed.some(x => x.t === 'clip' && /一只猫/.test(x.v)), JSON.stringify(parsed));
ok('前后的正文没被它吞掉',
  parsed.filter(x => x.t === 'text').length === 2, JSON.stringify(parsed));

// ---- 关着的时候不进 prompt ----
const capOff = await page.evaluate(async () => {
  const svc=(await import('/src/system/ai/services.js'));
  const db=(await import('/src/system/db/index.js'));
  const p = svc.newVideoPreset({ name:'中转' });
  svc.updateVideoPreset(p.id, { baseUrl:'https://relay.example.com', apiKey:'sk-x',
    model:'MiniMax-H3', pollEvery:2, maxWait:30 });
  svc.setActiveVideo(p.id);
  const caps=(await import('/src/system/ai/capabilities.js'));
  const ch = db.characters.create({ name:'桐生' });
  const row = caps.CAPS.find(c => c.id === 'video');
  const off = row.on({ char: ch, settings: db.settings.get() });
  db.settings.set({ videoOn: true });
  const on = row.on({ char: ch, settings: db.settings.get() });
  const noChar = row.on({ char: { ...ch, canSendVideo: false }, settings: db.settings.get() });
  return { off, on, noChar, chId: ch.id };
});
ok('关着时这项能力不给角色', capOff.off === false, JSON.stringify(capOff));
ok('打开之后才给', capOff.on === true, JSON.stringify(capOff));
ok('角色卡上单独关掉也不给', capOff.noChar === false, JSON.stringify(capOff));

// ---- 落成一条消息并排上生成 ----
const made = await page.evaluate(async (chId) => {
  const db=(await import('/src/system/db/index.js'));
  const r=(await import('/src/system/ai/reply.js'));
  const chat = db.chats.create({ characterIds:[chId], personaId:'me', title:'桐生' });
  const msg = r.materialize({ type:'clip', prompt:'一只猫走过屋顶' },
    { chatId: chat.id, role:'char', authorId: chId, status:'done' }, db.characters.get(chId));
  return { kind: msg.kind, content: msg.content, media: msg.media, prompt: msg.prompt };
}, capOff.chId);
ok('落成一条 kind=clip 的消息', made.kind === 'clip' && made.media === 'pending', JSON.stringify(made));
ok('content 写的是 [视频：…] 那个标记（库里几万条历史靠它对位）',
  /^\[视频：一只猫走过屋顶\]$/.test(made.content), made.content);
await page.waitForTimeout(1500);
ok('真的把生成排上了', posts.length === 1, `POST 次数 ${posts.length}`);

// ---- 模板是英文的 ----
const tpl = await page.evaluate(async () => {
  const t=(await import('/src/system/ai/templates.js'));
  return t.template('skeleton.video');
});
ok('模板正文是英文（第 14 条）', !/[一-龥]{4,}/.test(tpl.replace(/\[视频[^\]]*\]/g,'')), tpl.slice(0,120));
ok('方括号标记留在中文（它是协议）', /\[视频：/.test(tpl), tpl.slice(0,80));

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
