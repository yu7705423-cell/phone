// [视频：…] 不许掉到别的分支去；端点不许被 base 上的版本号带歪
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});
const hit=[];
await ctx.route('**/*.example.com/**', r => { hit.push(r.request().url());
  return r.fulfill({status:200,contentType:'application/json',body:'{"task_id":"t"}'}); });
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1600);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// ---- 标记走哪条分支 ----
const parsed = await page.evaluate(async () => {
  const r=(await import('/src/system/ai/reply.js'));
  const one = s => r.splitReply(s).map(p => p.type);
  return {
    zh: one('[视频：一只猫走过]'),
    en: one('[video：a cat walking]'),
    full: one('【视频：一只猫】'),
    half: one('[视频:一只猫]'),
    img: one('[图片：一只猫]'),
    voice: one('[语音：你好]'),
  };
});
ok('[视频：…] 走视频', parsed.zh.join() === 'clip', JSON.stringify(parsed.zh));
ok('[video：…] 也走视频，不掉进语音',
  parsed.en.join() === 'clip', JSON.stringify(parsed.en));
ok('全角括号那种也走视频', parsed.full.join() === 'clip', JSON.stringify(parsed.full));
ok('半角冒号那种也走视频', parsed.half.join() === 'clip', JSON.stringify(parsed.half));
ok('图片还是走图片，语音还是走语音',
  parsed.img.join() === 'image' && parsed.voice.join() === 'voice', JSON.stringify(parsed));

// ---- 端点 ----
await page.evaluate(async () => {
  const svc=(await import('/src/system/ai/services.js'));
  const v=(await import('/src/system/ai/video.js'));
  for (const base of ['https://a.example.com', 'https://b.example.com/v1',
    'https://c.example.com/v2', 'https://d.example.com/v1/']) {
    const p = svc.newVideoPreset({ name: base });
    svc.updateVideoPreset(p.id, { baseUrl: base, apiKey:'k', model:'MiniMax-H3' });
    try { await v.submit({ prompt:'x', preset: svc.videoPresets().find(q=>q.id===p.id), key:'k'+base }); } catch(e){}
  }
});
await page.waitForTimeout(800);
ok('不管 base 上带不带版本号，都打到 /v2/video_generation',
  hit.length === 4 && hit.every(u => /\/v2\/video_generation$/.test(u)), hit.join(' | '));
ok('base 上原来那个 /v1 没有被留下',
  !hit.some(u => /\/v1\//.test(u)), hit.join(' | '));

// ---- 关着的时候，那一页要说明白角色为什么不发 ----
await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  db.settings.set({ videoOn: false });
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('settings','/'); n.popToRoot(); n.push('/video');
});
await page.waitForTimeout(900);
const off = await page.locator('.page-body').innerText();
ok('配了接口但开关关着时，那一页说明了角色为什么改发图片',
  /角色不会主动发送视频/.test(off) && /改为发送图片/.test(off), off.slice(0, 220));
ok('并且指明了开关在哪儿', /用量与上限/.test(off), off.slice(0, 220));
await page.screenshot({path:`${OUT}/vroute.png`});

await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  db.settings.set({ videoOn: true });
});
await page.waitForTimeout(700);
const on = await page.locator('.page-body').innerText();
ok('开了之后那段话就不再出现', !/角色不会主动发送视频/.test(on), on.slice(0, 150));

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
