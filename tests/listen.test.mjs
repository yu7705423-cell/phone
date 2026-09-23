import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE,
  args:['--no-sandbox','--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
// 三十秒的静音 wav。**长度必须是真的** —— 零长度的音频一挂上就 onended，
// 于是自动连跳到歌单末尾，测出来的全是跳完之后的状态。
function silentWav(seconds = 30, rate = 8000) {
  const n = rate * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  return buf;
}
const WAVBUF = silentWav();
await page.route('https://songs.example.com/**', async r =>
  r.fulfill({status:200,contentType:'audio/wav',body:WAVBUF}));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const out = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const acc=await import('/src/system/accounts.js');
  const music=await import('/src/system/music.js');
  const listen=await import('/src/system/listen.js');
  const reply=await import('/src/system/ai/reply.js');
  const engine=await import('/src/system/ai/engine.js');
  const svc=await import('/src/system/ai/services.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const me=acc.roots()[0]||acc.createRoot({name:'小明'});
  db.personas.update(me.id,{name:'小明'});
  const c=db.characters.create({name:'阿岚'});
  const chat=db.chats.create({characterIds:[c.id],personaId:me.id});
  svc.newChatPreset({name:'t',provider:'openai',baseUrl:'https://a.com/v1',apiKey:'k',model:'m'});

  // ---- 曲库 ----
  let threw=''; try{ music.addSong({title:'只有名字'}); }catch(e){threw=e.message;}
  ok('没有地址也没有文件就加不进来', /播放地址|音频文件/.test(threw), threw);
  threw=''; try{ music.addSong({title:'',url:'https://songs.example.com/a.wav'}); }catch(e){threw=e.message;}
  ok('没名字也加不进来', /名称/.test(threw), threw);

  const s1=music.addSong({title:'晚安',artist:'某某',url:'https://songs.example.com/1.wav',
    lyric:'[00:00.00]第一句\n[00:02.00]第二句\n[00:05.50]第三句'});
  const s2=music.addSong({title:'城市之光',artist:'某某',url:'https://songs.example.com/2.wav'});
  const s3=music.addSong({title:'回家',url:'https://songs.example.com/3.wav'});
  ok('加进来了三首', music.allSongs().length===3);

  // 认歌
  ok('全名能认', music.findSong('晚安')?.id===s1.id);
  ok('带歌手也能认', music.findSong('城市之光 某某')?.id===s2.id);
  ok('多说两个字也能认', music.findSong('放一首回家吧')?.id===s3.id, music.findSong('放一首回家吧')?.title);
  ok('认不出来就是认不出来', music.findSong('一首根本不存在的歌')===null);

  // 歌词
  const lines=music.parseLyric('[00:00.00]第一句\n[00:02.00]第二句\n[00:05.50]第三句');
  ok('歌词解析出三句', lines.length===3 && lines[2].at===5.5, JSON.stringify(lines));
  ok('第 0 秒是第一句', music.lyricAt(lines,0)==='第一句');
  ok('第 3 秒还是第二句', music.lyricAt(lines,3)==='第二句');
  ok('第 6 秒到第三句', music.lyricAt(lines,6)==='第三句');
  ok('没有歌词就是空的', music.lyricAt([],3)==='');

  // ---- 歌单 ----
  const pl=music.createList({name:'夜里听的'});
  music.addTrack(pl.id,s1.id); music.addTrack(pl.id,s2.id);
  ok('歌单里两首', music.tracksOf(pl.id).length===2);
  ok('同一首加两次不会重复', music.addTrack(pl.id,s1.id)===false && music.tracksOf(pl.id).length===2);

  // 角色自己的歌单
  const hers=music.createList({name:'她的歌',owner:c.id});
  ok('歌单分主人', music.allLists(c.id).length===1 && music.allLists('me').length===1,
    JSON.stringify([music.allLists(c.id).length, music.allLists('me').length]));

  // ---- 一起听 ----
  threw=''; try{ listen.start({chatId:chat.id,listId:hers.id}); }catch(e){threw=e.message;}
  ok('空歌单会退到别的地方找歌', threw==='' && listen.listen.get().active, threw);
  listen.stop();

  listen.start({chatId:chat.id,listId:pl.id});
  const st=listen.listen.get();
  ok('开起来了', st.active && st.chatId===chat.id);
  ok('从歌单第一首开始', st.songId===s1.id, st.songId);
  ok('本次统计从零开始', st.seconds===0 && st.count===0);

  listen.next();
  ok('下一首是第二首', listen.listen.get().songId===s2.id);
  ok('切过去之后算一首听过了', listen.listen.get().count===1, String(listen.listen.get().count));
  listen.prev();
  ok('还能往回切', listen.listen.get().songId===s1.id);

  // 角色点歌
  const made=await reply.renderTurn({chat,char:c,raw:'换一首吧\n[点歌：回家]',turnId:'l1',instant:true});
  await new Promise(r=>setTimeout(r,200));
  ok('角色点的歌换上了', listen.listen.get().songId===s3.id,
    JSON.stringify({now:db.songs.get(listen.listen.get().songId)?.title, want:'回家',
      found:music.findSong('回家')?.title, active:listen.listen.get().active}));
  ok('点歌不占气泡', made.every(m=>m.kind==='text'), JSON.stringify(made.map(m=>m.kind)));

  // 点一首不存在的
  const before=listen.listen.get().songId;
  await reply.renderTurn({chat,char:c,raw:'[点歌：一首根本不存在的歌]',turnId:'l2',instant:true});
  await new Promise(r=>setTimeout(r,200));
  ok('点不存在的歌就当没点过', listen.listen.get().songId===before);

  // 角色建歌单
  await reply.renderTurn({chat,char:c,raw:'[建歌单：深夜电台]',turnId:'l3',instant:true});
  await new Promise(r=>setTimeout(r,200));
  ok('角色建的歌单记在它名下',
    music.allLists(c.id).some(p=>p.name==='深夜电台'), JSON.stringify(music.allLists(c.id).map(p=>p.name)));

  // 结算
  listen.listen.set({seconds:125});
  const rec=listen.stop();
  ok('结算落了一条记录', rec && rec.kind==='listen', JSON.stringify(rec&&rec.kind));
  ok('正文写了时长和首数', rec.content.startsWith('[一起听了 2 分 5 秒，'), rec.content.split('\n')[0]);
  ok('曲目也写进去了', rec.content.includes('晚安'), rec.content);
  ok('结束之后就不在了', listen.listen.get().active===false);

  const t=listen.totals(chat.id);
  ok('累积统计加上了', t.seconds===125 && t.count>0, JSON.stringify(t));

  // 再听一场，累积要继续加
  listen.start({chatId:chat.id,songId:s1.id});
  listen.listen.set({seconds:60});
  listen.stop();
  const t2=listen.totals(chat.id);
  ok('第二场累加而不是覆盖', t2.seconds===185, JSON.stringify(t2));

  // ---- 角色拉一起听 ----
  ok('拉之前是停的', listen.listen.get().active===false);
  await reply.renderTurn({chat,char:c,raw:'陪我听会儿歌\n[一起听]',turnId:'l4',instant:true});
  await new Promise(r=>setTimeout(r,300));
  ok('角色能拉起来', listen.listen.get().active===true);
  ok('角色拉起来的不自动响，等人按播放', listen.listen.get().playing===false);

  // ---- prompt ----
  const sys=()=>engine.buildChatSystem(db.chats.get(chat.id),db.characters.get(c.id),db.messagesOf(chat.id),{}).system;
  const on=sys();
  // 「不作讲解」「不逐句解读歌词」那三条已经删掉：什么时候该说话、
  // 说到什么份上，是角色的事，不是格式规则（第 16 条）
  ok('正在一起听时整段细则是热的', on.includes('[一起听歌]') && on.includes('[点歌：song'), '');
  ok('细则里只剩怎么写这几个标记',
    !/不作讲解|不逐句解读歌词|鉴赏/.test(on), '有一条判断回来了');
  listen.stop();

  db.settings.set({promptLean:true});
  const cold=engine.buildChatSystem(db.chats.get(chat.id),db.characters.get(c.id),[],{}).system;
  ok('没在听的时候只给一行目录',
    cold.includes('Listen together: write a line on its own, [一起听]')
    && !cold.includes('[一起听歌]'), '');

  db.characters.update(c.id,{canListen:false});
  const off=engine.buildChatSystem(db.chats.get(chat.id),db.characters.get(c.id),[],{}).system;
  ok('关掉就一个字都不提', !off.includes('一起听歌：'), '');
  db.characters.update(c.id,{canListen:true});

  return { results:R, chat:chat.id, char:c.id, list:pl.id, song:s1.id };
});
out.results.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 界面 ----
await page.evaluate(async id => {
  const nav=await import('/src/system/nav.js');
  nav.goHome(); nav.openApp('chat',`/chat/${id}`); nav.push(`/listen/${id}`);
}, out.chat);
await page.waitForTimeout(800);
const txt = await page.locator('.app-layer').innerText();
ok('一起听页面打得开', txt.includes('累积'), txt.slice(0,120));
ok('累积写出来了', txt.includes('3 分 5 秒') || txt.includes('185'), txt.slice(0,200));
ok('曲库列出来了', txt.includes('晚安') && txt.includes('城市之光'));
ok('角色的歌单单独一组', txt.includes('阿岚建的歌单'), txt.slice(0,300));
await page.screenshot({path:`${OUT}/l1-page.png`});

await page.getByText('夜里听的',{exact:true}).click();
await page.waitForTimeout(900);
ok('点歌单就开始一起听', await page.locator('.listen-bar').count()===1);
ok('播放条上写着歌名', (await page.locator('.listen-title').innerText()).includes('晚安'),
  JSON.stringify({bar:await page.locator('.listen-title').innerText(),
    tracks:await page.evaluate(async id=>{const m=await import('/src/system/music.js');return m.tracksOf(id).map(t=>t.title);}, out.list)}));
await page.screenshot({path:`${OUT}/l2-bar.png`});

await page.locator('.listen-key').nth(1).click();
await page.waitForTimeout(500);
ok('点下一首真的换了', (await page.locator('.listen-title').innerText()).includes('城市之光'),
  await page.locator('.listen-title').innerText());
await page.locator('.listen-key').last().click();
await page.waitForTimeout(600);
ok('点叉就结束了', await page.locator('.listen-bar').count()===0);
ok('会话里留下记录气泡', await page.locator('.bubble-call').count()>=1);
await page.screenshot({path:`${OUT}/l3-record.png`});

await page.locator('.bubble-call').last().click();
await page.waitForTimeout(500);
ok('点开能看这一场听了什么', (await page.locator('.sheet').innerText()).includes('城市之光'),
  await page.locator('.sheet').innerText().catch(()=>''));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
