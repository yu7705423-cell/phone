// 从 MP4 自带的字幕轨里读台词
import { BASE, OUT, EXE, chromium, FIX } from './_env.mjs';
import { readFileSync } from 'node:fs';
const b = await chromium.launch({ executablePath:EXE,
  args:['--no-sandbox','--no-first-run'] });
const page = await b.newPage({ viewport:{width:430,height:932}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const R=[]; const ok=(n,c,e)=>{R.push(!!c);console.log(`${c?'  ok   ':'  FAIL '}${n}${c?'':'   << '+(e??'')}`);};
await page.route('**/*', r => r.request().url().startsWith(`${BASE}`) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
await page.locator('.lock-unlock').click(); await page.waitForTimeout(400);

const mp4 = readFileSync(`${FIX}/sample.mp4`).toString('base64');

console.log('-- 一、直接拆一个真·MP4');
const got = await page.evaluate(async b64 => {
  const m = await import('/src/system/mp4subs.js');
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const blob = new Blob([bin], { type: 'video/mp4' });
  const tracks = await m.extract(blob);
  return { tracks: tracks.length, t0: tracks[0], srt: tracks[0] ? m.toSrt(tracks[0].lines) : '' };
}, mp4);
console.log('  轨数:', got.tracks, ' 格式:', got.t0?.format, ' 语言:', got.t0?.lang);
console.log('  句子:', JSON.stringify(got.t0?.lines));
ok('找到一条字幕轨', got.tracks===1, String(got.tracks));
ok('认出是 tx3g', got.t0?.format==='tx3g', got.t0?.format);
ok('语言码读出来了', got.t0?.lang==='chi', got.t0?.lang);
ok('三句都在', got.t0?.lines.length===3, String(got.t0?.lines.length));
ok('时间轴对得上', JSON.stringify(got.t0?.lines.map(l=>[l.at,l.end]))==='[[1,3],[4,6.5],[8,10]]',
  JSON.stringify(got.t0?.lines.map(l=>[l.at,l.end])));
ok('正文没乱码', got.t0?.lines[1].text==='嗯，路上堵车', got.t0?.lines[1].text);
console.log('  写成 SRT:\n' + got.srt.split('\n').map(l=>'    '+l).join('\n'));
ok('SRT 写得规范', got.srt.startsWith('1\n00:00:01,000 --> 00:00:03,000\n你来了'), got.srt.slice(0,40));

console.log('-- 二、拆出来的 SRT 再解析回去，和原来一致');
const round = await page.evaluate(async srt => {
  const s = await import('/src/system/subtitle.js');
  return s.parse(srt).map(l => [l.at, l.end, l.text]);
}, got.srt);
ok('一圈下来没走样', JSON.stringify(round)==='[[1,3,"你来了"],[4,6.5,"嗯，路上堵车"],[8,10,"我有件事要说"]]',
  JSON.stringify(round));

console.log('-- 三、不是 MP4 / 没有字幕轨的，安静地给空');
const bad = await page.evaluate(async () => {
  const m = await import('/src/system/mp4subs.js');
  const junk = new Blob([new Uint8Array([1,2,3,4,5,6,7,8,9,10])], { type:'video/mp4' });
  const empty = new Blob([], { type:'video/mp4' });
  return { junk: (await m.extract(junk)).length, empty: (await m.extract(empty)).length };
});
console.log(' ', JSON.stringify(bad));
ok('乱七八糟的文件不抛错', bad.junk===0);
ok('空文件也不抛错', bad.empty===0);

console.log('-- 四、上传时自动读出来');
await page.evaluate(async () => {
  const nav = await import('/src/system/nav.js'); nav.openApp('theater','/videos');
});
await page.waitForTimeout(700);
await page.locator('.nav-text', {hasText:'添加'}).click();
await page.waitForTimeout(500);
await page.locator('input[type=file][accept="video/*"]').setInputFiles(`${FIX}/sample.mp4`);
await page.waitForTimeout(1200);
console.log('  toast:', await page.locator('.toast').first().innerText().catch(()=>'(无)'));
ok('提示读出了三句', (await page.locator('.toast').first().innerText().catch(()=>'')).includes('3 句'));
const ta = await page.locator('.sheet textarea').inputValue();
console.log('  字幕框里:', ta.split('\n').slice(0,3).join(' / '));
ok('字幕自动填进去了', ta.includes('你来了') && ta.includes('路上堵车'));
console.log('  片名:', await page.locator('.sheet input').first().inputValue());
ok('片名取的文件名', (await page.locator('.sheet input').first().inputValue())==='sample');
await page.screenshot({path:`${OUT}/mp4-auto.png`});

console.log('-- 五、存下来之后照常能用');
await page.locator('.sheet button', {hasText:'添加'}).last().click();
await page.waitForTimeout(700);
const row = await page.evaluate(async () => {
  const v = await import('/src/system/video.js');
  const r = v.allVideos()[0];
  return { title: r.title, lines: v.linesOf(r).length, has: v.hasSubtitle(r) };
});
console.log(' ', JSON.stringify(row));
ok('片库里那条带着字幕', row.lines===3 && row.has===true, JSON.stringify(row));
console.log('  列表:', (await page.locator('.li-sub').first().innerText().catch(()=>'')));
ok('列表上写着字幕句数', (await page.locator('.li-sub').first().innerText()).includes('字幕 3 句'));

console.log('-- 六、已经在库里的也能手动再读一次');
await page.locator('.nav-text', {hasText:'编辑'}).first().click();
await page.waitForTimeout(500);
await page.locator('.sheet textarea').fill('');
await page.waitForTimeout(300);
await page.locator('.sheet button', {hasText:'从视频中读取'}).click();
await page.waitForTimeout(1200);
console.log('  toast:', await page.locator('.toast').first().innerText().catch(()=>'(无)'));
ok('又读回来了', (await page.locator('.sheet textarea').inputValue()).includes('你来了'));

if (errs.length) console.log('\n报错:\n'+errs.join('\n'));
await b.close();
const bad2=R.filter(x=>!x).length;
console.log(`\n${R.length-bad2}/${R.length} 通过`);
process.exit(bad2||errs.length?1:0);
