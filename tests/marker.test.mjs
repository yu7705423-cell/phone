import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({ viewport:{width:430,height:932}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);

const out = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const reply = await import('/src/system/ai/reply.js');
  const repair = await import('/src/system/ai/repair.js');
  const engine = await import('/src/system/ai/engine.js');
  const stk = await import('/src/system/stickers.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});

  const me = acc.roots()[0] || acc.createRoot({ name: '小明' });
  const char = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds:[char.id], personaId: me.id });
  db.messages.create({ chatId: chat.id, role:'user', authorId:'me', kind:'text',
    content:'你要什么奖励！', status:'done' });

  // --- 用户实际收到的那一条，原样复现 ---
  const real = '[2026-09-17 周四 19:58]\n[引用：你要什么奖励！]\nうーん、そうだな…（嗯……让我想想……）。';
  let p = reply.splitReply(real);
  ok('无标签的时间行也被剥掉', p.length === 1 && !p[0].text.includes('2026-09-17'), JSON.stringify(p));
  ok('时间记在第一条上', p[0].stamp === '2026-09-17 周四 19:58', p[0].stamp);
  ok('被时间行挡住的引用现在也剥掉了', p[0].quote === '你要什么奖励！', JSON.stringify(p[0]));
  ok('正文干干净净', p[0].text === 'うーん、そうだな…（嗯……让我想想……）。', p[0].text);

  // --- 每条都写时间：只留第一个 ---
  p = reply.splitReply('[时间：2026-09-17 周四 19:58]\n在呢\n\n[2026-09-17 周四 19:59]\n刚才在忙\n\n【20:01】\n现在有空了');
  ok('每条都写时间也只剥不留', p.length === 3 && p.every(x => !/\d{2}:\d{2}/.test(x.text)), JSON.stringify(p.map(x=>x.text)));
  ok('只有第一条带时间', p[0].stamp === '2026-09-17 周四 19:58' && !p[1].stamp && !p[2].stamp,
    JSON.stringify(p.map(x=>x.stamp)));

  // --- 不能误伤正常内容 ---
  ok('（3秒）不当成时间', reply.splitReply('（3秒）后他抬起头').length === 1
    && reply.splitReply('（3秒）后他抬起头')[0].text === '（3秒）后他抬起头');
  const keep = reply.splitReply('[图片：海边的黄昏]');
  ok('图片标记不受影响', keep.length === 1 && keep[0].type === 'image', JSON.stringify(keep));
  const kept2 = reply.splitReply('这是我的电话 [138 0000 0000]');
  ok('行内的方括号不受影响', kept2[0].text.includes('138'), JSON.stringify(kept2));

  // --- 表情包 ---
  const s1 = stk.addFromUrl({ name:'摸头', keywords:['摸头','安慰'], url:'https://x/1.png' });
  stk.addFromUrl({ name:'笑哭', keywords:['笑哭'], url:'https://x/2.png' });
  ok('按名字找得到', stk.byName('摸头')?.id === s1.id);
  ok('按关键词也找得到', stk.byName('安慰')?.id === s1.id);
  ok('找不到就返回 null', stk.byName('完全不存在的名字') === null);

  p = reply.splitReply('好啦别难过\n\n[表情：摸头]');
  ok('表情标记被认出来', p.length === 2 && p[1].type === 'sticker' && p[1].name === '摸头', JSON.stringify(p));

  const made = await reply.renderTurn({ chat, char, raw:'[时间：2026-09-17 周四 20:00]\n好啦\n\n[表情：摸头]', turnId:'t1', instant:true });
  ok('落成一条文字加一条表情', made.length === 2 && made[1].kind === 'sticker', JSON.stringify(made.map(m=>m.kind)));
  ok('表情挂上了 stickerId', made[1].stickerId === s1.id, made[1].stickerId);
  ok('用量计数加了一次', stk.byName('摸头').useCount === 1, stk.byName('摸头').useCount);
  ok('时间只在第一条', made[0].stamp === '2026-09-17 周四 20:00' && !made[1].stamp, JSON.stringify(made.map(m=>m.stamp)));

  const miss = await reply.renderTurn({ chat, char, raw:'[表情：库里没有这个]', turnId:'t2', instant:true });
  ok('名字对不上也发得出去', miss[0].kind === 'sticker' && miss[0].stickerId === null
    && miss[0].stickerName === '库里没有这个', JSON.stringify(miss[0]));

  // --- prompt 里列出表情名 ---
  const sys = engine.buildChatSystem(db.chats.get(chat.id), db.characters.get(char.id), db.messagesOf(chat.id)).system;
  ok('prompt 里列了表情名', sys.includes('[表情]') && sys.includes('摸头'), sys.includes('摸头'));
  ok('时间那段说了只写一次', sys.includes('Write this line once, at the very start'));
  db.characters.update(char.id, { canSendSticker: false });
  const sys2 = engine.buildChatSystem(db.chats.get(chat.id), db.characters.get(char.id), db.messagesOf(chat.id)).system;
  ok('关掉开关就不列了', !sys2.includes('[表情]'));
  db.characters.update(char.id, { canSendSticker: true });

  // --- 已经存进去的坏消息可以用「修正格式」清掉 ---
  const bad = db.messages.create({ chatId: chat.id, role:'char', authorId: char.id, kind:'text',
    content: real, status:'done' });
  const fixes = repair.fixesFor(bad);
  ok('坏消息认得出可以整理', fixes.some(f => f.id === 'rows'), JSON.stringify(fixes.map(f=>f.id)));
  ok('预览说明了移出时间行', fixes.find(f => f.id === 'rows')?.preview.includes('移出时间行'),
    fixes.find(f => f.id === 'rows')?.preview);
  repair.applyFix(bad.id, 'rows');
  const after = db.messagesOf(chat.id).filter(m => m.content.includes('うーん'));
  ok('整理之后正文干净了', after.length === 1 && after[0].content === 'うーん、そうだな…（嗯……让我想想……）。',
    JSON.stringify(after.map(m=>m.content)));
  ok('整理之后引用接上了', !!after[0].quoteId, JSON.stringify(after[0]));

  return R;
});
await browser.close();
let bad=0;
for (const r of out) { if(!r.pass) bad++; console.log(`${r.pass?'  ok  ':'  FAIL'} ${r.name}${r.pass?'':'   << '+(r.extra??'')}`); }
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${out.length-bad}/${out.length} 通过`);
process.exit(bad||errs.length?1:0);
