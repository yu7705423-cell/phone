// 世界书开关不再连带进编辑页；组装出来的 prompt 全文过一遍书面语检查
import { BASE, EXE, chromium } from './_env.mjs';
const b = await chromium.launch({ executablePath:EXE, args:['--no-sandbox','--no-first-run'] });
const page = await b.newPage({ viewport:{width:430,height:932}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.route('**/*', r => r.request().url().startsWith(`${BASE}`) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push(!!c);console.log(`${c?'  ok   ':'  FAIL '}${n}${c?'':'   << '+(e??'')}`);};
await page.locator('.lock-unlock').click(); await page.waitForTimeout(400);

// ---- 一、世界书：拨开关不应该进编辑页 ----
const bookId = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const bk = db.lorebooks.create({ name:'测试世界书', global:false, entries:[
    { id:'e1', comment:'条目一', content:'内容', keys:['x'], enabled:true, part:'before', depth:0 },
  ]});
  const nav = await import('/src/system/nav.js'); nav.openApp('lorebook', `/book/${bk.id}`);
  return bk.id;
});
await page.waitForTimeout(700);
ok('停在世界书页', (await page.locator('.nav-title').first().innerText()).includes('测试世界书'),
  await page.locator('.nav-title').first().innerText());
await page.locator('.list-item .switch').last().click();
await page.waitForTimeout(600);
const after = await page.evaluate(async id => {
  const db = await import('/src/system/db/index.js');
  const n = await import('/src/system/nav.js');
  return { enabled: db.lorebooks.get(id).entries[0].enabled, route: n.currentRoute() };
}, bookId);
ok('开关真的关掉了', after.enabled === false, JSON.stringify(after));
ok('没有连带进编辑页', after.route === `/book/${bookId}`, after.route);
await page.locator('.list-item').last().click();
await page.waitForTimeout(600);
ok('点整行还是进得去编辑页',
  (await page.evaluate(async () => (await import('/src/system/nav.js')).currentRoute())).startsWith('/entry/'),
  await page.evaluate(async () => (await import('/src/system/nav.js')).currentRoute()));

// ---- 二、整段 prompt 过一遍书面语检查 ----
const dump = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const eng = await import('/src/system/ai/engine.js');
  const day = await import('/src/system/day.js');
  const c = db.characters.create({ name:'阿岚', persona:'二十二岁，美院大三', dayOn:true,
    canSendVoice:true, canSendImage:true, core:'说话简短，不解释' });
  const chat = db.chats.create({ characterIds:[c.id] });
  db.messages.create({ chatId:chat.id, role:'user', authorId:'me', kind:'text', content:'在吗', status:'done' });
  // 排一天，好让「你今天」那一块真的出现
  day.save(c.id, { date: day.dateKey(c), luck: -1.5,
    items:[{ slot: day.slotNow(c).id, text:'参与美术社的例行集体会议' }],
    event:{ eventId:'x', text:'路上遇到修路', tone:'bad', slot: day.slotNow(c).id },
    meals:[] });
  db.settings.set({ injectTime:true });
  return eng.buildChatSystem(chat, c, db.messagesOf(chat.id)).system;
});
console.log('\n---- 你今天 ----');
console.log((dump.match(/\[你今天\][\s\S]*?(?=\n\n\[|$)/) || ['(没有这一块)'])[0]);

const RULES = [
  [/[呀嘛啦哦咯][。！？，、\n]/u, '句末语气词'],
  [/[吧呢][。！？\n]/u, '句末语气词吧呢'],
  [/别(写|说|让|问|提|做|用|把|给|当|太|忘|急|去|再|管|挑)/u, '别…'],
  [/而已|反正|干脆|顺手|省得|压根|甭|一上来|拿不准|凭空/u, '口头连接'],
  [/就(行|好|是了|完了)/u, '就行一类'],
  [/啥|咋|瞎|老是|成天|一堆|好几|不痛快|走背字|上火|小作文|边角料|吐槽|使劲/u, '口语词'],
  [/——/u, '破折号'],
];
// 「」里引的是被举例、被禁止的原话，不算
const body = dump.replace(/「[^」\n]*」/gu, '「」')
  .replace(/\[示例\][\s\S]*?(?=\n\n\[)/u, '');
console.log('\n---- 逐条查 ----');
for (const [re, why] of RULES) {
  const hit = body.match(re);
  const at = hit ? body.indexOf(hit[0]) : -1;
  ok(`整段 prompt 里没有${why}`, !hit, hit ? '…' + body.slice(Math.max(0,at-20), at+20).replace(/\n/g,' ') + '…' : '');
}
ok('prompt 里不写「她」「他」', !/(?<!其)他(?!们|人)|她/u.test(body.replace(/\[你是谁\][\s\S]*?(?=\n\n\[)/u,'')),
  (body.match(/.{0,14}[她他].{0,14}/u)||[''])[0]);
console.log('\n全文', dump.length, '字');
if (errs.length) console.log('\n报错:', errs.join('\n'));
await b.close();
const bad = R.filter(x=>!x).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
