// 衣帽间第三期（ARCHITECTURE 4.216）。
//
//   随身：「随身」那一类勾上是今天带着，给角色看时另起一段；生图不画它；换一套衣服不动它
//   借穿：借来的算在借的人身上，写明是谁的；两人之间没还的单列；归还后清掉
//   回忆：长按消息「记到衣帽间」、单品页手写；穿着那天角色读到最近几条
//   动作：单品页「在会话中使用」落一张动作卡片，正文是 [动作：…]
//   穿搭盲盒：主题卡片揭晓前不露我挑的；角色这期间写的 [搭配] 封着；揭晓后两边一起公开，落一行揭晓
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
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
  const knit = cl.create({ group: 'top', sub: '针织 / 毛衣', name: '白色针织衫' });
  const scarf = cl.create({ group: 'acc', sub: '围巾', name: '红色围巾' });
  const umbrella = cl.create({ group: 'carry', sub: '伞', name: '折叠伞' });
  const perfume = cl.create({ group: 'scent', sub: '香水', name: '木质香水', desc: '雪松与檀香' });
  const hoodie = cl.create({ owner: c.id, group: 'top', sub: '卫衣', name: '灰色连帽衫' });
  const jeans = cl.create({ owner: c.id, group: 'bottom', sub: '牛仔裤', name: '黑色牛仔裤' });
  const tie = cl.create({ owner: c.id, group: 'acc', sub: '领带', name: '深蓝领带' });
  return { char: c.id, chat: chat.id, knit: knit.id, scarf: scarf.id, umbrella: umbrella.id, perfume: perfume.id,
    hoodie: hoodie.id, jeans: jeans.id, tie: tie.id };
});
const block = () => ev(async o => {
  const b = await import('/src/system/ai/context/closet.js');
  const { db } = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  return b.build({ char: db.characters.get(o.char), persona: acc.current(), messages: [], settings: db.settings.get() });
}, ids);

// ---- 随身 ----
const carry = await ev(async o => {
  const cl = await import('/src/system/closet.js');
  const ip = await import('/src/system/ai/imageprompt.js');
  const { db } = await import('/src/system/db/index.js');
  cl.wear(o.knit, true); cl.wear(o.umbrella, true);
  const f = cl.createOutfit({ name: '一套', items: [o.scarf] });
  cl.wearOutfit(f.id);
  db.settings.set({ closetInImage: true });
  const img = ip.compose({ prompt: '我们的合照', char: db.characters.get(o.char) });
  db.settings.set({ closetInImage: false });
  return { worn: cl.wornToday('me').map(r => r.name).sort(), img, kind: cl.guessKind('一把雨伞') };
}, ids);
ok('换一套衣服，包里的伞还带着', carry.worn.includes('折叠伞') && carry.worn.includes('红色围巾') && !carry.worn.includes('白色针织衫'), JSON.stringify(carry.worn));
ok('生图不画包里带着的东西', !carry.img.includes('折叠伞') && carry.img.includes('红色围巾'), carry.img);
ok('送一把雨伞：认作随身', carry.kind && carry.kind.group === 'carry', JSON.stringify(carry.kind));
let b = await block();
ok('给角色看：包里带着的另起一段，不混进穿着的', /## In [^\n]*'s bag today\n- 折叠伞/.test(b) && !/wearing today\n[^#]*折叠伞/.test(b), b);

// ---- 借穿 ----
const loan = await ev(async o => {
  const cl = await import('/src/system/closet.js');
  cl.lend(o.hoodie, 'me');
  cl.wear(o.hoodie, true);
  cl.lend(o.scarf, o.char);
  return {
    mine: cl.wornToday('me').map(r => r.name), theirs: cl.wornToday(o.char).map(r => r.name),
    borrowed: cl.borrowedBy('me').map(r => r.name), between: cl.lentBetween(o.char).map(r => r.name).sort(),
  };
}, ids);
ok('借来的连帽衫：今天穿着算在我身上', loan.mine.includes('灰色连帽衫') && !loan.theirs.includes('灰色连帽衫'), JSON.stringify(loan));
ok('我的围巾借出去了：不再算我今天戴着', !loan.mine.includes('红色围巾'), JSON.stringify(loan));
ok('两人之间没还的都列得出来', JSON.stringify(loan.between) === JSON.stringify(['灰色连帽衫', '红色围巾']), JSON.stringify(loan));
b = await block();
ok('给角色看：借来的写明是它的', /灰色连帽衫[^\n]*borrowed from you on \d{4}-\d{2}-\d{2}/.test(b), b);
ok('给角色看：两人之间没还的单列', /## Lent between you and [^\n]*\n- 灰色连帽衫: yours, with /.test(b) && /- 红色围巾: [^\n]*'s, with you since/.test(b), b);
const back = await ev(async o => {
  const cl = await import('/src/system/closet.js');
  cl.giveBack(o.hoodie);
  return { mine: cl.wornToday('me').map(r => r.name), between: cl.lentBetween(o.char).map(r => r.name) };
}, ids);
ok('归还：不再算我穿着，也不再列在没还的里', !back.mine.includes('灰色连帽衫') && JSON.stringify(back.between) === '["红色围巾"]', JSON.stringify(back));

// ---- 回忆 ----
const msgId = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  return db.messages.create({ chatId: o.chat, role: 'char', authorId: o.char, kind: 'text', status: 'done',
    content: '上次去海边你就穿着这件' }).id;
}, ids);
await ev(async o => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/chat/${o.chat}`); }, ids);
await page.waitForTimeout(800);
// 长按那条消息。鼠标的 click({delay}) 触发不了这套手势，要发 touch
const bubble = page.locator('.msg').filter({ hasText: '上次去海边你就穿着这件' }).first();
await bubble.dispatchEvent('touchstart');
await page.waitForTimeout(700);
await bubble.dispatchEvent('touchend');
await page.waitForTimeout(500);
const menu = await page.locator('.sheet').innerText().catch(() => '(没打开)');
ok('消息长按菜单里有「记到衣帽间」', /记到衣帽间/.test(menu), menu.slice(0, 200));
if (/记到衣帽间/.test(menu)) {
  await page.getByText('记到衣帽间', { exact: true }).click();
  await page.waitForTimeout(900);
  await page.locator('.cl-pick-row', { hasText: '白色针织衫' }).click();
  await page.waitForTimeout(600);
}
const mem = await ev(async o => {
  const cl = await import('/src/system/closet.js');
  const { db } = await import('/src/system/db/index.js');
  return { mems: db.closet.get(o.knit).memories || [], page: document.body.textContent.includes('上次去海边你就穿着这件') };
}, ids);
ok('选一件东西：那句话记成它的回忆，记着是哪段对话', mem.mems.length === 1 && mem.mems[0].text === '上次去海边你就穿着这件'
  && mem.mems[0].chatId === ids.chat, JSON.stringify(mem));
ok('记完打开那一件，回忆列在单品页上', mem.page, '');
await ev(async o => { const cl = await import('/src/system/closet.js'); cl.wear(o.knit, true); }, ids);
b = await block();
ok('穿着它的那天，角色读到这条回忆（原话不翻译）', /白色针织衫[^\n]*remembered \d{4}-\d{2}-\d{2}: 「上次去海边你就穿着这件」/.test(b), b);

// ---- 动作卡片 ----
const use = await ev(async o => {
  const cl = await import('/src/system/closet.js');
  const { db } = await import('/src/system/db/index.js');
  const a = cl.useInChat(o.perfume, o.chat, '请你帮我喷上');
  const t = cl.useInChat(o.tie, o.chat, '帮你系上');
  return { a: a.content, t: t.content, acts: cl.actionsFor(db.closet.get(o.tie)), targets: cl.useTargets(db.closet.get(o.tie)).map(c => c.id) };
}, ids);
ok('动作卡片正文：动作、物品、描述', use.a === '[动作：请你帮我喷上「木质香水」（雪松与檀香）]', use.a);
ok('角色自己的东西写明是它的', use.t === '[动作：帮你系上「深蓝领带」（你的）]', use.t);
ok('领带给的是「系上」那几个动作', use.acts.includes('帮你系上'), JSON.stringify(use.acts));
await ev(async o => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('chat', `/chat/${o.chat}`); }, ids);
await page.waitForTimeout(800);
const groom = await ev(() => [...document.querySelectorAll('.ph-groom')].map(x => x.textContent.replace(/\s+/g, '')));
ok('会话里画出动作卡片', groom.some(t => t.includes('请你帮我喷上') && t.includes('木质香水')), JSON.stringify(groom));

// ---- 穿搭盲盒 ----
reply = '好，我也挑好了。\n[搭配：复古 | 白色针织衫、红色围巾]';
const box1 = await ev(async o => {
  const cl = await import('/src/system/closet.js');
  const { db } = await import('/src/system/db/index.js');
  const e = await import('/src/system/ai/engine.js');
  const r = await import('/src/system/ai/reply.js');
  const f = cl.createOutfit({ owner: o.char, name: '给阿岚的', items: [o.hoodie, o.jeans] });
  const m = cl.startDresscode(f.id, '九十年代复古');
  const chat = db.chats.get(o.chat), char = db.characters.get(o.char);
  const raw = await e.streamReply({ chat, char });
  const made = await r.renderTurn({ chat, char, raw, turnId: 'dc1', instant: true });
  const theirs = made.find(x => x.kind === 'outfit');
  return { m, theirs };
}, ids);
const lastSys = JSON.stringify(reqs[reqs.length - 1]?.messages || []);
ok('盲盒卡片的正文只有主题，不露我挑的那几件', box1.m.content.startsWith('[穿搭主题：九十年代复古]') && !/灰色连帽衫|黑色牛仔裤/.test(box1.m.content), box1.m.content);
ok('发给角色的请求里也看不到我挑的', !/灰色连帽衫|黑色牛仔裤/.test(lastSys.replace(/Lent between[^#]*/g, '').replace(/## Your own wardrobe[^#]*/g, '')), '');
ok('揭晓前角色写的 [搭配] 封着', box1.theirs && box1.theirs.sealed === true && box1.theirs.dresscodeId === box1.m.id, JSON.stringify(box1.theirs));
await page.waitForTimeout(500);
const sealed = await ev(() => {
  const s = [...document.querySelectorAll('.ph-outfit.is-sealed')].pop();
  const d = [...document.querySelectorAll('.ph-dresscode')].pop();
  return { sealed: !!s && !s.textContent.includes('白色针织衫'), box: d ? d.textContent : '' };
});
ok('封着的卡片不露单品；主题卡片上不露我挑的', sealed.sealed && !sealed.box.includes('灰色连帽衫'), JSON.stringify(sealed));
await page.locator('.ph-dresscode .gift-closet', { hasText: '揭晓' }).last().click();
await page.waitForTimeout(500);
const shown = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const msgs = db.messagesOf(o.chat);
  const note = msgs.filter(m => m.kind === 'notice').pop();
  const theirs = msgs.filter(m => m.kind === 'outfit').pop();
  return { note: note?.content, sealed: theirs?.sealed, dom: [...document.querySelectorAll('.ph-dresscode')].pop()?.textContent || '',
    open: [...document.querySelectorAll('.ph-outfit')].pop()?.textContent || '' };
}, ids);
ok('揭晓：落一行揭晓，写着两边各挑了什么', shown.note === '[穿搭揭晓：九十年代复古｜我为你挑的：灰色连帽衫、黑色牛仔裤｜你为我挑的：白色针织衫、红色围巾]', shown.note);
ok('揭晓后两张卡片都公开', shown.sealed === false && shown.dom.includes('灰色连帽衫') && shown.open.includes('白色针织衫'), JSON.stringify(shown));

// ---- 首页 ----
await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  db.settings.set({ closetOwner: 'me', closetSide: 'wear' });
  const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('closet', '/');
}, ids);
await page.waitForTimeout(800);
const home = await ev(() => [...document.querySelectorAll('.cl-strip')].map(x => x.textContent.replace(/\s+/g, '')));
ok('首页有「今天带着」一条，列着伞', home.some(t => t.startsWith('今天带着') && t.includes('折叠伞')), JSON.stringify(home));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
