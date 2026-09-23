// 备份：ZIP 读写、图片与文件真的进去了、恢复之后引用不错位
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

console.log('-- 一、ZIP 自己读得回自己');
const zipRound = await page.evaluate(async () => {
  const z = await import('/src/system/zip.js');
  const big = new Uint8Array(300 * 1024);          // 三百 KB 的二进制
  for (let i = 0; i < big.length; i++) big[i] = (i * 7) & 0xff;
  const blob = await z.zip([
    { name: 'backup.json', text: '{"你好":"世界"}' },
    { name: 'images/img_1.webp', blob: new Blob([big]) },
    { name: 'files/f_2.bin', blob: new Blob([new Uint8Array([1,2,3])]) },
  ]);
  const back = await z.unzip(blob);
  const got = new Uint8Array(await back.get('images/img_1.webp').arrayBuffer());
  let same = got.length === big.length;
  if (same) for (let i = 0; i < big.length; i += 997) if (got[i] !== big[i]) { same = false; break; }
  return {
    size: blob.size, names: [...back.keys()],
    json: await back.get('backup.json').text(),
    same, small: [...new Uint8Array(await back.get('files/f_2.bin').arrayBuffer())],
  };
});
console.log(' ', JSON.stringify({ ...zipRound, names: zipRound.names }));
ok('三条都在', zipRound.names.length===3);
ok('中文原样', zipRound.json==='{"你好":"世界"}', zipRound.json);
ok('三百 KB 的二进制一字节不差', zipRound.same===true);
ok('小文件也对', JSON.stringify(zipRound.small)==='[1,2,3]');

console.log('-- 二、真备份一次');
const made = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const backup = await import('/src/system/backup.js');
  const v = await import('/src/system/video.js');
  const m = await import('/src/system/music.js');
  // 造点东西：一个带头像的角色、一条带图的消息、一首歌、一部片
  const png = await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==').then(r=>r.blob());
  const imgId = await db.images.put(new File([png], 'a.png', { type:'image/png' }));
  const audio = await db.files.put(new Blob([new Uint8Array(1000)], { type:'audio/mpeg' }), { name:'a.mp3', type:'audio/mpeg' });
  const vid = await db.files.put(new Blob([new Uint8Array(2000)], { type:'video/mp4' }), { name:'v.mp4', type:'video/mp4' });
  const c = db.characters.create({ name:'阿岚', persona:'二十二岁', avatar: imgId });
  const chat = db.chats.create({ characterIds:[c.id] });
  db.messages.create({ chatId: chat.id, role:'user', authorId:'me', kind:'image', imageId: imgId, content:'', status:'done' });
  m.addSong({ title:'夜航星', audioId: audio });
  v.addVideo({ title:'某部片', fileId: vid, subtitle:'1\n00:00:01,000 --> 00:00:02,000\n喂\n' });
  db.settings.set({ theme:'dark' });

  const est = backup.estimate();
  const zipBlob = await backup.build({ media: true });
  const jsonBlob = await backup.build({ media: false });
  return {
    est, zip: zipBlob.size, json: jsonBlob.size,
    b64: await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(zipBlob); }),
    charId: c.id, imgId, before: { chars: db.characters.count(), songs: db.songs.count(), videos: db.videos.count() },
  };
});
console.log('  统计:', JSON.stringify(made.est));
console.log('  完整包', made.zip, '字节 / 仅数据', made.json, '字节');
ok('完整包比只要数据大（媒体确实进去了）', made.zip > made.json + 2000, `${made.zip} vs ${made.json}`);
ok('统计里算上了文件', made.est.files.count===2 && made.est.images.count===1, JSON.stringify(made.est));

console.log('-- 三、清空之后恢复');
const restored = await page.evaluate(async made => {
  const db = await import('/src/system/db/index.js');
  const backup = await import('/src/system/backup.js');
  // 清干净：连图片带文件
  for (const n of ['characters','chats','messages','songs','videos']) await db[n].clear();
  await Promise.all(db.images.ids().map(id => db.images.remove(id)));
  await Promise.all(db.files.ids().map(id => db.files.remove(id)));
  db.settings.set({ theme:'light' });
  const empty = { chars: db.characters.count(), imgs: db.images.count(), files: db.files.count() };

  const bin = Uint8Array.from(atob(made.b64), c => c.charCodeAt(0));
  const got = await backup.restore(new File([bin], '备份.zip', { type:'application/zip' }));

  const char = db.characters.get(made.charId);
  const url = await db.images.url(made.imgId);
  const song = db.songs.all()[0];
  const vid = db.videos.all()[0];
  return {
    empty, got,
    chars: db.characters.count(), songs: db.songs.count(), videos: db.videos.count(),
    avatarId: char?.avatar, avatarBack: !!url,
    imgs: db.images.count(), files: db.files.count(),
    songFile: song?.audioId ? !!(await db.files.blob(song.audioId)) : false,
    vidFile: vid?.fileId ? !!(await db.files.blob(vid.fileId)) : false,
    theme: db.settings.get().theme,
  };
}, made);
console.log('  清空后:', JSON.stringify(restored.empty));
console.log('  恢复后:', JSON.stringify({ ...restored, empty: undefined }));
ok('确实先清空了', restored.empty.chars===0 && restored.empty.imgs===0 && restored.empty.files===0);
ok('角色回来了', restored.chars===1);
ok('曲库片库也回来了', restored.songs===1 && restored.videos===1);
ok('图片按原编号放回，头像没错位', restored.avatarId===made.imgId && restored.avatarBack===true,
  `${restored.avatarId} vs ${made.imgId}`);
ok('音频与视频都回来了', restored.files===2 && restored.songFile && restored.vidFile,
  JSON.stringify({ files: restored.files, s: restored.songFile, v: restored.vidFile }));
ok('设置也恢复了', restored.theme==='dark', restored.theme);

console.log('-- 四、接口配置不被备份覆盖');
const keyKept = await page.evaluate(async made => {
  const svc = await import('/src/system/ai/services.js');
  const db = await import('/src/system/db/index.js');
  const backup = await import('/src/system/backup.js');
  svc.newChatPreset({ name:'我的接口', provider:'openai', baseUrl:'http://x', apiKey:'secret-key', model:'m' });
  const before = JSON.stringify(db.settings.get().services);
  const bin = Uint8Array.from(atob(made.b64), c => c.charCodeAt(0));
  await backup.restore(new File([bin], '备份.zip'));
  const after = JSON.stringify(db.settings.get().services);
  // 备份里有没有把密钥写进去
  const z = await import('/src/system/zip.js');
  const files = await z.unzip(new Blob([bin]));
  const json = await files.get('backup.json').text();
  return { same: before === after, hasKey: json.includes('secret-key'), kept: after.includes('我的接口') };
}, made);
console.log(' ', JSON.stringify(keyKept));
ok('恢复之后接口配置还在', keyKept.same===true && keyKept.kept===true);
ok('备份文件里没有密钥', keyKept.hasKey===false);

console.log('-- 五、旧的 JSON 备份还导得进来');
const legacy = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const backup = await import('/src/system/backup.js');
  const old = { _format:'mini-phone-backup', _version:1,
    characters:[{ id:'c_old', name:'老角色', persona:'x' }], messages:[], chats:[] };
  await backup.restore(new File([JSON.stringify(old)], '旧备份.json', { type:'application/json' }));
  return { name: db.characters.get('c_old')?.name, count: db.characters.count() };
});
ok('老格式也认', legacy.name==='老角色', JSON.stringify(legacy));

console.log('-- 六、界面上那一页');
await page.evaluate(async () => {
  const nav = await import('/src/system/nav.js'); nav.openApp('settings','/storage');
});
await page.waitForTimeout(900);
const titles = await page.locator('.list-title').allInnerTexts();
console.log('  分区:', titles.join(' / '));
ok('空间那一块出来了', titles.some(t=>t.includes('空间')), titles.join('/'));
console.log('  占用:', (await page.locator('.li-title').allInnerTexts()).slice(0,4).join(' / '));
await page.locator('.list-item', {hasText:'导出备份'}).click();
await page.waitForTimeout(600);
const sheet = await page.locator('.sheet').innerText();
console.log('  导出表:', sheet.replace(/\n/g,' ').slice(0,80));
ok('两档都在', sheet.includes('完整备份') && sheet.includes('仅数据'));
await page.screenshot({path:`${OUT}/backup-page.png`});

if (errs.length) console.log('\n报错:\n'+errs.join('\n'));
await b.close();
const bad=R.filter(x=>!x).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
