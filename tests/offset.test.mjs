// 字幕偏移：读出来的时候才加，原文不动；看的时候能当场调
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const b = await chromium.launch({ executablePath:EXE,
  args:['--no-sandbox','--no-first-run','--autoplay-policy=no-user-gesture-required'] });
const page = await b.newPage({ viewport:{width:430,height:932}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const R=[]; const ok=(n,c,e)=>{R.push(!!c);console.log(`${c?'  ok   ':'  FAIL '}${n}${c?'':'   << '+(e??'')}`);};
await page.route('**/*', r => r.request().url().startsWith(`${BASE}`) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
await page.locator('.lock-unlock').click(); await page.waitForTimeout(400);

const SRT = `1
00:00:10,000 --> 00:00:12,000
第一句

2
00:00:20,000 --> 00:00:22,000
第二句`;

console.log('-- 一、偏移只在读的时候加');
const r1 = await page.evaluate(async srt => {
  const v = await import('/src/system/video.js');
  const row = v.addVideo({ title:'某部片', url:'blob:x', subtitle: srt });
  const before = v.linesOf(row).map(l => l.at);
  v.updateVideo(row.id, { offset: -2.5 });
  const after = v.linesOf(v.get(row.id)).map(l => l.at);
  return { id: row.id, before, after, raw: v.get(row.id).subtitle.includes('00:00:10,000') };
}, SRT);
console.log(' ', JSON.stringify(r1));
ok('原来是 10 和 20 秒', JSON.stringify(r1.before)==='[10,20]', JSON.stringify(r1.before));
ok('偏移 -2.5 之后是 7.5 和 17.5', JSON.stringify(r1.after)==='[7.5,17.5]', JSON.stringify(r1.after));
ok('字幕原文一个字没动', r1.raw===true);

console.log('-- 二、边界');
const r2 = await page.evaluate(async id => {
  const v = await import('/src/system/video.js');
  const out = {};
  v.updateVideo(id, { offset: -30 });            // 偏到零之前
  out.clamped = v.linesOf(v.get(id)).map(l => l.at);
  v.updateVideo(id, { offset: 999 });            // 超出上限
  out.max = v.get(id).offset;
  v.updateVideo(id, { offset: 1.23 });           // 取整到十分之一秒
  out.round = v.get(id).offset;
  v.updateVideo(id, { offset: 0 });
  return out;
}, r1.id);
console.log(' ', JSON.stringify(r2));
ok('偏到零之前的夹在 0 上', JSON.stringify(r2.clamped)==='[0,0]', JSON.stringify(r2.clamped));
ok('上限一分钟', r2.max===60, String(r2.max));
ok('取整到十分之一秒', r2.round===1.2, String(r2.round));

console.log('-- 三、看的时候当场调');
const ids = await page.evaluate(async id => {
  const db = await import('/src/system/db/index.js');
  const w = await import('/src/system/watch.js');
  const c = db.characters.create({ name:'阿岚', persona:'x' });
  const chat = db.chats.create({ characterIds:[c.id] });
  w.start({ chatId: chat.id, videoId: id });
  w.watch.set({ at: 11 });
  // 播放页已经从 chat 拆到 theater 那个 app 里去了
  const nav = await import('/src/system/nav.js'); nav.openApp('theater', `/watch/${chat.id}`);
  return { chat: chat.id };
}, r1.id);
await page.waitForTimeout(900);
console.log('  对轴条:', (await page.locator('.wt-sync').innerText().catch(()=>'(无)')).replace(/\n/g,' '));
ok('对轴条出来了', await page.locator('.wt-sync').count()===1);
console.log('  第 11 秒的字幕:', await page.locator('.wt-cue').innerText().catch(()=>'(无)'));
ok('这一刻正显示第一句', (await page.locator('.wt-cue').innerText().catch(()=>''))==='第一句');
await page.locator('.wt-sync button', {hasText:'推迟'}).click();
await page.waitForTimeout(400);
await page.locator('.wt-sync button', {hasText:'推迟'}).click();
await page.waitForTimeout(500);
const after = await page.evaluate(async id => {
  const v = await import('/src/system/video.js');
  return { offset: v.get(id).offset, at: v.linesOf(v.get(id))[0].at };
}, r1.id);
console.log(' ', JSON.stringify(after), '屏幕上:', (await page.locator('.wt-sync b').innerText()));
ok('点两下推迟就是 +1 秒', after.offset===1, String(after.offset));
ok('第一句跟着挪到 11 秒', after.at===11, String(after.at));
ok('屏幕上写着 +1 秒', (await page.locator('.wt-sync b').innerText())==='+1 秒',
  await page.locator('.wt-sync b').innerText());
// 再推迟四秒：第一句挪到 15 秒，此刻（11 秒）就不该有字幕了
for (let i = 0; i < 8; i++) {
  await page.locator('.wt-sync button', {hasText:'推迟'}).click();
  await page.waitForTimeout(120);
}
await page.waitForTimeout(600);
console.log('  推到 +5 秒后这一刻的字幕:', await page.locator('.wt-cue').innerText().catch(()=>'(没有)'));
ok('推过头之后这一刻就没字幕了', (await page.locator('.wt-cue').count())===0,
  await page.locator('.wt-cue').innerText().catch(()=>''));
await page.screenshot({path:`${OUT}/wt-sync.png`});
await page.locator('.wt-sync button', {hasText:'归零'}).click();
await page.waitForTimeout(500);
ok('归零归得掉', (await page.evaluate(async id =>
  (await import('/src/system/video.js')).get(id).offset, r1.id))===0);

if (errs.length) console.log('\n报错:\n'+errs.join('\n'));
await b.close();
const bad=R.filter(x=>!x).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
