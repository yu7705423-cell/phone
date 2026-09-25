// 角色自己改锁屏密码（system/theirs.js 的 changeLock，ARCHITECTURE 4.222）。
//
//   第一次：能力在，角色写 [改密码：0214｜你的生日]，锁屏换成它，手机重新锁上，会话里一行提示（不写数字）
//   刚改过：不满间隔天数时能力不给，写了也不认 —— 频率是代码管的
//   聊到密码（「你怎么没有改我的生日」）：不受间隔限制，照样能改
//   重新生成那一轮（删掉那一行提示）：密码放回去
//   角色卡里关掉：一概不改
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const reqs = [];
let reply = '好。';
await ctx.route('**/relay.example.com/**', async route => {
  reqs.push(JSON.parse(route.request().postData() || '{}'));
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
  const c = db.characters.create({ name: '阿岚', birthday: '1998-03-07' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  return { char: c.id, chat: chat.id };
});
const turn = (say, text, turnId) => ev(async ({ chat, char, say, turnId }) => {
  const { db } = await import('/src/system/db/index.js');
  const e = await import('/src/system/ai/engine.js');
  const r = await import('/src/system/ai/reply.js');
  const th = await import('/src/system/theirs.js');
  th.open(char);
  db.messages.create({ chatId: chat, role: 'user', authorId: 'me', kind: 'text', content: say, status: 'done' });
  const raw = await e.streamReply({ chat: db.chats.get(chat), char: db.characters.get(char) });
  const made = await r.renderTurn({ chat: db.chats.get(chat), char: db.characters.get(char), raw, turnId, instant: true });
  const lk = th.lockOf(char);
  return { notes: made.filter(m => m.kind === 'notice').map(m => ({ id: m.id, content: m.content })),
    code: lk.code, why: lk.why, src: lk.src, hints: lk.hints, open: th.isOpen(char) };
}, { ...ids, say, turnId });
const sys = () => String(reqs[reqs.length - 1]?.messages?.[0]?.content || '');

const before = await ev(async o => (await import('/src/system/theirs.js')).lockOf(o.char).code, ids);
reply = '换了。\n[改密码：0214｜你的生日]';
const a = await turn('今天好冷', 'k1');
ok('从没改过：能力在', /\[改密码：/.test(sys()), sys().slice(-800));
ok('角色写 [改密码：0214｜你的生日]：锁屏换成它，含义留作答案', a.code === '0214' && a.why === '你的生日' && a.src === 'char', JSON.stringify(a));
ok('会话里一行提示，不写新密码', a.notes.length === 1 && a.notes[0].content === '[阿岚改了手机的锁屏密码]' && !a.notes[0].content.includes('0214'), JSON.stringify(a.notes));
ok('手机重新锁上；提示换成「新换的」那一条', a.open === false && /新换的，一共 4 位/.test(a.hints[0] || ''), JSON.stringify(a));

reply = '[改密码：1357｜随便]';
const b = await turn('嗯', 'k2');
ok('刚改过、没聊到密码：能力不给', !/\[改密码：/.test(sys()), '');
ok('写了也不认：密码还是上一次改的', b.code === '0214' && !b.notes.length, JSON.stringify(b));

reply = '好吧。\n[改密码：0307｜我的生日]';
const c = await turn('你怎么没有改我的生日', 'k3');
ok('聊到了（「你怎么没有改我的生日」）：不受间隔限制，能力在', /\[改密码\]/.test(sys()), '');
ok('照样能改', c.code === '0307' && c.notes.length === 1, JSON.stringify(c));

const undo = await ev(async ({ char, note }) => {
  const r = await import('/src/system/ai/reply.js');
  const th = await import('/src/system/theirs.js');
  r.dropMessage(note);
  return th.lockOf(char).code;
}, { ...ids, note: c.notes[0].id });
ok('重新生成那一轮（删掉那一行提示）：密码放回上一次的', undo === '0214', undo);

await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  db.characters.update(o.char, { canChangeLock: false });
}, ids);
reply = '[改密码：2468｜x]';
const d = await turn('把密码改了吧', 'k4');
ok('角色卡里关掉：能力不给，写了也不改', !/\[改密码：/.test(sys()) && d.code === '0214', JSON.stringify(d));
ok('第一次改之前的密码和后来的不一样（改动是真的发生了）', before !== '0214', before);

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
