// 心声与旁白「开了却不生成」的三个原因（ARCHITECTURE 4.266）：
//   群聊白名单里没有这两项；心声挂到旁白那一行上；「能力开关」页里关过一次会话里开着也不注入
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);

const r = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const e = await import('/src/system/ai/engine.js');
  const rp = await import('/src/system/ai/reply.js');
  const caps = await import('/src/system/ai/capabilities.js');
  const out = {};
  const a = db.characters.create({ name: '阿岚' });
  const b = db.characters.create({ name: '阿沅' });

  // 1. 群聊：开了旁白与心声，提示词里要有写法
  const g = db.chats.create({ characterIds: [a.id, b.id], group: true, narration: true, innerMode: 'inline', lastMessageAt: Date.now() });
  db.messages.create({ chatId: g.id, role: 'user', authorId: 'me', kind: 'text', content: '都在？', status: 'done' });
  const gs = e.buildGroupSystem(db.chats.get(g.id), [a, b], db.messagesOf(g.id)).system;
  out.groupNarr = /\[旁白：text\]/.test(gs);
  out.groupInner = /\[心声：/.test(gs);

  // 2. 心声写在旁白后面：要挂到最近一条正文上
  const c = db.chats.create({ characterIds: [a.id], narration: true, innerMode: 'inline', lastMessageAt: Date.now() });
  const parts = rp.splitReply('到了。\n[旁白：他把手机扣在桌上。]\n[心声：其实有点紧张。]');
  out.parts = parts.map(p => ({ type: p.type, inner: p.inner || '' }));
  const made = await rp.renderTurn({ chat: db.chats.get(c.id), char: db.characters.get(a.id), raw: '到了。\n[旁白：他把手机扣在桌上。]\n[心声：其实有点紧张。]', turnId: 't1', instant: true });
  out.made = made.map(m => ({ kind: m.kind, inner: m.inner || '' }));
  // 心声写在整轮开头（正文还没落下）：等下一条正文
  const head = rp.splitReply('[心声：先想好再说。]\n[旁白：他抬起头。]\n嗯。');
  out.head = head.map(p => ({ type: p.type, inner: p.inner || '' }));

  // 3. 「能力开关」里关过的记号不再管旁白与心声
  db.settings.set({ capsOff: ['narration', 'inner', 'dice'] });
  const off = caps.offSet(db.settings.get());
  out.offKeeps = !off.has('narration') && !off.has('inner') && off.has('dice');
  out.notListed = !caps.switchable().some(x => x.id === 'narration' || x.id === 'inner');
  const s1 = e.buildChatSystem(db.chats.get(c.id), db.characters.get(a.id), db.messagesOf(c.id)).system;
  out.stillOn = /\[旁白：text\]/.test(s1) && /\[心声：/.test(s1);
  out.atLeastOne = /at least one\s+narration line/.test(s1);
  db.settings.set({ capsOff: [] });
  return out;
});

ok('群聊里开了旁白：提示词里有旁白的写法', r.groupNarr, '');
ok('群聊里开了心声：提示词里有心声的写法', r.groupInner, '');
ok('心声写在旁白后面：挂到最近一条正文上，不挂到旁白上', r.parts[0].type === 'text' && r.parts[0].inner === '其实有点紧张。' && !r.parts[1].inner, JSON.stringify(r.parts));
ok('落库后心声在正文那一条上', r.made[0].kind === 'text' && r.made[0].inner === '其实有点紧张。' && !r.made[1].inner, JSON.stringify(r.made));
ok('心声写在整轮开头：等下一条正文落下来再挂', r.head.find(p => p.type === 'text')?.inner === '先想好再说。' && !r.head[0].inner, JSON.stringify(r.head));
ok('「能力开关」里的旧记号不再管旁白与心声', r.offKeeps, '');
ok('「能力开关」页不再列旁白与心声', r.notListed, '');
ok('能力开关关过也照常注入', r.stillOn, '');
ok('旁白的写法是每轮至少一行', r.atLeastOne, '');
ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
