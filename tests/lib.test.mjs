// 曲库页：上传、编辑歌词、移除、播放；以及一起听那边只剩挑歌
import { BASE, OUT, EXE, chromium, FIX } from './_env.mjs';
const API=`${BASE}/napi`;
const b = await chromium.launch({ executablePath:EXE,
  args:['--no-sandbox','--no-first-run','--autoplay-policy=no-user-gesture-required'] });
const page = await b.newPage({ viewport:{width:430,height:932}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const R=[]; const ok=(n,c,e)=>{R.push(!!c);console.log(`${c?'  ok   ':'  FAIL '}${n}${c?'':'   << '+(e??'')}`);};
const WAV=(await import('node:fs')).readFileSync(`${FIX}/wav.txt`,'utf8').trim();
await page.route('**/*', r => r.request().url().startsWith(`${BASE}`) ? r.continue() : r.abort());
await page.route('**/napi/**', async r => {
  const p = new URL(r.request().url()).pathname.replace('/napi','');
  const J = o => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(o)});
  if (p==='/song/url/v1'||p==='/song/url') return J({ data:[{url:`data:audio/wav;base64,${WAV}`}] });
  if (p==='/search') return J({ result:{ songs:[{ id:4, name:'搜到的', ar:[{name:'歌手甲'}], al:{name:'专辑',picUrl:''}, dt:210000 }] }});
  return J({ code:200 });
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
await page.locator('.lock-unlock').click(); await page.waitForTimeout(400);
await page.evaluate(async api => {
  const svc = await import('/src/system/ai/services.js');
  svc.setNetease({ baseUrl: api, cookie:'x', nickname:'我', uid:'1' });
  const nav = await import('/src/system/nav.js'); nav.openApp('music','/library');
}, API);
await page.waitForTimeout(900);

console.log('-- 一、空曲库');
console.log('  标题:', await page.locator('.nav-title').innerText());
ok('进得来', (await page.locator('.nav-title').innerText())==='曲库');
ok('空状态写明了能干什么',
  (await page.locator('.empty-desc, .empty-state').first().innerText()).includes('上传'),
  await page.locator('.empty-state').first().innerText().catch(()=>'(无)'));

console.log('-- 二、传一个音频文件');
await page.locator('.nav-text', {hasText:'添加'}).click();
await page.waitForTimeout(500);
const buf = Buffer.from(WAV, 'base64');
await page.locator('input[type=file][accept="audio/*"]').setInputFiles(
  { name:'夜航星.mp3', mimeType:'audio/mpeg', buffer: buf });
await page.waitForTimeout(600);
console.log('  自动填的名字:', await page.locator('.sheet input').first().inputValue());
ok('文件名自动落进歌名', (await page.locator('.sheet input').first().inputValue())==='夜航星');
await page.locator('.sheet textarea').fill('[00:01.00]第一句\n[00:03.50]第二句');
await page.waitForTimeout(400);
console.log('  歌词说明:', (await page.locator('.sheet .field-desc').last().innerText()).slice(-12));
ok('识别出两句', (await page.locator('.sheet .field-desc').last().innerText()).includes('2 句'));
await page.locator('.sheet button', {hasText:'添加'}).last().click();
await page.waitForTimeout(700);
const lib1 = await page.evaluate(async () => (await import('/src/system/music.js')).allSongs()
  .map(s=>({t:s.title, src:s.source, hasFile:!!s.audioId, lrc:(s.lyric||'').length})));
console.log('  库里:', JSON.stringify(lib1));
ok('落库了，音频文件也在', lib1.length===1 && lib1[0].hasFile && lib1[0].lrc>0, JSON.stringify(lib1));
await page.screenshot({path:`${OUT}/lib-1.png`});

console.log('-- 三、放一下本机文件');
await page.locator('.mu-row').first().click();
await page.waitForTimeout(1200);
const st = await page.evaluate(async () => (await import('/src/system/player.js')).player.get());
ok('本机文件也放得出来', st.playing===true, JSON.stringify({p:st.playing,e:st.error}));

console.log('-- 四、改歌词');
await page.locator('.nav-text', {hasText:'编辑'}).first().click();
await page.waitForTimeout(500);
console.log('  表里带出原歌词:', (await page.locator('.sheet textarea').inputValue()).split('\n')[0]);
ok('改的时候带出原值', (await page.locator('.sheet textarea').inputValue()).includes('第一句'));
await page.locator('.sheet textarea').fill('[00:02.00]改过的一句');
await page.locator('.sheet button', {hasText:'保存'}).last().click();
await page.waitForTimeout(700);
const lrc = await page.evaluate(async () => (await import('/src/system/music.js')).allSongs()[0].lyric);
ok('歌词存回去了', lrc.includes('改过的一句'), lrc);

console.log('-- 五、网易云收的那些只让改歌词');
await page.evaluate(async () => {
  const m = await import('/src/system/music.js');
  m.fromNetease({ id:'4', title:'搜到的', artist:'歌手甲', seconds:210 });
});
await page.waitForTimeout(600);
await page.locator('.mu-row', {hasText:'搜到的'}).locator('.nav-text', {hasText:'编辑'}).click();
await page.waitForTimeout(500);
const fields = await page.locator('.sheet .field-label').allInnerTexts();
console.log('  表里有:', fields.join(' / '));
ok('只有歌词一栏', fields.length===1 && fields[0]==='歌词', fields.join('/'));
ok('写明了为什么', (await page.locator('.sheet .settings-foot').innerText()).includes('网易云'));
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
await page.screenshot({path:`${OUT}/lib-2.png`});

console.log('-- 六、移除');
await page.locator('.mu-row', {hasText:'搜到的'}).locator('.nav-text', {hasText:'移除'}).click();
await page.waitForTimeout(400);
await page.locator('.modal-btn-primary').click();
await page.waitForTimeout(600);
const n = await page.evaluate(async () => (await import('/src/system/music.js')).allSongs().length);
ok('移掉了', n===1, String(n));

console.log('-- 七、一起听那边只剩挑歌');
await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const c = db.characters.create({ name:'阿岚', persona:'x' });
  const chat = db.chats.create({ characterIds:[c.id] });
  (await import('/src/system/nav.js')).openApp('chat', `/listen/${chat.id}`);
});
await page.waitForTimeout(900);
const acts = await page.locator('.nav-right .nav-text').allInnerTexts();
console.log('  右上角:', acts.join(' / '));
ok('右上角只剩一个「曲库」', acts.length===1 && acts[0]==='曲库', acts.join('/'));
const rows = await page.locator('.li-title').allInnerTexts();
console.log('  页面上的行:', rows.join(' / '));
ok('有「管理曲库」这一行', rows.includes('管理曲库'));
ok('曲库里那一首还能挑', rows.includes('夜航星'));
await page.locator('.list-item', {hasText:'管理曲库'}).click();
await page.waitForTimeout(900);
const where = await page.evaluate(async () => {
  const n = await import('/src/system/nav.js');
  return { app: n.nav.get().appId, route: n.currentRoute() };
});
console.log('  跳到了:', JSON.stringify(where));
ok('跳进音乐的曲库页', where.app==='music' && where.route==='/library', JSON.stringify(where));
await page.screenshot({path:`${OUT}/lib-3.png`});

if (errs.length) console.log('\n报错:\n'+errs.join('\n'));
await b.close();
const bad=R.filter(x=>!x).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
