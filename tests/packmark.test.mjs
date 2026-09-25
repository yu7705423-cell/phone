// 角色包导入成副本时，「已总结到这儿」的标记跟着换 id（ARCHITECTURE 4.224）。
//
//   本机已经有这个角色，导入就是副本：会话、消息、线下正文全换一套新 id。
//   会话上那两条水位线（memoryUpTo 指消息、memoryUpToBeat 指正文）要跟着换到新 id，
//   否则找不到那一条，整段历史又全算成没总结
//   原来那段会话的标记不受影响
//   换一台设备导入（id 不撞）照旧原样
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const ctx = await browser.newContext();
await ctx.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const r = await page.evaluate(async () => {
  const { db } = await import('/src/system/db/index.js');
  const mx = await import('/src/system/ai/tasks/memory-extract.js');
  const cp = await import('/src/system/charpack.js');
  const scene = await import('/src/system/scene.js');
  const backup = await import('/src/system/backup.js');
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id] });
  for (let i = 0; i < 6; i++) {
    db.messages.create({ chatId: chat.id, role: i % 2 ? 'char' : 'user', authorId: i % 2 ? c.id : 'me',
      kind: 'text', content: `第${i}条`, status: 'done', createdAt: 1000 + i });
  }
  const sc = scene.create({ chatId: chat.id, castIds: [c.id], title: '旧书店' });
  scene.addBeat({ sceneId: sc.id, role: 'char', authorId: c.id, text: '门上的铃响了一声。' });
  scene.addBeat({ sceneId: sc.id, role: 'me', text: '我把伞收起来。' });
  const out = { marked: mx.markCaughtUp(chat.id), before: mx.pendingOf(chat.id).length };
  // 标记之后又说了两句：这两句是没总结的
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '后来', status: 'done' });
  db.messages.create({ chatId: chat.id, role: 'char', authorId: c.id, kind: 'text', content: '嗯', status: 'done' });
  out.origPending = mx.pendingOf(chat.id).length;

  const origUpTo = db.chats.get(chat.id).memoryUpTo;
  const pack = await cp.read(new File([await cp.build(c.id, { history: true })], 'p.zip'));

  // 同一台设备导入：副本
  await cp.install(pack);
  const copy = db.chats.all().find(x => x.id !== chat.id);
  out.copied = !!copy && copy.id !== chat.id;
  out.copyPending = copy ? mx.pendingOf(copy.id).length : -1;
  out.copyUpToIsOwn = !!copy && db.messages.get(copy.memoryUpTo)?.chatId === copy.id;
  out.copyBeatIsOwn = !!copy && !!db.beats.get(copy.memoryUpToBeat)
    && db.scenes.get(db.beats.get(copy.memoryUpToBeat).sceneId)?.chatId === copy.id;
  out.origAfter = mx.pendingOf(chat.id).length;

  // 换一台设备导入：id 不撞，原样
  await backup.wipeAll();
  await cp.install(pack);
  const fresh = db.chats.all()[0];
  out.freshSame = fresh?.id === chat.id && fresh?.memoryUpTo === origUpTo;
  out.freshPending = fresh ? mx.pendingOf(fresh.id).length : -1;
  return out;
});
ok('原会话：标记之后只有新说的两句没总结', r.marked === 8 && r.before === 0 && r.origPending === 2, JSON.stringify(r));
ok('同一台设备导入成副本：副本里也只有那两句没总结，不是整段', r.copied && r.copyPending === 2, JSON.stringify(r));
ok('副本的两条标记指向副本自己的消息与正文', r.copyUpToIsOwn && r.copyBeatIsOwn, JSON.stringify(r));
ok('原会话的标记不受影响', r.origAfter === 2, JSON.stringify(r));
ok('换一台设备导入（id 不撞）：照旧原样', r.freshSame && r.freshPending === 2, JSON.stringify(r));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
