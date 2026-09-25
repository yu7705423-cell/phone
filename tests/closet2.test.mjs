// 衣帽间第二期（system/closet.js、apps/closet/OutfitPages.js、chat/pages/OutfitBits.js，ARCHITECTURE 4.214）。
//
//   套装：几件单品存成一套、今天穿这一套、从今天穿的存为套装
//   角色搭配：角色写 [搭配：名字 | 甲、乙]，会话里落一张卡片，按名字认出我衣帽间里的那几件，点「存为套装」
//   我替角色挑一套：在角色的衣帽间里存好一套，发到和它的会话，卡片进历史
//   按角色设定生成：一次调用，结果先列出来，勾选后才入库
//   好久没穿：一次一件、隔几天、同一件一段闲置只递一次
//   生图参考今天穿的：默认关；开了之后画面里点了名的人带上今天穿的
//   角色包：套装里的单品 id 跟着换成新的
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const reqs = [];
let reply = '好。';
let json = '{}';
await ctx.route('**/relay.example.com/**', async route => {
  const body = JSON.parse(route.request().postData() || '{}');
  reqs.push(body);
  if (body.stream) {
    return route.fulfill({ status: 200, contentType: 'text/event-stream',
      body: [...reply].map(ch => `data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`).join('') + 'data: [DONE]\n\n' });
  }
  return route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: json } }] }) });
});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);

const ids = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newChatPreset({ name: '主用' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm', provider: 'openai' });
  svc.setActiveChat(p.id);
  const cl = await import('/src/system/closet.js');
  const c = db.characters.create({ name: '阿岚', persona: '在书店工作，喜欢旧外套。' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  const knit = cl.create({ group: 'top', sub: '针织 / 毛衣', name: '白色针织衫', desc: '宽松的米白色粗针毛衣' });
  const jeans = cl.create({ group: 'bottom', sub: '牛仔裤', name: '直筒牛仔裤' });
  const shoes = cl.create({ group: 'shoes', sub: '运动鞋', name: '帆布鞋' });
  const coat = cl.create({ group: 'outer', sub: '大衣', name: '驼色大衣' });
  return { char: c.id, chat: chat.id, knit: knit.id, jeans: jeans.id, shoes: shoes.id, coat: coat.id };
});

// ---- 套装 ----
const fit = await ev(async o => {
  const cl = await import('/src/system/closet.js');
  const { db } = await import('/src/system/db/index.js');
  const a = cl.createOutfit({ name: '周末出门', items: [o.knit, o.jeans, o.shoes] });
  cl.wear(o.coat, true);
  cl.wearOutfit(a.id);
  const worn = cl.wornToday('me').map(r => r.name).sort();
  const again = db.closet.get(a.id).wornCount;
  cl.wearOutfit(a.id);
  const b = cl.outfitFromToday('me', '今天这身');
  return {
    worn, count: again, count2: db.closet.get(a.id).wornCount,
    list: cl.outfitsOf('me').map(x => x.name),
    fromToday: cl.outfitItems(b).map(r => r.name).sort(),
    // 套装不混进单品的查询
    inWear: cl.itemsOf('me').filter(r => r.side === 'wear').map(r => r.name),
    lines: cl.listLines('me', undefined, 'wear', 0).join(' '),
  };
}, ids);
ok('今天穿这一套：今天穿的换成这几件，不在套装里的取消', JSON.stringify(fit.worn) === JSON.stringify(['帆布鞋', '白色针织衫', '直筒牛仔裤']), JSON.stringify(fit));
ok('同一天穿两次，这一套只记一次', fit.count === 1 && fit.count2 === 1, JSON.stringify(fit));
ok('从今天穿的存为套装', JSON.stringify(fit.fromToday) === JSON.stringify(['帆布鞋', '白色针织衫', '直筒牛仔裤']), JSON.stringify(fit));
ok('套装不混进单品列表与给角色的清单', !fit.inWear.includes('周末出门') && !fit.lines.includes('周末出门') && fit.list.includes('周末出门'), JSON.stringify(fit));

// ---- 角色搭配：解析、卡片、存为套装 ----
reply = '今天降温了。\n[搭配：书店值班 | 白色针织衫、驼色大衣、帆布鞋、红色围巾]';
const card = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const e = await import('/src/system/ai/engine.js');
  const r = await import('/src/system/ai/reply.js');
  const chat = db.chats.get(o.chat), char = db.characters.get(o.char);
  db.messages.create({ chatId: o.chat, role: 'user', authorId: 'me', kind: 'text', content: '明天穿什么好', status: 'done' });
  const raw = await e.streamReply({ chat, char });
  const made = await r.renderTurn({ chat, char, raw, turnId: 'fit1', instant: true });
  const m = made.find(x => x.kind === 'outfit');
  return { kinds: made.map(x => x.kind), m };
}, ids);
const sys = String(reqs[reqs.length - 1]?.messages?.[0]?.content || '');
ok('我这边衣橱有东西：能力清单里有搭配的写法', /\[搭配：outfit name \| item、item、item\]/.test(sys), sys.slice(-1500));
ok('聊到穿什么：搭配的细则跟着到', /\[搭配\]\nTo put together an outfit/.test(sys), '');
ok('角色写的 [搭配：…] 落成一张搭配卡片', card.m && card.m.outfitName === '书店值班' && card.m.outfitOwner === 'me', JSON.stringify(card));
ok('按名字认出我衣帽间里的三件，认不出的留着名字',
  card.m && JSON.stringify(card.m.outfitItems.map(x => !!x.id)) === '[true,true,true,false]'
  && card.m.outfitItems[3].name === '红色围巾', JSON.stringify(card.m?.outfitItems));
ok('卡片正文是协议行，历史里角色读到的就是它', card.m?.content === '[搭配：书店值班 | 白色针织衫、驼色大衣、帆布鞋、红色围巾]', card.m?.content);

await ev(async o => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/chat/${o.chat}`); }, ids);
await page.waitForTimeout(800);
const bubble = await ev(() => {
  const b = [...document.querySelectorAll('.ph-outfit')].pop();
  return b ? { text: b.textContent, pieces: b.querySelectorAll('.fit-piece').length, miss: b.querySelectorAll('.fit-piece.is-miss').length } : null;
});
ok('会话里画出搭配卡片：四件，一件画成灰的', bubble && bubble.pieces === 4 && bubble.miss === 1 && bubble.text.includes('书店值班'), JSON.stringify(bubble));
await page.locator('.ph-outfit .gift-closet').last().click();
await page.waitForTimeout(800);
const saved = await ev(async o => {
  const cl = await import('/src/system/closet.js');
  const { db } = await import('/src/system/db/index.js');
  const m = db.messages.all().find(x => x.kind === 'outfit');
  const s = cl.outfitOfMsg(m.id);
  return { s: s && { name: s.name, by: s.by, items: cl.outfitItems(s).map(r => r.name) }, title: document.querySelector('.page-title, .nav-title')?.textContent || '', body: document.body.textContent.includes('阿岚搭配') };
}, ids);
ok('点「存为套装」：存成一套，记着是角色搭的', saved.s && saved.s.name === '书店值班' && saved.s.by === ids.char
  && saved.s.items.length === 3, JSON.stringify(saved));
ok('打开的是那一套的页面', saved.body, JSON.stringify(saved));

const undo = await ev(async o => {
  const cl = await import('/src/system/closet.js');
  const { db } = await import('/src/system/db/index.js');
  const m = db.messages.all().find(x => x.kind === 'outfit');
  const again = cl.keepOutfit(m);
  return { same: again.id === cl.outfitOfMsg(m.id).id, n: cl.outfitsOf('me').filter(x => x.fromMsgId === m.id).length };
}, ids);
ok('同一张卡片存第二次，打开的还是那一套', undo.same && undo.n === 1, JSON.stringify(undo));

// ---- 我替角色挑一套，发到会话 ----
const mine = await ev(async o => {
  const cl = await import('/src/system/closet.js');
  const { db } = await import('/src/system/db/index.js');
  const a = cl.create({ owner: o.char, group: 'outer', sub: '夹克', name: '旧皮夹克' });
  const b = cl.create({ owner: o.char, group: 'bottom', sub: '长裤', name: '黑色长裤' });
  const f = cl.createOutfit({ owner: o.char, name: '约会', items: [a.id, b.id] });
  const m = cl.sendOutfit(f.id);
  return { role: m.role, owner: m.outfitOwner, content: m.content, all: m.outfitItems.every(x => x.id), chat: m.chatId };
}, ids);
ok('在角色的衣帽间挑好一套发过去：落成我发的卡片，认的是它的衣帽间',
  mine.role === 'user' && mine.owner === ids.char && mine.all && mine.chat === ids.chat && mine.content === '[搭配：约会 | 旧皮夹克、黑色长裤]', JSON.stringify(mine));

// ---- 按角色设定生成 ----
json = JSON.stringify({ items: [
  { group: 'outer', sub: '风衣', name: '卡其风衣', desc: '及膝长度', colors: ['beige'], seasons: ['autumn'], occasions: ['daily'] },
  { group: 'outer', sub: '夹克', name: '旧皮夹克', desc: '已经有了' },
  { group: 'lip', sub: '口红', name: '不该出现在衣橱里' },
  { group: 'top', sub: '不存在的小类', name: '灰色卫衣' },
] });
const gen = await ev(async o => {
  const t = await import('/src/system/ai/tasks/closet.js');
  const cl = await import('/src/system/closet.js');
  const before = cl.itemsOf(o.char).length;
  const rows = await t.wardrobe(o.char, { count: 4, side: 'wear' });
  const mid = cl.itemsOf(o.char).length;
  t.keepWardrobe(o.char, rows.slice(0, 1));
  return { names: rows.map(r => r.name), subs: rows.map(r => r.sub), before, mid, after: cl.itemsOf(o.char).map(r => r.name) };
}, ids);
const genReq = reqs[reqs.length - 1];
ok('生成：一次调用，按角色设定写', String(genReq?.messages?.[0]?.content || '').includes('在书店工作'), '');
ok('生成的结果先不入库', gen.mid === gen.before, JSON.stringify(gen));
ok('已有的同名、不属于衣橱的丢掉；认不出的小类留空', JSON.stringify(gen.names) === JSON.stringify(['卡其风衣', '灰色卫衣'])
  && gen.subs[1] === '', JSON.stringify(gen));
ok('勾选的那几件才放进角色的衣帽间', gen.after.includes('卡其风衣') && !gen.after.includes('灰色卫衣'), JSON.stringify(gen));

// ---- 好久没穿 ----
const idle = await ev(async () => {
  const cl = await import('/src/system/closet.js');
  const { db } = await import('/src/system/db/index.js');
  const D = 86400000;
  const now = Date.now();
  const a = cl.create({ group: 'top', sub: '衬衫', name: '条纹衬衫' });
  const b = cl.create({ group: 'top', sub: '衬衫', name: '白衬衫' });
  const never = cl.create({ group: 'top', sub: '衬衫', name: '没穿过的衬衫' });
  db.closet.update(a.id, { wornCount: 3, lastWorn: now - 120 * D });
  db.closet.update(b.id, { wornCount: 1, lastWorn: now - 90 * D });
  const d0 = cl.takeIdle(undefined, now)?.name;
  const d0b = cl.takeIdle(undefined, now + 3600000)?.name;
  const d2 = cl.takeIdle(undefined, now + 2 * D)?.name || null;
  const d8 = cl.takeIdle(undefined, now + 8 * D)?.name;
  const d16 = cl.takeIdle(undefined, now + 16 * D)?.name || null;
  // 条纹衬衫又穿了一次，之后又闲了很久：重新算
  db.closet.update(a.id, { lastWorn: now + 17 * D });
  // 今天穿着的那几件到第 90 天也闲了，而且更久；挪到条纹衬衫之后，让它仍是最久的那一件
  cl.itemsOf('me').filter(r => r.side === 'wear' && r.lastWorn && r.id !== a.id && r.id !== b.id)
    .forEach(r => db.closet.update(r.id, { lastWorn: now + 20 * D }));
  const d90 = cl.takeIdle(undefined, now + 90 * D)?.name || null;
  return { d0, d0b, d2, d8, d16, d90, never: never.id };
});
ok('好久没穿：一次一件，最久没穿的先', idle.d0 === '条纹衬衫', JSON.stringify(idle));
ok('当天一整天都在', idle.d0b === '条纹衬衫', JSON.stringify(idle));
ok('两次之间至少隔 7 天', idle.d2 === null, JSON.stringify(idle));
ok('过了间隔递下一件，同一件不再递', idle.d8 === '白衬衫', JSON.stringify(idle));
ok('都递过了就不再有（没穿过的不算）', idle.d16 === null, JSON.stringify(idle));
ok('再穿一次之后又闲置：重新算', idle.d90 === '条纹衬衫', JSON.stringify(idle));

const ctxLine = await ev(async () => {
  const b = await import('/src/system/ai/context/closet.js');
  const cl = await import('/src/system/closet.js');
  const { db } = await import('/src/system/db/index.js');
  db.closet.all().filter(r => r.idleAt).forEach(r => db.closet.update(r.id, { idleAt: 0 }));
  const acc = await import('/src/system/accounts.js');
  return b.build({ persona: acc.current(), messages: [], settings: db.settings.get() });
});
ok('好久没穿的那一件进上下文，只写事实', /has not worn this for a while\n- \S+ \(.*\): last worn \d{4}-\d{2}-\d{2}, \d+ days ago/.test(ctxLine), ctxLine);

// ---- 生图参考今天穿的 ----
const img = await ev(async o => {
  const ip = await import('/src/system/ai/imageprompt.js');
  const cl = await import('/src/system/closet.js');
  const { db } = await import('/src/system/db/index.js');
  const char = db.characters.get(o.char);
  const off = ip.compose({ prompt: '阿岚和我的合照，在书店门口', char });
  db.settings.set({ closetInImage: true });
  const jacket = cl.itemsOf(o.char).find(r => r.name === '旧皮夹克');
  cl.wear(jacket.id, true);
  const on = ip.compose({ prompt: '阿岚和我的合照，在书店门口', char });
  const alone = ip.compose({ prompt: '窗外的雨', char });
  db.settings.set({ closetInImage: false });
  return { off, on, alone };
}, ids);
ok('默认关：生图不读衣帽间', !img.off.includes('is wearing'), img.off);
ok('开了之后：合照带上两个人今天穿的', /阿岚 is wearing: 旧皮夹克/.test(img.on) && /is wearing: .*白色针织衫, 宽松的米白色粗针毛衣/.test(img.on), img.on);
ok('画面里没有人就不带', !img.alone.includes('is wearing'), img.alone);

// ---- 角色包：套装里的单品 id 跟着换 ----
const pack = await ev(async o => {
  const cp = await import('/src/system/charpack.js');
  const cl = await import('/src/system/closet.js');
  const { db } = await import('/src/system/db/index.js');
  const blob = await cp.build(o.char, { history: false });
  const res = await cp.install(await cp.read(new File([blob], 'x.zip')));
  const nid = res.copied ? res.charId : null;
  const f = nid && cl.outfitsOf(nid).find(x => x.name === '约会');
  return { nid: !!nid, items: f ? cl.outfitItems(f).map(r => `${r.owner === nid}:${r.name}`) : null, raw: f?.items };
}, ids);
ok('角色包复制安装：套装里的单品指向新角色的那几件', pack.items && pack.items.length === 2 && pack.items.every(x => x.startsWith('true:')), JSON.stringify(pack));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
