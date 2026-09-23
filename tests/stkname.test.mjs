// 角色写的表情名认不出来：先尽量认，认不出能自己指认，指认完下次自己对上
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1600);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// ---- 两边看着一样、比起来却不等的那几种 ----
const match = await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  const stk=(await import('/src/system/stickers.js'));
  const cases = [
    ['开心.png',        '开心',      '名字带扩展名'],
    ['开心​',      '开心',      '名字里夹着零宽字符'],
    ['（笑）',          '(笑)',      '全角与半角'],
    ['ＯＫ',            'ok',        '全角字母'],
    ['开心  1',         '开心 1',    '中间多一个空格'],
    ['开心',            '「开心」',  '模型加了书名号'],
    ['开心',            '"开心"',    '模型加了引号'],
    ['开心',            '[开心]',    '模型又套了一层方括号'],
    ['开心、大笑',      '开心',      '名字里本来就有顿号，模型只写了前半'],
    ['猫猫头',          '猫猫',      '写少了几个字'],
  ];
  const out = [];
  for (const [stored, written, why] of cases) {
    const s = db.stickers.create({ name: stored, group:'B', url:'x', useCount:0,
      keywords: stk.splitKeywords(stored) });
    const hit = stk.byName(written);
    out.push({ why, stored, written, ok: hit?.id === s.id });
    db.stickers.remove(s.id);
  }
  return out;
});
match.forEach(c => ok(`认得出：${c.why}`, c.ok, JSON.stringify(c)));

// ---- 名单一行一个，名字里的顿号不再把它劈成两个 ----
const listed = await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  const caps=(await import('/src/system/ai/capabilities.js'));
  db.stickers.create({ name:'开心、大笑', group:'A', url:'x', useCount:0 });
  db.stickers.create({ name:'猫猫头', group:'B', url:'x', useCount:0 });
  const ch = db.characters.create({ name:'桐生' });
  return caps.CAPS.find(c => c.id === 'sticker')
    .detail({ char: ch, hot: true, settings: db.settings.get() });
});
ok('名单一行一个，带顿号的名字完整地占一行',
  /\n- 开心、大笑\n/.test(listed), listed.slice(-160));

// ---- 认不出时能自己指认，而且指认完下次自己对上 ----
const ids = await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  const ch = db.characters.create({ name:'阿岚' });
  const chat = db.chats.create({ characterIds:[ch.id], personaId:'me', title:'阿岚' });
  const s = db.stickers.create({ name:'猫猫头', group:'B', url:'x', useCount:0 });
  // 角色写了一个怎么都对不上的名字
  db.messages.create({ chatId: chat.id, role:'char', authorId: ch.id, kind:'sticker',
    stickerId: null, stickerName:'那只猫', content:'[表情：那只猫]', status:'done' });
  return { chat: chat.id, s: s.id };
});
await page.evaluate(async (id) => { const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('chat','/'); n.popToRoot(); n.push(`/chat/${id}`); }, ids.chat);
await page.waitForTimeout(1200);
ok('认不出的那一条写出了它想发的名字',
  /那只猫/.test(await page.locator('.stk-gone').innerText()), await page.locator('.stk-gone').innerText());
ok('并且写明了点一下可以指认',
  /点击指认/.test(await page.locator('.stk-gone').innerText()));
await page.locator('.stk-gone').click();
await page.waitForTimeout(700);
const sheet = await page.locator('.sheet').last().innerText();
ok('弹出来的那张说清楚了是哪个名字没找到', /没有找到名为「那只猫」/.test(sheet), sheet.slice(0,120));
await page.screenshot({path:`${OUT}/stkname.png`});
// 面板按分组分页，先切到 B 组；再按名字点那一个 ——
// 点第一个格子会挑到别的表情，测的就不是这件事了
await page.locator('.sheet .chip').filter({ hasText: 'B' }).first().click();
await page.waitForTimeout(400);
await page.locator('.sheet .stk-cell[title="猫猫头"]').first().click();
await page.waitForTimeout(800);
const after = await page.evaluate(async ([chat, sid]) => {
  const db=(await import('/src/system/db/index.js'));
  const stk=(await import('/src/system/stickers.js'));
  const m = db.messages.all().find(x => x.chatId === chat && x.kind === 'sticker');
  return { bound: m.stickerId === sid, content: m.content,
    learned: (db.stickers.get(sid).keywords || []).includes('那只猫'),
    nextTime: stk.byName('那只猫')?.id === sid };
}, [ids.chat, ids.s]);
ok('指认之后这条消息挂上了那个表情', after.bound === true, JSON.stringify(after));
ok('那个名字记成了关键词', after.learned === true, JSON.stringify(after));
ok('下次再写同一个名字，自己就对上了', after.nextTime === true, JSON.stringify(after));
ok('气泡换成了图', await page.locator('.bubble-sticker img').count() === 1);

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
