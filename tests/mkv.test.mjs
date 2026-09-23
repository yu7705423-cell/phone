// MKV：换壳成 MP4、抽字幕，以及换完之后本来那条 MP4 路能不能接上
import { BASE, OUT, EXE, chromium } from './_env.mjs';
import { writeFileSync } from 'node:fs';
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

console.log('-- 零、先用 ffmpeg 自己造一个真 MKV（带字幕轨）');
const mkvB64 = await page.evaluate(async () => {
  const f = await import('/src/system/ffmpeg.js');
  const core = await f.load();
  const srt = '1\n00:00:01,000 --> 00:00:03,000\n你来了\n\n2\n00:00:04,000 --> 00:00:06,500\n嗯，路上堵车\n\n3\n00:00:07,000 --> 00:00:08,000\n先坐吧\n';
  core.FS.writeFile('mk.srt', new TextEncoder().encode(srt));
  core.exec('-f','lavfi','-i','color=c=navy:s=320x180:d=9','-i','mk.srt',
    '-c:v','libx264','-preset','ultrafast','-c:s','srt','-t','9','mk.mkv');
  const bin = core.FS.readFile('mk.mkv');
  core.FS.unlink('mk.srt'); core.FS.unlink('mk.mkv');
  let s = ''; for (const c of bin) s += String.fromCharCode(c);
  return btoa(s);
});
writeFileSync(`${OUT}/sample.mkv`, Buffer.from(mkvB64, 'base64'));
console.log('  造好了', Buffer.from(mkvB64,'base64').length, '字节');
ok('MKV 造出来了', mkvB64.length > 100);

console.log('-- 一、认得出这个壳放不了');
const judge = await page.evaluate(async () => {
  const v = await import('/src/system/video.js');
  const f = await import('/src/system/ffmpeg.js');
  return {
    mkv: v.needsConvert({ name:'x.mkv', type:'video/x-matroska' }),
    mp4: v.needsConvert({ name:'x.mp4', type:'video/mp4' }),
    webm: v.needsConvert({ name:'x.webm', type:'video/webm' }),
    avi: v.needsConvert({ name:'x.avi', type:'' }),
    big: f.tooBig({ size: 900*1024*1024 }),
    okSize: f.tooBig({ size: 10*1024*1024 }),
  };
});
console.log(' ', JSON.stringify(judge));
ok('MKV 要转', judge.mkv===true);
ok('MP4 不用转', judge.mp4===false);
ok('WebM 不用转', judge.webm===false);
ok('AVI 按后缀也认得出', judge.avi===true);
ok('超过上限的拦下来', judge.big===true && judge.okSize===false);

console.log('-- 二、探流');
const info = await page.evaluate(async b64 => {
  const f = await import('/src/system/ffmpeg.js');
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return f.probe(new Blob([bin]));
}, mkvB64);
console.log(' ', JSON.stringify(info));
ok('看见视频轨', info.video==='h264', info.video);
ok('看见字幕轨', info.subs.length===1 && info.subs[0].codec==='subrip', JSON.stringify(info.subs));

console.log('-- 三、换壳成 MP4，字幕一并带过去');
const conv = await page.evaluate(async b64 => {
  const v = await import('/src/system/video.js');
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const seen = [];
  const got = await v.convertForPlayback(new Blob([bin], { type:'video/x-matroska' }),
    { onProgress: p => seen.push(p) });
  const head = new Uint8Array(await got.blob.slice(4, 12).arrayBuffer());
  return {
    type: got.blob.type, bytes: got.blob.size,
    brand: String.fromCharCode(...head),
    subs: got.subs, srtHead: got.srt.split('\n').slice(0,3).join(' / '),
    progress: seen.length,
  };
}, mkvB64);
console.log(' ', JSON.stringify(conv));
ok('出来的是 MP4', conv.brand.startsWith('ftyp') && conv.type==='video/mp4', conv.brand);
ok('换壳之后字幕读得到了', conv.subs===3, String(conv.subs));
ok('读出来就是原文', conv.srtHead.includes('你来了'), conv.srtHead);

console.log('-- 四、单抽字幕（不换壳）');
const only = await page.evaluate(async b64 => {
  const f = await import('/src/system/ffmpeg.js');
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const srt = await f.extractSubs(new Blob([bin]));
  const s = await import('/src/system/subtitle.js');
  return { lines: s.parse(srt).map(l => l.text) };
}, mkvB64);
console.log(' ', JSON.stringify(only));
ok('三句都抽出来了', JSON.stringify(only.lines)==='["你来了","嗯，路上堵车","先坐吧"]', JSON.stringify(only.lines));

console.log('-- 五、界面上传一个 MKV');
await page.evaluate(async () => {
  const nav = await import('/src/system/nav.js'); nav.openApp('theater','/videos');
});
await page.waitForTimeout(700);
await page.locator('.nav-text', {hasText:'添加'}).click();
await page.waitForTimeout(500);
await page.locator('input[type=file][accept="video/*"]').setInputFiles(`${OUT}/sample.mkv`);
await page.waitForTimeout(800);
const ask = await page.locator('.modal-message').innerText().catch(()=>'(没问)');
console.log('  弹的话:', ask.replace(/\n/g,' ').slice(0,90));
ok('先问要不要转', ask.includes('浏览器') || ask.includes('转换'), ask.slice(0,40));
await page.locator('.modal-btn-primary').click();
await page.waitForTimeout(3000);
console.log('  toast:', await page.locator('.toast').first().innerText().catch(()=>'(无)'));
ok('转完并读出了字幕', (await page.locator('.toast').first().innerText().catch(()=>'')).includes('字幕'));
const ta = await page.locator('.sheet textarea').inputValue();
ok('字幕填进框里了', ta.includes('你来了') && ta.includes('先坐吧'), ta.slice(0,40));
console.log('  文件名:', (await page.locator('.sheet .field-desc').nth(2).innerText().catch(()=>'')).slice(0,40));
await page.screenshot({path:`${OUT}/mkv-done.png`});

console.log('-- 六、存下来能放吗');
await page.locator('.sheet button', {hasText:'添加'}).last().click();
await page.waitForTimeout(800);
const saved = await page.evaluate(async () => {
  const v = await import('/src/system/video.js');
  const db = await import('/src/system/db/index.js');
  const row = v.allVideos()[0];
  const info = db.files.info(row.fileId);
  return { title: row.title, lines: v.linesOf(row).length, type: info?.type, name: info?.name };
});
console.log(' ', JSON.stringify(saved));
ok('存进去的是 MP4', saved.type==='video/mp4' && saved.name.endsWith('.mp4'), JSON.stringify(saved));
ok('字幕也在', saved.lines===3, String(saved.lines));

if (errs.length) console.log('\n报错:\n'+errs.join('\n'));
await b.close();
const bad=R.filter(x=>!x).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
