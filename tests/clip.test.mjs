// 会话里发一段短视频：海报、时长、点一下播，以及那两份文件有没有被登记
import { BASE, OUT, EXE, chromium, FIX } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1600);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const ids = await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  const ch = db.characters.create({ name:'桐生' });
  const chat = db.chats.create({ characterIds:[ch.id], personaId:'me', title:'桐生' });
  const chat2 = db.chats.create({ characterIds:[ch.id], personaId:'me', title:'另一段' });
  return { ch: ch.id, chat: chat.id, chat2: chat2.id };
});
await page.evaluate(async (id) => {
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('chat','/'); n.popToRoot(); n.push(`/chat/${id}`);
}, ids.chat);
await page.waitForTimeout(900);

// **这个浏览器解不了 H.264**（canPlayType 回空串），所以拿现成的 mp4 取不出帧，
// 那是测试环境的事，不是代码的事。用它自己录一段 VP8 的 webm 来测主路径
const b64 = await page.evaluate(async () => {
  const cv = document.createElement('canvas');
  cv.width = 240; cv.height = 180;
  const g = cv.getContext('2d');
  const rec = new MediaRecorder(cv.captureStream(25), { mimeType: 'video/webm;codecs=vp8' });
  const parts = [];
  rec.ondataavailable = e => parts.push(e.data);
  const done = new Promise(r => { rec.onstop = r; });
  rec.start();
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `hsl(${i * 9} 70% 55%)`; g.fillRect(0, 0, 240, 180);
    await new Promise(r => setTimeout(r, 40));
  }
  rec.stop();
  await done;
  const buf = new Uint8Array(await new Blob(parts, { type:'video/webm' }).arrayBuffer());
  let s = ''; for (const b of buf) s += String.fromCharCode(b);
  return btoa(s);
});
const fs = await import('node:fs/promises');
await fs.writeFile(`${OUT}/clip-test.webm`, Buffer.from(b64, 'base64'));

// 直接把文件塞给那个 input，省掉点面板的路 —— 面板长什么样以后会变，
// 这一套测的不是它。setInputFiles 对 display:none 的 input 一样有效
const inp = page.locator('input[type=file][accept="video/*"]');
ok('会话里有一个收视频的入口', await inp.count() === 1, String(await inp.count()));
await inp.setInputFiles(`${OUT}/clip-test.webm`);
await page.waitForTimeout(3000);

const row = await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  const m = db.messages.all().filter(x => x.kind === 'clip').pop();
  if (!m) return null;
  return { kind:m.kind, hasClip: !!m.clipId, hasPoster: !!m.posterId, dur: m.clipDur,
    content: m.content, media: m.media,
    clipBytes: db.files.info(m.clipId)?.bytes || 0,
    posterOk: db.images.has(m.posterId) };
});
ok('落了一条视频消息', !!row && row.kind === 'clip', JSON.stringify(row));
ok('视频存进 files 域', row?.hasClip && row.clipBytes > 1000, JSON.stringify(row));
ok('首帧存成了海报', row?.hasPoster && row.posterOk === true, JSON.stringify(row));
ok('读到了时长', Number(row?.dur) > 0, String(row?.dur));

// 气泡：先是海报，点一下才播
ok('气泡上是海报加一个播放标记', await page.locator('.bubble-clip .clip-play').count() === 1);
ok('还没点之前不放视频', await page.locator('.bubble-clip video').count() === 0);
ok('海报上标了时长', /\d:\d\d/.test(await page.locator('.clip-time').textContent().catch(()=>'')),
  await page.locator('.clip-time').textContent().catch(()=>''));
await page.screenshot({path:`${OUT}/clip-bubble.png`});
await page.locator('.bubble-clip').click();
await page.waitForTimeout(700);
ok('点一下就换成播放器', await page.locator('.bubble-clip video').count() === 1);
ok('长按仍然是消息菜单，不被播放抢走',
  await page.evaluate(() => !!document.querySelector('.msg.no-callout')));

// 登记：清理无引用时不能把这两份删掉
const keep = await page.evaluate(async () => {
  const p=(await import('/src/system/purge.js'));
  const db=(await import('/src/system/db/index.js'));
  const m = db.messages.all().filter(x => x.kind === 'clip').pop();
  const users = p.fileUsers();
  return { poster: p.usedImageIds().has(m.posterId), clip: users.has(m.clipId),
    label: users.get(m.clipId)?.kind || '' };
});
ok('海报登进了图片引用表', keep.poster === true, JSON.stringify(keep));
ok('视频登进了文件引用表', keep.clip === true && keep.label === 'clip', JSON.stringify(keep));

// 角色包里也要带走
const pack = await page.evaluate(async (chId) => {
  const cp=(await import('/src/system/charpack.js'));
  const g = await cp.collect(chId);
  return { files: g.fileIds?.length ?? g.files, imgs: g.imgIds?.length ?? g.images };
}, ids.ch);
ok('导出角色包时把视频与海报一起带走', pack.files >= 1 && pack.imgs >= 1, JSON.stringify(pack));

// 删掉会话，两份都要跟着走
const after = await page.evaluate(async (chatId) => {
  const p=(await import('/src/system/purge.js'));
  const db=(await import('/src/system/db/index.js'));
  const m = db.messages.all().filter(x => x.kind === 'clip').pop();
  const ids = { clip: m.clipId, poster: m.posterId };
  p.dropChat(chatId);
  return { clipGone: !db.files.info(ids.clip), posterGone: !db.images.has(ids.poster) };
}, ids.chat);
ok('删会话时视频跟着删', after.clipGone === true, JSON.stringify(after));
ok('删会话时海报跟着删', after.posterGone === true, JSON.stringify(after));

// 浏览器解不了的编码：取不出帧不该把整条路断掉，照样发得出去
await page.evaluate(async (id) => {
  const n=await import('/src/system/nav.js'); n.popToRoot(); n.push(`/chat/${id}`);
}, ids.chat2);
await page.waitForTimeout(700);
await page.locator('input[type=file][accept="video/*"]').setInputFiles(`${FIX}/serve-test.mp4`);
await page.waitForTimeout(13000);   // probe 的超时是 10 秒
const hard = await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  const m = db.messages.all().filter(x => x.kind === 'clip').pop();
  return m ? { hasClip: !!m.clipId, poster: m.posterId, dur: m.clipDur } : null;
});
ok('解不出帧的视频照样发得出去', hard?.hasClip === true, JSON.stringify(hard));
ok('没有海报时不硬凑一张', !hard?.poster, JSON.stringify(hard));
ok('没有海报时气泡上摆占位，仍然点得开',
  await page.locator('.clip-blank').count() === 1 && await page.locator('.bubble-clip').count() === 1);

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
