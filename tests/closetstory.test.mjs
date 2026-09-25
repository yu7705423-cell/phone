// 剧情里的衣帽间（system/closet-story.js，ARCHITECTURE 4.217）。
//
//   线上：角色写 [借走：…] [换上：…]，衣帽间跟着改，落一行提示；删掉那一行（重新生成）改回原样
//   线下：同样几个标记从正文里摘掉、照做；重写那一段先撤回再按新的一版做
//   塞进包里：角色放的收场前我看不到，它自己的提示词里记得；我放的它看不到；
//             收场后角色放的落成一张封着的卡片，点开才看得见；我放的落一行它到家发现了什么
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const reqs = [];
let reply = '好。';
await ctx.route('**/relay.example.com/**', async route => {
  const body = JSON.parse(route.request().postData() || '{}');
  reqs.push(body);
  return route.fulfill({ status: 200, contentType: 'text/event-stream',
    body: [...reply].map(ch => `data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`).join('') + 'data: [DONE]\n\n' });
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
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  const scarf = cl.create({ group: 'acc', sub: '围巾', name: '红色围巾' });
  const hoodie = cl.create({ owner: c.id, group: 'top', sub: '卫衣', name: '灰色连帽衫' });
  const jacket = cl.create({ owner: c.id, group: 'outer', sub: '夹克', name: '旧皮夹克' });
  return { char: c.id, chat: chat.id, scarf: scarf.id, hoodie: hoodie.id, jacket: jacket.id };
});

// ---- 线上 ----
reply = '外面冷。\n[借走：红色围巾]\n[换上：灰色连帽衫]\n[借走：不存在的帽子]';
const on = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const e = await import('/src/system/ai/engine.js');
  const r = await import('/src/system/ai/reply.js');
  const cl = await import('/src/system/closet.js');
  const chat = db.chats.get(o.chat), char = db.characters.get(o.char);
  db.messages.create({ chatId: o.chat, role: 'user', authorId: 'me', kind: 'text', content: '今天穿什么出门', status: 'done' });
  const raw = await e.streamReply({ chat, char });
  const made = await r.renderTurn({ chat, char, raw, turnId: 't1', instant: true });
  const notes = made.filter(x => x.kind === 'notice').map(x => x.content);
  const after = { scarf: db.closet.get(o.scarf).lent?.to, worn: cl.wornToday(o.char).map(x => x.name) };
  made.filter(x => x.kind === 'notice').forEach(x => r.dropMessage(x.id));
  const undone = { scarf: db.closet.get(o.scarf).lent, worn: cl.wornToday(o.char).map(x => x.name) };
  return { notes, after, undone, texts: made.filter(x => x.kind === 'text').map(x => x.content) };
}, ids);
const sys = String(reqs[reqs.length - 1]?.messages?.[0]?.content || '');
ok('能力清单里有衣帽间的写法（聊到出门时细则也到了）', /\[借走：item\] (to borrow one of theirs|you borrow one of their items)/.test(sys), sys.slice(-1200));
ok('角色写 [借走：红色围巾]：我的围巾借给了它，落一行提示', on.after.scarf === ids.char && on.notes.includes('[阿岚借走了你的红色围巾]'), JSON.stringify(on));
ok('角色写 [换上：灰色连帽衫]：它今天穿着', on.after.worn.includes('灰色连帽衫') && on.notes.includes('[阿岚换上了灰色连帽衫]'), JSON.stringify(on));
ok('认不出的东西：当没写过，也不落提示', on.notes.length === 2 && !on.texts.some(t => /借走/.test(t)), JSON.stringify(on));
ok('删掉那几行提示（重新生成那一轮）：衣帽间改回原样', !on.undone.scarf && !on.undone.worn.includes('灰色连帽衫'), JSON.stringify(on.undone));

// ---- 线下 ----
const off = await ev(async o => {
  const sc = await import('/src/system/scene.js');
  const st = await import('/src/system/closet-story.js');
  const { db } = await import('/src/system/db/index.js');
  const e = await import('/src/system/ai/engine.js');
  const row = sc.create({ chatId: o.chat, title: '雨夜', inline: true });
  const b = sc.addBeat({ sceneId: row.id, role: sc.CHAR, authorId: o.char,
    text: '他把外套披在你肩上。\n[借给你：旧皮夹克]\n趁你不注意，他往你包里放了点什么。\n[塞进包里：一张写着「明天见」的便签]' });
  const lent1 = db.closet.get(o.jacket).lent?.to;
  // 我也往它包里放一样
  st.slip(row.id, { from: 'me', what: '一颗薄荷糖' });
  const { system } = e.buildSceneSystem(db.scenes.get(row.id), db.chats.get(o.chat), db.characters.get(o.char), sc.beatsOf(row.id));
  const history = e.buildSceneHistory(db.scenes.get(row.id), db.chats.get(o.chat), db.characters.get(o.char), sc.beatsOf(row.id));
  return { sceneId: row.id, beatId: b.id, text: b.text, acts: sc.actsOf(b).map(a => a.text || a.kind), lent1, system, history: JSON.stringify(history),
    slips: st.slipsOf(row.id).map(s => `${s.from}:${s.what}`) };
}, ids);
ok('线下正文里的标记摘掉了，不出现在我读到的正文里', off.text === '他把外套披在你肩上。\n\n趁你不注意，他往你包里放了点什么。' || !/\[(借给你|塞进包里)/.test(off.text), off.text);
ok('线下 [借给你：旧皮夹克]：它的夹克借给了我', off.lent1 === 'me' && off.acts.includes('阿岚把旧皮夹克借给了你'), JSON.stringify(off.acts));
ok('塞进包里的记在这一场上：角色放的、我放的各一样', JSON.stringify(off.slips) === JSON.stringify(['char:一张写着「明天见」的便签', 'me:一颗薄荷糖']), JSON.stringify(off.slips));
ok('线下提示词里有衣帽间的标记写法', /\[塞进包里：thing\] you slip something into their bag/.test(off.system), off.system.slice(-1500));
ok('角色自己放进去的，它的提示词里记得', /not yet found by [^\n]*\n- 一张写着「明天见」的便签/.test(off.system), off.system.slice(-600));
ok('我放进去的，它的提示词与历史里都看不到', !off.system.includes('薄荷糖') && !off.history.includes('薄荷糖'), '');

// 重写这一段：先撤回，再按新的一版做
const re = await ev(async o => {
  const sc = await import('/src/system/scene.js');
  const st = await import('/src/system/closet-story.js');
  const { db } = await import('/src/system/db/index.js');
  sc.addSwipe(o.beatId, { text: '他只是看着你走远。', raw: '他只是看着你走远。' });
  const a = { lent: db.closet.get(o.jacket).lent, slips: st.slipsOf(o.sceneId).map(s => s.what) };
  sc.pickSwipe(o.beatId, 0);
  const b = { lent: db.closet.get(o.jacket).lent?.to, slips: st.slipsOf(o.sceneId).map(s => s.what) };
  return { a, b };
}, { ...ids, ...off });
ok('重写那一段：夹克没借出去，便签也不在包里了', !re.a.lent && JSON.stringify(re.a.slips) === '["一颗薄荷糖"]', JSON.stringify(re));
ok('翻回原来那一版：按那一版再做一遍', re.b.lent === 'me' && re.b.slips.length === 2, JSON.stringify(re));

// ---- 收场 ----
await ev(async o => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/chat/${o.chat}`); }, ids);
await page.waitForTimeout(800);
const before = await ev(() => document.body.textContent.includes('明天见'));
ok('收场之前，会话里哪儿都看不到角色放了什么', !before, '');
const arrived = await ev(async o => {
  const sc = await import('/src/system/scene.js');
  const st = await import('/src/system/closet-story.js');
  const cl = await import('/src/system/closet.js');
  const { db } = await import('/src/system/db/index.js');
  sc.endScene(o.sceneId);
  const made = st.arrive(o.sceneId);
  const again = st.arrive(o.sceneId);
  return { kinds: made.map(m => m.kind), notice: made.find(m => m.kind === 'notice')?.content, again: again.length,
    charGot: cl.itemsOf(o.char).map(r => `${r.name}:${r.source}:${r.giver}`) };
}, { ...ids, ...off });
ok('收场：角色放的落成一张卡片，我放的落一行它到家发现了什么', JSON.stringify(arrived.kinds.sort()) === '["notice","slip"]'
  && arrived.notice === '[阿岚回到家打开包，发现了你偷偷放进去的：一颗薄荷糖]', JSON.stringify(arrived));
ok('只落一次', arrived.again === 0, '');
ok('我放的那颗糖进了它的衣帽间，记着是我送的', arrived.charGot.includes('一颗薄荷糖:gift:me'), JSON.stringify(arrived.charGot));
await page.waitForTimeout(600);
const sealed = await ev(() => {
  const b = [...document.querySelectorAll('.ph-slip')].pop();
  const list = [...document.querySelectorAll('.msg-preview')].map(x => x.textContent).join(' | ');
  return { text: b ? b.textContent : '', list };
});
ok('卡片点开之前只写「包里多了一样东西」', sealed.text.includes('包里多了一样东西') && !sealed.text.includes('明天见'), JSON.stringify(sealed));
await page.locator('.ph-slip').last().click();
await page.waitForTimeout(500);
const opened = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const msgs = db.messagesOf(o.chat);
  return { text: [...document.querySelectorAll('.ph-slip')].pop()?.textContent || '',
    note: msgs.filter(m => m.kind === 'notice').pop()?.content };
}, ids);
ok('点开：看到是什么，落一行我发现了什么（角色下一轮读到）', opened.text.includes('一张写着「明天见」的便签') && opened.note === '[打开包，发现了：一张写着「明天见」的便签]', JSON.stringify(opened));
await page.locator('.ph-slip .gift-closet').last().click();
await page.waitForTimeout(700);
const kept = await ev(async o => {
  const cl = await import('/src/system/closet.js');
  return cl.itemsOf('me').filter(r => r.name.includes('便签')).map(r => `${r.group}:${r.source}:${r.giver === o.char}`);
}, ids);
ok('「收进衣帽间」：放进我的随身，记着是它送的', JSON.stringify(kept) === '["carry:gift:true"]', JSON.stringify(kept));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
