import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE,
  args:['--no-sandbox','--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));

// 假的网易云服务
const seen=[];
let scanState = 801;
await page.route('https://music.test/**', async r => {
  const u=new URL(r.request().url());
  const p=u.pathname; const q=Object.fromEntries(u.searchParams);
  seen.push({ p, q });
  const j = o => r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(o)});
  if (p==='/login/qr/key') return j({ data:{ unikey:'K1' } });
  if (p==='/login/qr/create') return j({ data:{ qrimg:'data:image/png;base64,iVBORw0KGgo=', qrurl:'x' } });
  if (p==='/login/qr/check') return j(scanState===803
    ? { code:803, cookie:`COOKIE_${q.__who||'A'}` } : { code:scanState });
  if (p==='/user/account') return j({ profile:{ userId: q.cookie==='COOKIE_B'?222:111,
    nickname: q.cookie==='COOKIE_B'?'小号':'大号' } });
  if (p==='/search') {
    // 真接口是按关键词排的，假的也得按关键词过一遍，否则「角色自己去搜一首」
    // 那条路测出来的永远是列表第一首
    const all=[
      { id:1001, name:'夜航星', artists:[{name:'某乐队'}], duration:200000 },
      { id:1002, name:'另一首', artists:[{name:'别人'}], duration:180000 }];
    const key=String(q.keywords||'');
    const hit=all.filter(x=>x.name.includes(key)||key.includes(x.name));
    return j({ result:{ songs: hit.length?hit:all } });
  }
  if (p==='/song/url/v1') return j({ data:[{ url:'https://music.test/audio.wav' }] });
  if (p==='/lyric') return j({ lrc:{ lyric:'[00:00.00]词' } });
  if (p==='/scrobble') return j({ code:200 });
  if (p==='/user/playlist') return j({ playlist:[{ id:9001, name:'和阿岚一起听' }] });
  if (p==='/playlist/create') return j({ id:9002 });
  if (p==='/playlist/tracks') return j({ status:200 });
  if (p==='/audio.wav') {
    const n=8000*30; const buf=Buffer.alloc(44+n*2);
    buf.write('RIFF',0); buf.writeUInt32LE(36+n*2,4); buf.write('WAVE',8); buf.write('fmt ',12);
    buf.writeUInt32LE(16,16); buf.writeUInt16LE(1,20); buf.writeUInt16LE(1,22);
    buf.writeUInt32LE(8000,24); buf.writeUInt32LE(16000,28); buf.writeUInt16LE(2,32);
    buf.writeUInt16LE(16,34); buf.write('data',36); buf.writeUInt32LE(n*2,40);
    return r.fulfill({status:200,contentType:'audio/wav',body:buf});
  }
  return j({});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const ids = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const acc=await import('/src/system/accounts.js');
  const svc=await import('/src/system/ai/services.js');
  const me=acc.roots()[0]||acc.createRoot({name:'小明'});
  const c=db.characters.create({name:'阿岚'});
  const chat=db.chats.create({characterIds:[c.id],personaId:me.id});
  svc.newChatPreset({name:'t',provider:'openai',baseUrl:'https://a.com/v1',apiKey:'k',model:'m'});
  return { chat:chat.id, char:c.id };
});

const out = await page.evaluate(async ids => {
  const db=await import('/src/system/db/index.js');
  const svc=await import('/src/system/ai/services.js');
  const ne=await import('/src/system/netease.js');
  const music=await import('/src/system/music.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});

  ok('没填地址就是没配', !ne.ready());
  let threw=''; try{ await ne.search('x'); }catch(e){threw=e.message;}
  ok('没填地址会说清楚', /接口地址/.test(threw), threw);

  svc.setNetease({ baseUrl:'https://music.test' });
  ok('填了地址就算配好', ne.ready());

  const qr=await ne.qrStart();
  ok('拿到二维码', !!qr.key && qr.img.startsWith('data:image'), JSON.stringify(qr).slice(0,60));
  const c1=await ne.qrCheck(qr.key);
  ok('还没扫的时候是 801', c1.code===801, String(c1.code));

  const hits=await ne.search('夜航星');
  ok('按关键词搜到了', hits.length===1 && hits[0].title==='夜航星', JSON.stringify(hits.map(h=>h.title)));
  ok('歌手拼好了', hits[0].artist==='某乐队', hits[0].artist);
  ok('时长换成了秒', hits[0].seconds===200, String(hits[0].seconds));

  const song=music.fromNetease(hits[0]);
  ok('加进曲库了', song.source==='netease'&&song.neteaseId==='1001', JSON.stringify(song.source));
  ok('不存播放地址', song.url==='', song.url);
  ok('同一首不会重复加', music.fromNetease(hits[0]).id===song.id && music.allSongs().length===1);

  const url=await ne.songUrl('1001');
  ok('播放地址现取', url==='https://music.test/audio.wav', url);

  return { results:R, songId:song.id };
}, ids);
out.results.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 扫码登录走一遍 ----
await page.evaluate(async () => {
  const nav=await import('/src/system/nav.js'); nav.goHome(); nav.openApp('settings','/music');
});
await page.waitForTimeout(700);
ok('音乐服务页打得开', (await page.locator('.app-layer').innerText()).includes('接口地址'));
await page.locator('.qr-box button').click();
await page.waitForTimeout(600);
ok('二维码出来了', await page.locator('.qr-img').count()===1);
ok('提示在等扫码', (await page.locator('.qr-note').innerText()).includes('扫描'),
  await page.locator('.qr-note').innerText());
await page.screenshot({path:`${OUT}/n1-qr.png`});
scanState = 803;
await page.waitForTimeout(3200);
const acct = await page.evaluate(async () => {
  const svc=await import('/src/system/ai/services.js'); return svc.neteaseConfig();
});
ok('扫完就登上了', acct.cookie==='COOKIE_A' && acct.nickname==='大号', JSON.stringify(acct));
await page.screenshot({path:`${OUT}/n2-logged.png`});

// ---- 角色那个号 ----
const second = await page.evaluate(async ids => {
  const ne=await import('/src/system/netease.js');
  const db=await import('/src/system/db/index.js');
  await ne.saveLogin('COOKIE_B', ids.char);
  const c=db.characters.get(ids.char);
  return { nick:c.neteaseNick, uid:c.neteaseUid, accounts: ne.accounts(ids.char).length };
}, ids);
ok('角色那个号也登上了', second.nick==='小号'&&second.uid==='222', JSON.stringify(second));
ok('两个号都会被带上', second.accounts===2, String(second.accounts));

// ---- 打卡：两个号各一次 ----
seen.length = 0;
const scr = await page.evaluate(async ids => {
  const ne=await import('/src/system/netease.js');
  await ne.scrobble('1001', 120, ids.char);
  return true;
}, ids);
const scrobbles = seen.filter(x=>x.p==='/scrobble');
ok('打了两次卡', scrobbles.length===2, String(scrobbles.length));
ok('两次用的是不同的号',
  new Set(scrobbles.map(x=>x.q.cookie)).size===2, JSON.stringify(scrobbles.map(x=>x.q.cookie)));
ok('带上了歌曲和时长',
  scrobbles[0].q.id==='1001' && scrobbles[0].q.time==='120', JSON.stringify(scrobbles[0].q));

// ---- 歌单同步：默认不开 ----
seen.length = 0;
await page.evaluate(async ids => {
  const ne=await import('/src/system/netease.js');
  await ne.syncPlaylist(['1001'], ids.char, '和阿岚一起听');
}, ids);
ok('默认不动你的歌单', seen.filter(x=>x.p==='/playlist/tracks').length===0);

seen.length = 0;
await page.evaluate(async ids => {
  const svc=await import('/src/system/ai/services.js');
  const ne=await import('/src/system/netease.js');
  svc.setNetease({ sync:true });
  await ne.syncPlaylist(['1001'], ids.char, '和阿岚一起听');
}, ids);
const adds = seen.filter(x=>x.p==='/playlist/tracks');
ok('开了才写歌单', adds.length===2, String(adds.length));
ok('已有同名歌单就不再新建', seen.filter(x=>x.p==='/playlist/create').length===0);
ok('两个号各写各的', new Set(adds.map(x=>x.q.cookie)).size===2, JSON.stringify(adds.map(x=>x.q.cookie)));

// ---- 一起听里真的放网易云的歌 ----
const live = await page.evaluate(async ({ids, songId}) => {
  const listen=await import('/src/system/listen.js');
  listen.start({ chatId: ids.chat, songId });
  await new Promise(r=>setTimeout(r,800));
  const s=listen.listen.get();
  return { active:s.active, songId:s.songId, playing:s.playing, error:s.error };
}, { ids, songId: out.songId });
ok('网易云的歌能放起来', live.active && live.songId===out.songId && !live.error, JSON.stringify(live));

// ---- 角色点一首曲库里没有的歌，自己去搜 ----
const picked = await page.evaluate(async ids => {
  const db=await import('/src/system/db/index.js');
  const reply=await import('/src/system/ai/reply.js');
  const listen=await import('/src/system/listen.js');
  const chat=db.chats.get(ids.chat), char=db.characters.get(ids.char);
  const before=db.songs.count();
  await reply.renderTurn({chat,char,raw:'[点歌：另一首]',turnId:'n1',instant:true});
  await new Promise(r=>setTimeout(r,900));
  const now=db.songs.get(listen.listen.get().songId);
  return { before, after:db.songs.count(), title: now?.title };
}, ids);
ok('曲库里没有就去网易云搜一首回来', picked.after===picked.before+1, JSON.stringify(picked));
ok('搜回来的那首放上了', picked.title==='另一首', picked.title);

// 退出登录
const outed = await page.evaluate(async ids => {
  const ne=await import('/src/system/netease.js');
  const svc=await import('/src/system/ai/services.js');
  const db=await import('/src/system/db/index.js');
  ne.logout(); ne.logout(ids.char);
  return { mine:svc.neteaseConfig().cookie, hers:db.characters.get(ids.char).neteaseCookie,
           accounts: ne.accounts(ids.char).length };
}, ids);
ok('两个号都能退', !outed.mine && !outed.hers && outed.accounts===0, JSON.stringify(outed));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
