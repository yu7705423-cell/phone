import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const out = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const reply = await import('/src/system/ai/reply.js');
  const repair = await import('/src/system/ai/repair.js');
  const engine = await import('/src/system/ai/engine.js');
  const R = [];
  const ok = (name, cond, extra) => R.push({ name, pass: !!cond, extra });

  const me = acc.roots()[0] || acc.createRoot({ name: '小明' });
  const char = db.characters.create({ name: '阿岚', persona: 'x' });
  const chat = db.chats.create({ characterIds: [char.id], personaId: me.id, lastMessageAt: Date.now() });

  // --- 1. 引用解析 ---
  let p = reply.splitReply('[引用：今天下雨了]\n是啊，一整天。');
  ok('引用行被吃掉，不单独成气泡', p.length === 1 && p[0].text === '是啊，一整天。', JSON.stringify(p));
  ok('引用挂在下一条上', p[0].quote === '今天下雨了', p[0].quote);

  p = reply.splitReply('【回复: 你吃了吗】\n吃过了\n\n你呢');
  ok('全角括号 + 回复 也认', p.length === 2 && p[0].quote === '你吃了吗' && !p[1].quote, JSON.stringify(p));

  p = reply.splitReply('正常一句话，没有引用');
  ok('没引用就不带 quote', p.length === 1 && !p[0].quote);

  p = reply.splitReply('[引用：那张照片]\n[图片：海边的黄昏]');
  ok('引用也能挂到图片上', p.length === 1 && p[0].type === 'image' && p[0].quote === '那张照片', JSON.stringify(p));

  // --- 2. 引用认领出处 ---
  const m1 = db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '今天下雨了，懒得出门', status: 'done' });
  const src = reply.resolveQuote(chat.id, '今天下雨了');
  ok('能从原话片段认出出处', src && src.id === m1.id, src && src.content);
  ok('认不出来返回 null', reply.resolveQuote(chat.id, '完全不相干的一句') === null);

  const qf = reply.quoteFields(chat.id, '今天下雨了');
  ok('quoteFields 带出 id 和快照', qf.quoteId === m1.id && qf.quoteRole === 'user' && qf.quoteText.includes('下雨'), JSON.stringify(qf));
  const qf2 = reply.quoteFields(chat.id, '天上飞过一头牛');
  ok('认不出也存快照', qf2.quoteId === null && qf2.quoteText === '天上飞过一头牛', JSON.stringify(qf2));

  // --- 3. 引用进上下文 ---
  const m2 = db.messages.create({ chatId: chat.id, role: 'char', authorId: char.id, kind: 'text', content: '是啊', status: 'done', ...qf });
  const hist = engine.buildHistory(chat, char, db.messagesOf(chat.id));
  const joined = hist.map(h => h.content).join(' | ');
  ok('上下文里带上了引的是哪句',
    joined.includes('(in reply to 「') && joined.includes('今天下雨了'), joined);

  // 原话被删，快照还在
  reply.dropMessage(m1.id);
  const hist2 = engine.buildHistory(chat, char, db.messagesOf(chat.id));
  ok('原话删了引用不丢', hist2.map(h => h.content).join(' ').includes('今天下雨了'), JSON.stringify(hist2));

  // --- 4. 修格式 ---
  const mk = c => db.messages.create({ chatId: chat.id, role: 'char', authorId: char.id, kind: 'text', content: c, status: 'done' });

  let m = mk('阿岚：我在呢');
  let f = repair.fixesFor(m);
  ok('认出开头多的名字', f.some(x => x.id === 'prefix'), JSON.stringify(f.map(x => x.id)));
  repair.applyFix(m.id, 'prefix');
  ok('去掉名字前缀', db.messages.get(m.id).content === '我在呢', db.messages.get(m.id).content);

  m = mk('我在呢');
  ok('正常句子不报名字前缀', !repair.fixesFor(m).some(x => x.id === 'prefix'));

  m = mk('“那你早点睡吧”');
  repair.applyFix(m.id, 'wrap');
  ok('去掉整段包住的引号', db.messages.get(m.id).content === '那你早点睡吧', db.messages.get(m.id).content);

  m = mk('他说“好”，然后走了');
  ok('句中引号不当成包裹', !repair.fixesFor(m).some(x => x.id === 'wrap'), JSON.stringify(repair.fixesFor(m).map(x=>x.id)));

  m = mk('*歪了歪头* 怎么了');
  repair.applyFix(m.id, 'stars');
  ok('星号动作换成中文括号', db.messages.get(m.id).content === '（歪了歪头） 怎么了', db.messages.get(m.id).content);

  m = mk('第一句\\n\\n第二句');
  ok('认出字面 \\n', repair.fixesFor(m).some(x => x.id === 'escape'));
  repair.applyFix(m.id, 'escape');
  ok('还原成真换行', db.messages.get(m.id).content.includes('\n'), JSON.stringify(db.messages.get(m.id).content));

  // 重新分条 + 歪掉的图片标记
  m = mk('你看这个\n（图片:海边的黄昏）\n好看吧');
  f = repair.fixesFor(m);
  ok('认出该重新分条', f.some(x => x.id === 'rows'), JSON.stringify(f.map(x => x.id)));
  const before = db.messagesOf(chat.id).length;
  repair.applyFix(m.id, 'rows');
  const after = db.messagesOf(chat.id);
  ok('原消息被替换掉', !db.messages.has(m.id));
  ok('拆成了 3 条', after.length === before + 2, `${before} -> ${after.length}`);
  const img = after.filter(x => x.kind === 'image');
  ok('中间那条认成了图片', img.length === 1 && img[0].prompt === '海边的黄昏', JSON.stringify(img.map(x=>x.prompt)));
  // 顺序：拆出来的三条要连在一起，不能跑到最后面
  const idx = after.findIndex(x => x.kind === 'image');
  ok('拆出来的排在原位（前后相连）',
    after[idx - 1] && after[idx - 1].content === '你看这个' && after[idx + 1] && after[idx + 1].content === '好看吧',
    JSON.stringify(after.slice(Math.max(0,idx-2), idx+3).map(x => x.content)));

  m = mk('就一句普通的话');
  ok('普通单句没有可修的', repair.fixesFor(m).length === 0, JSON.stringify(repair.fixesFor(m)));

  // 一键全修
  m = mk('阿岚：“*笑* 我看看”');
  const done = repair.applyAll(m.id);
  ok('一键全修叠着改完', db.messages.get(m.id) && db.messages.get(m.id).content === '（笑） 我看看',
    JSON.stringify([done, db.messages.get(m.id) && db.messages.get(m.id).content]));

  // --- 5. 删除后的记忆锚点 ---
  const c2 = db.chats.create({ characterIds: [char.id], personaId: me.id, lastMessageAt: Date.now() });
  const a1 = db.messages.create({ chatId: c2.id, role: 'user', authorId: 'me', kind: 'text', content: 'a', status: 'done', createdAt: 1000 });
  const a2 = db.messages.create({ chatId: c2.id, role: 'char', authorId: char.id, kind: 'text', content: 'b', status: 'done', createdAt: 2000 });
  const a3 = db.messages.create({ chatId: c2.id, role: 'user', authorId: 'me', kind: 'text', content: 'c', status: 'done', createdAt: 3000 });
  db.chats.update(c2.id, { memoryUpTo: a2.id });
  const mex = await import('/src/system/ai/tasks/memory-extract.js');
  ok('锚点在时只剩 1 条未总结', mex.pendingOf(c2.id).length === 1);

  return R;
});

await browser.close();
let bad = 0;
for (const r of out) {
  if (!r.pass) bad++;
  console.log(`${r.pass ? '  ok  ' : '  FAIL'} ${r.name}${r.pass ? '' : '   << ' + (r.extra ?? '')}`);
}
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e => console.log('  ' + e)); }
console.log(`\n${out.length - bad}/${out.length} 通过`);
process.exit(bad || errs.length ? 1 : 0);
