// 退出播放页之后：这一场怎么算、prompt 怎么说、会话上看不看得见
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const b = await chromium.launch({ executablePath:EXE, args:['--no-sandbox','--no-first-run'] });
const page = await b.newPage({ viewport:{width:430,height:932}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const R=[]; const ok=(n,c,e)=>{R.push(!!c);console.log(`${c?'  ok   ':'  FAIL '}${n}${c?'':'   << '+(e??'')}`);};
await page.route('**/*', r => r.request().url().startsWith(`${BASE}`) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
await page.locator('.lock-unlock').click(); await page.waitForTimeout(400);

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const v = await import('/src/system/video.js');
  const c = db.characters.create({ name:'阿岚', persona:'x' });
  const chat = db.chats.create({ characterIds:[c.id] });
  const row = v.addVideo({ title:'某部片', url:'blob:x', seconds: 6000,
    subtitle:'1\n00:10:00,000 --> 00:10:02,000\n那句台词\n' });
  const w = await import('/src/system/watch.js');
  w.start({ chatId: chat.id, videoId: row.id });
  // 播放页已经从 chat 拆到 theater 那个 app 里去了
  const nav = await import('/src/system/nav.js'); nav.openApp('theater', `/watch/${chat.id}`);
  await new Promise(r => setTimeout(r, 700));
  w.watch.set({ at: 600, playing: true });
  return { chat: chat.id };
});
await page.waitForTimeout(500);

console.log('-- 一、退出播放页');
const left = await page.evaluate(async () => {
  const nav = await import('/src/system/nav.js');
  const w = await import('/src/system/watch.js');
  const blk = await import('/src/system/ai/context/watch.js');
  // 离开前那一刻的进度。测试里没有真视频，attach 的每秒一跳会把 at 按
  // currentTime 归零，所以比的是「离开前后一致」，不是某个具体数字
  const before = w.watch.get().at;
  nav.pop();
  await new Promise(r => setTimeout(r, 800));
  const s = w.watch.get();
  return { active: s.active, playing: s.playing, away: !!s.awayAt, at: s.at, before,
    text: blk.build().split('\n').filter(l => /paused|position/i.test(l)).join(' / ') };
});
console.log(' ', JSON.stringify(left));
ok('这一场还在（中途回消息不该断）', left.active===true);
ok('但状态改成暂停了', left.playing===false);
ok('记下了人已离开', left.away===true);
ok('prompt 里说明了人不在播放页', /stepped away/i.test(left.text), left.text);
ok('进度冻在离开那一刻，之后不再动', left.at===left.before, `${left.at} vs ${left.before}`);

console.log('-- 二、会话顶上留了一条，回得去也收得掉');
await page.evaluate(async ids => {
  // 从播放页出来之后当前 app 已经不是 chat 了，要指明开哪一个
  const nav = await import('/src/system/nav.js'); nav.openApp('chat', `/chat/${ids.chat}`);
}, ids);
await page.waitForTimeout(800);
const bar = await page.locator('.listen-bar').innerText().catch(()=>'(没有)');
console.log('  那一条:', bar.replace(/\n/g,' '));
ok('会话上看得见', bar.includes('某部片'), bar);
ok('写明了已暂停', bar.includes('已暂停'), bar);
await page.screenshot({path:`${OUT}/away-bar.png`});

console.log('-- 三、回得去');
await page.locator('.listen-main').click();
await page.waitForTimeout(900);
const back = await page.evaluate(async () => {
  const w = await import('/src/system/watch.js');
  const nav = await import('/src/system/nav.js');
  return { route: nav.currentRoute(), away: !!w.watch.get().awayAt };
});
console.log(' ', JSON.stringify(back));
ok('点一下回到播放页', back.route.startsWith('/watch/'), back.route);
ok('回来之后不再算离开', back.away===false);

console.log('-- 四、离开太久自动收场');
const swept = await page.evaluate(async ids => {
  const w = await import('/src/system/watch.js');
  const db = await import('/src/system/db/index.js');
  const blk = await import('/src/system/ai/context/watch.js');
  const nav = await import('/src/system/nav.js');
  nav.pop();
  await new Promise(r => setTimeout(r, 600));
  w.watch.set({ seconds: 900 });
  // 把离开时刻往前推二十分钟
  w.watch.set({ awayAt: Date.now() - 20 * 60000 });
  const text = blk.build();
  const s = w.watch.get();
  const last = db.messagesOf(ids.chat).slice(-1)[0];
  return { text, active: s.active, kind: last?.kind, content: last?.content };
}, ids);
console.log('  收场后 prompt 里那一段:', JSON.stringify(swept.text));
console.log('  落的那一条:', JSON.stringify(swept.content));
ok('这一段不再注入', swept.text==='', swept.text.slice(0,40));
ok('这一场关掉了', swept.active===false);
ok('照样落了记录', swept.kind==='watch' && swept.content.includes('15 分钟'), String(swept.content));

console.log('-- 五、填 0 就一直留着');
const keep = await page.evaluate(async ids => {
  const w = await import('/src/system/watch.js');
  const db = await import('/src/system/db/index.js');
  const blk = await import('/src/system/ai/context/watch.js');
  db.settings.set({ watchAwayEnd: 0 });
  w.start({ chatId: ids.chat, videoId: db.videos.all()[0].id });
  w.watch.set({ at: 300, awayAt: Date.now() - 5 * 3600000 });   // 离开五小时
  const still = /watching .* together/i.test(blk.build());
  db.settings.set({ watchAwayEnd: 15 });
  w.stop();
  return { still };
}, ids);
ok('填 0 时离开五小时也不收场', keep.still===true);

if (errs.length) console.log('\n报错:\n'+errs.join('\n'));
await b.close();
const bad=R.filter(x=>!x).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
