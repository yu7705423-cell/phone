// 花钱排查：重排结果缓存（重新生成不再付第二次）、后台自己跑的几项摆进「用量与上限」、bondAuto 判断一致
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});
const log = []; const sent = []; const sentTopN = [];
await ctx.route('**/relay.example.com/**', async route => {
  const req = route.request(); const u = req.url(); const body = JSON.parse(req.postData() || '{}');
  if (u.includes('/embeddings')) {
    const input = Array.isArray(body.input) ? body.input : [body.input];
    log.push('embed');
    return route.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ data: input.map((_, i) => ({ index:i, embedding: Array.from({length:8}, (_, k) => Math.sin(i + k + input[i].length)) })) }) });
  }
  if (u.includes('/rerank')) {
    log.push('rerank'); sent.push(body.documents.length); sentTopN.push(body.top_n);
    // 分数按正文里的数字算，和顺序无关 —— 同一条换个位置分数不变
    const results = body.documents.map((d, i) => ({ index:i, relevance_score: Number((d.match(/\d+/) || ['0'])[0]) / 1000 }))
      .sort((a, b) => b.relevance_score - a.relevance_score).slice(0, body.top_n || body.documents.length);
    return route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ results }) });
  }
  if (u.includes('/chat/completions')) {
    log.push('chat');
    const t = '好的。';
    return route.fulfill({ status:200, contentType:'text/event-stream',
      body: [...t].map(ch => `data: ${JSON.stringify({ choices:[{ delta:{ content: ch } }] })}\n\n`).join('') + 'data: [DONE]\n\n' });
  }
  return route.fulfill({ status:404, body:'' });
});
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1600);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};
const count = k => log.filter(x => x === k).length;

await page.evaluate(async () => {
  const svc=(await import('/src/system/ai/services.js'));
  svc.setRerank({ baseUrl:'https://relay.example.com/v1', apiKey:'k', model:'rr' });
});

// ---- 一、rankQueued 本身 ----
const unit = await page.evaluate(async () => {
  const r=(await import('/src/system/ai/rerank.js'));
  const docs = ['第5条', '第9条', '第1条', '第7条'];
  const a = await r.rankQueued('t', '查询甲', docs, { topN: 2 });
  const b = await r.rankQueued('t', '查询甲', docs.slice().reverse(), { topN: 2 });
  const c = await r.rankQueued('t', '查询甲', ['第9条', '第5条', '第1条'], { topN: 2 });
  const d = await r.rankQueued('t', '查询甲', [...docs, '第8条'], { topN: 2 });
  const e = await r.rankQueued('t', '查询乙', docs, { topN: 2 });
  const names = (list, got) => got.map(x => list[x.index]);
  return {
    a: names(docs, a), b: names(docs.slice().reverse(), b), c: names(['第9条', '第5条', '第1条'], c),
    d: names([...docs, '第8条'], d), e: names(docs, e),
  };
});
ok('第一次照常排', JSON.stringify(unit.a) === '["第9条","第7条"]', JSON.stringify(unit.a));
ok('同一批换个顺序：不再调接口，名次一样', JSON.stringify(unit.b) === '["第9条","第7条"]', JSON.stringify(unit.b));
ok('上次送过的一部分：不再调接口，名次正确', JSON.stringify(unit.c) === '["第9条","第5条"]', JSON.stringify(unit.c));
ok('多了一条没送过的：只补这一条，名次正确', JSON.stringify(unit.d) === '["第9条","第8条"]' && sent[1] === 1, JSON.stringify(unit.d) + ' 送了 ' + JSON.stringify(sent));
ok('换了查询：重新调', JSON.stringify(unit.e) === '["第9条","第7条"]', JSON.stringify(unit.e));
ok('五次里只打了三次重排', count('rerank') === 3, `${count('rerank')} 次`);
ok('不再向接口要 top_n（要了排在后面的就没有分数）', sentTopN.every(x => !x), JSON.stringify(sentTopN));

// ---- 二、真实一轮 + 重新生成 ----
log.length = 0;
const ids = await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  const svc=(await import('/src/system/ai/services.js'));
  const acc=(await import('/src/system/accounts.js'));
  const p = svc.newChatPreset({ name:'主用' });
  svc.updateChatPreset(p.id, { baseUrl:'https://relay.example.com/v1', apiKey:'k', model:'m', provider:'openai' });
  svc.setActiveChat(p.id);
  svc.setEmbed({ baseUrl:'https://relay.example.com/v1', apiKey:'k', model:'emb' });
  db.settings.set({ memoryEnabled:true, memoryVector:true, rerankOn:true });
  const me = acc.current();
  const ch = db.characters.create({ name:'小林', persona:'花店店员。' });
  const chat = db.chats.create({ characterIds:[ch.id], personaId: me.id, title:'' });
  for (let i = 0; i < 80; i++) {
    db.memories.create({ charId: ch.id, personaId: me.id, content:`第${i}条：用户说过喜欢花和茶`,
      category:'fact', rank:'B', keywords:['花','茶'], createdAt: Date.now() - i * 60000, updatedAt: Date.now() });
  }
  for (let i = 0; i < 6; i++) db.messages.create({ chatId: chat.id, role: i % 2 ? 'char' : 'user', authorId: i % 2 ? ch.id : 'me',
    kind:'text', content:`第${i}句，关于花和茶`, status:'done' });
  return { ch: ch.id, chat: chat.id };
});
const turn = () => page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const e=(await import('/src/system/ai/engine.js'));
  await e.streamReply({ chat: db.chats.get(o.chat), char: db.characters.get(o.ch) });
}, ids);
await turn();
ok('一轮：向量 1、重排 1、聊天 1', count('embed') === 1 && count('rerank') === 1 && count('chat') === 1, JSON.stringify(log));
log.length = 0;
await turn();   // 重新生成：同样的上下文（中间召回过的那几条已经疲劳，本地顺序变了）
const regenSent = sent[sent.length - 1];
console.log('  ..   重新生成时重排：', count('rerank'), '次，送了', count('rerank') ? regenSent : 0, '条');
ok('重新生成：向量不再调；重排要么不调，要么只补换进来的那几条',
  count('embed') === 0 && count('chat') === 1 && (count('rerank') === 0 || regenSent < 50), JSON.stringify(log) + ' 最后一次送了 ' + regenSent);
log.length = 0;
await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  db.messages.create({ chatId: o.chat, role:'user', authorId:'me', kind:'text', content:'换个话题，聊聊花', status:'done' });
}, ids);
await turn();
ok('发了新消息：照常各调一次', count('embed') === 1 && count('rerank') === 1, JSON.stringify(log));

// ---- 三、后台自己跑的几项进了「用量与上限」 ----
const act = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const c=(await import('/src/system/ai/cost.js'));
  const svc=(await import('/src/system/ai/services.js'));
  const g=(await import('/src/system/group.js'));
  const ids0 = c.active().map(x => x.id);
  db.characters.update(o.ch, { proactive: true });
  const b = db.characters.create({ name:'阿树', persona:'x' });
  const grp = g.create({ ids:[o.ch, b.id] });
  g.setProactive(grp.id, { on: true });
  svc.setVision({ mode: 'chat' });
  const ids1 = c.active().map(x => x.id);
  return { ids0, ids1 };
}, ids);
ok('关着时不列', !act.ids0.includes('proactive') && !act.ids0.includes('groupProactive') && !act.ids0.includes('visionCarry'), JSON.stringify(act.ids0));
ok('开了之后：角色主动发消息、群里主动开口、图写成描述都列出来',
  ['proactive', 'groupProactive', 'visionCarry'].every(k => act.ids1.includes(k)), JSON.stringify(act.ids1));

await page.evaluate(async () => {
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('settings', '/limits');
});
await page.waitForTimeout(800);
const text = await page.locator('.page').last().innerText();
ok('「用量与上限」页上看得到这几项', /角色主动发消息/.test(text) && /群里主动开口/.test(text) && /图写成描述/.test(text), text.slice(0, 600));

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
