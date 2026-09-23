// 一起看：字幕解析、提纲截断防剧透、节奏判断、播放控制标记
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
00:00:05,000 --> 00:00:07,000
你来了

2
00:00:08,000 --> 00:00:10,000
嗯，路上堵车

3
00:00:11,000 --> 00:00:13,000
先坐吧

4
00:00:14,000 --> 00:00:16,000
我有件事要说

5
00:00:17,000 --> 00:00:19,000
你说

6
00:00:20,000 --> 00:00:22,000
我要走了

7
00:02:30,000 --> 00:02:33,000
后来他真的走了

8
00:02:35,000 --> 00:02:38,000
再也没有回来`;

console.log('-- 一、字幕解析');
const sub = await page.evaluate(async srt => {
  const s = await import('/src/system/subtitle.js');
  const srtLines = s.parse(srt);
  const ass = s.parse(`[Script Info]\n[Events]\nFormat: Layer, Start, End, Style, Name, Text\nDialogue: 0,0:00:05.00,0:00:07.00,Def,,{\\an8}你来了\nDialogue: 0,0:00:08.00,0:00:10.00,Def,,嗯\\N路上堵车`);
  const vtt = s.parse('WEBVTT\n\n00:00:05.000 --> 00:00:07.000\n<i>你来了</i>');
  return {
    srt: srtLines.length, first: srtLines[0],
    ass: ass.map(x=>x.text), vtt: vtt.map(x=>x.text),
    // cueAt 返回的是整条 cue，不是一个字符串
    at6: s.cueAt(srtLines, 6)?.text ?? '', at100: s.cueAt(srtLines, 100)?.text ?? '',
    recent: s.recentLines(srtLines, 18, 3).map(x=>x.text),
    stamp: [s.stamp(125), s.stamp(3725)],
    toSec: [s.toSeconds('2:05'), s.toSeconds('1:02:05'), s.toSeconds('abc')],
  };
}, SRT);
console.log(' ', JSON.stringify(sub));
ok('SRT 八句都解出来', sub.srt===8, String(sub.srt));
ok('ASS 的样式块和换行处理掉了', JSON.stringify(sub.ass)==='["你来了","嗯 路上堵车"]', JSON.stringify(sub.ass));
ok('VTT 的标签也去掉了', JSON.stringify(sub.vtt)==='["你来了"]', JSON.stringify(sub.vtt));
ok('第 6 秒正在说「你来了」', sub.at6==='你来了', sub.at6);
ok('没有台词的时刻给空', sub.at100==='', JSON.stringify(sub.at100));
ok('取最近三句', JSON.stringify(sub.recent)==='["先坐吧","我有件事要说","你说"]', JSON.stringify(sub.recent));
ok('时间戳两种写法', JSON.stringify(sub.stamp)==='["2:05","1:02:05"]', JSON.stringify(sub.stamp));
ok('反过来也读得回来', JSON.stringify(sub.toSec)==='[125,3725,null]', JSON.stringify(sub.toSec));

console.log('-- 二、节奏：密的时候闭嘴，空窗才开口');
const den = await page.evaluate(async srt => {
  const s = await import('/src/system/subtitle.js');
  const lines = s.parse(srt);
  return { talky: s.density(lines, 14), quiet: s.density(lines, 90) };
}, SRT);
console.log('  第 14 秒（对手戏里）:', JSON.stringify(den.talky));
console.log('  第 90 秒（空窗）:', JSON.stringify(den.quiet));
ok('对手戏正密时判为密', den.talky.talky===true && den.talky.quiet===false, JSON.stringify(den.talky));
ok('长时间没台词判为静', den.quiet.quiet===true && den.quiet.talky===false, JSON.stringify(den.quiet));

console.log('-- 三、片库与一起看');
const ids = await page.evaluate(async srt => {
  const db = await import('/src/system/db/index.js');
  const v = await import('/src/system/video.js');
  const c = db.characters.create({ name:'阿岚', persona:'二十二岁，美院大三' });
  const chat = db.chats.create({ characterIds:[c.id] });
  const row = v.addVideo({ title:'某部片', url:'blob:fake', subtitle: srt, seconds: 180 });
  // 整片提纲：两段，第二段在 2:30 之后
  v.updateVideo(row.id, { outline: [
    { from: 0, to: 150, text:'两个人在屋里说话，其中一个说要走。' },
    { from: 150, to: 180, text:'他真的走了，再也没有回来。' },
  ]});
  return { chat: chat.id, char: c.id, video: row.id };
}, SRT);
await page.evaluate(async ids => {
  // 播放页已经从 chat 拆到 theater 那个 app 里去了
  const nav = await import('/src/system/nav.js'); nav.openApp('theater', `/watch/${ids.chat}`);
}, ids);
await page.waitForTimeout(800);
console.log('  选片页:', (await page.locator('.li-title').allInnerTexts()).join(' / '));
ok('片库里那部列出来了', (await page.locator('.li-title').allInnerTexts()).includes('某部片'));
await page.screenshot({path:`${OUT}/wt-pick.png`});

console.log('-- 四、提纲按进度截断，不剧透');
const cut = await page.evaluate(async ids => {
  const w = await import('/src/system/watch.js');
  const ctxBlock = await import('/src/system/ai/context/watch.js');
  w.start({ chatId: ids.chat, videoId: ids.video });
  w.watch.set({ at: 20, playing: true });
  const early = ctxBlock.build();
  w.watch.set({ at: 170 });
  const late = ctxBlock.build();
  return { early, late };
}, ids);
console.log('\n---- 看到 0:20 时，她读到的 ----');
console.log(cut.early);
ok('前二十秒读得到第一段', cut.early.includes('两个人在屋里说话'));
ok('后面那一段一个字都没漏', !cut.early.includes('再也没有回来'),
  '（剧透了）');
ok('台词给到当前为止', cut.early.includes('我要走了') && !cut.early.includes('后来他真的走了'));
ok('写明了是第一次看', /first time/i.test(cut.early));
ok('演到之后就给得出后一段', cut.late.includes('再也没有回来'));

console.log('-- 五、看过的那一档');
const seen = await page.evaluate(async ids => {
  const db = await import('/src/system/db/index.js');
  const ctxBlock = await import('/src/system/ai/context/watch.js');
  db.characters.update(ids.char, { watchedBefore: true });
  return ctxBlock.build();
}, ids);
ok('开了「看过」就换一句话', /seen this film before/i.test(seen) && !/first time/i.test(seen),
  seen.split('\n').find(l=>l.includes('看过')) || '');

console.log('-- 六、该不该开口');
const due = await page.evaluate(async () => {
  const w = await import('/src/system/watch.js');
  const db = await import('/src/system/db/index.js');
  db.settings.set({ watchGap: 90 });
  const out = {};
  w.watch.set({ at: 14, playing: true, saidAt: -1 });   // 才刚开始
  out.tooEarly = w.due();
  w.watch.set({ at: 14, playing: true, saidAt: 0 });    // 间隔不够
  out.notYet = w.due();
  w.watch.set({ at: 100, playing: true, saidAt: 0 });   // 间隔够了，而且空窗
  out.quiet = w.due();
  w.watch.set({ at: 14, playing: true, saidAt: -80 });  // 间隔刚够但正演对手戏
  out.talky = w.due();
  w.watch.set({ at: 100, playing: false, saidAt: 0 });  // 暂停着
  out.paused = w.due();
  db.settings.set({ watchGap: 0 });
  w.watch.set({ at: 100, playing: true, saidAt: 0 });
  out.off = w.due();
  db.settings.set({ watchGap: 90 });
  return out;
});
console.log(' ', JSON.stringify(due));
ok('刚开场不说', due.tooEarly===false);
ok('间隔没到不说', due.notYet===false);
ok('空窗且间隔够了才说', due.quiet===true);
ok('对手戏正密时再等一轮', due.talky===false);
ok('暂停着不说', due.paused===false);
ok('间隔填 0 就完全不自行开口', due.off===false);

console.log('-- 七、播放控制的标记');
const marks = await page.evaluate(async ids => {
  const reply = await import('/src/system/ai/reply.js');
  const w = await import('/src/system/watch.js');
  const parts = reply.splitReply('[暂停]\n等一下\n[倒回：0:05]\n刚那句没听清');
  // 假一个 <video> 挂上去，看标记有没有真的作用到播放器
  const el = document.createElement('video');
  Object.defineProperty(el, 'duration', { value: 180 });
  el.play = () => Promise.resolve();
  el.pause = () => {};
  w.attach(el);
  for (const p of parts) reply.materialize(p, { chatId: ids.chat, role:'char', authorId: ids.char }, null);
  await new Promise(r => setTimeout(r, 300));
  const st = w.watch.get();
  w.detach();
  return { parts: parts.map(p => p.type + (p.act ? ':'+p.act : '')), at: st.at, playing: st.playing, cur: el.currentTime };
}, ids);
console.log(' ', JSON.stringify(marks));
ok('三种标记都认出来了',
  JSON.stringify(marks.parts)==='["playback:pause","text","playback:seek","text"]', JSON.stringify(marks.parts));
ok('倒回真的改了播放位置', marks.cur===5, String(marks.cur));
ok('暂停也落到了状态上', marks.playing===false, String(marks.playing));

console.log('-- 八、收场');
const rec = await page.evaluate(async ids => {
  const w = await import('/src/system/watch.js');
  const db = await import('/src/system/db/index.js');
  w.watch.set({ seconds: 754, at: 170 });
  const m = w.stop();
  return { content: m?.content, kind: m?.kind, totals: w.totals(ids.chat), active: w.watch.get().active };
}, ids);
console.log(' ', JSON.stringify(rec));
ok('落了一条记录', rec.kind==='watch' && rec.content.includes('12 分钟'), JSON.stringify(rec.content));
ok('累积加在会话上', rec.totals.seconds===754 && rec.totals.count===1, JSON.stringify(rec.totals));
ok('收场后这一场就关了', rec.active===false);

if (errs.length) console.log('\n报错:\n'+errs.join('\n'));
await b.close();
const bad=R.filter(x=>!x).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
