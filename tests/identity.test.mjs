// 这部作品 / 这一场里的身份：按世界改写（ARCHITECTURE 4.283）
//   一、改写任务：把角色卡原文、简介、世界书交给模型，回来 { name, persona }；改写的是原来那份，不是改过一次的
//   二、长篇：身份填了进提示词；带着记忆那一档多一句「记忆记的是原来那个世界的事」，不带的没有
//   三、线下那一场：charAs 填了之后提示词里是新人设，角色卡原文不在；署名按新名字
//   四、界面：作品设定页、新建向导、这一场的设定页都有「按这里的世界改写」；改写结果先给看、存入后落库
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const reqs = [];
await ctx.route('**/relay.example.com/**', async route => {
  const body = JSON.parse(route.request().postData() || '{}');
  reqs.push(body);
  const json = { name: '沈砚', persona: '大周永安年间的书肆掌柜，性子冷，话少，与林一自幼相识。' };
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(json) } }] }) });
});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);

const r = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const work = await import('/src/system/work.js');
  const scene = await import('/src/system/scene.js');
  const novel = await import('/src/system/ai/tasks/novel.js');
  const engine = await import('/src/system/ai/engine.js');
  const acc = await import('/src/system/accounts.js');
  const a = svc.newChatPreset({ name: '甲', provider: 'openai' });
  svc.updateChatPreset(a.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm1' });
  svc.setActiveChat(a.id);
  const me = acc.roots()[0] || acc.createRoot({ name: '林一' });
  db.personas.update(me.id, { name: '林一', description: '在互联网公司上班，爱喝冰美式。' });
  const c = db.characters.create({ name: '阿岚', persona: '现代都市的程序员，住在地铁站旁，爱喝冰美式，说话冷淡。' });
  const chat = db.chats.create({ characterIds: [c.id], personaId: me.id, lastMessageAt: Date.now() });
  const book = db.lorebooks.create({ name: '大周', global: false, entries: [{ id: 'e1', comment: '大周', keys: ['周'], content: '架空古代王朝，有书肆与驿站。', enabled: true, constant: true, priority: 100, order: 0, part: 'before', depth: 0, probability: 100 }] });
  const w = work.create({ chatId: chat.id, kind: work.SAGA, title: '永安书肆', premise: '古代架空，两人在书肆重逢。', lorebookIds: [book.id], carry: true });
  const out = {};
  // 一
  const made = await novel.identity(w, { who: 'char' });
  out.made = made;
  const sys = String(window.__reqs = null) && '';
  out.calls = 1;
  // 改过一次之后再改：交给模型的仍是原来那份
  work.update(w.id, { charAs: { name: made.name, persona: made.persona } });
  await novel.identity(w, { who: 'char' });
  // 二
  const cp = work.addChapter(w.id, { title: '重逢' });
  const list = scene.beatsOf(cp.id);
  const withCarry = engine.buildWorkSystem(work.get(w.id), work.getChapter(cp.id), c, list).system;
  out.carryIdent = /这部作品里的身份/.test(withCarry) && /书肆掌柜/.test(withCarry) && /original world/.test(withCarry);
  work.update(w.id, { carry: false });
  const noCarry = engine.buildWorkSystem(work.get(w.id), work.getChapter(cp.id), c, list).system;
  out.noCarryIdent = /这部作品里的身份/.test(noCarry) && !/original world/.test(noCarry) && !/程序员/.test(noCarry);
  // 三
  const sc = scene.create({ chatId: chat.id, title: '书肆', castIds: [c.id], opening: 'me' });
  const before = engine.buildSceneSystem(scene.get(sc.id), chat, c, []).system;
  out.sceneBefore = /程序员/.test(before) && !/这部作品里的身份/.test(before);
  scene.update(sc.id, { charAs: { name: '沈砚', persona: '大周的书肆掌柜。' }, meAs: { name: '林一', persona: '' } });
  const after = engine.buildSceneSystem(scene.get(sc.id), chat, c, []).system;
  out.sceneAfter = /书肆掌柜/.test(after) && !/程序员/.test(after) && /You are 沈砚/.test(after) && /这部作品里的身份/.test(after);
  const b = scene.addBeat({ sceneId: sc.id, role: 'char', authorId: c.id, text: '他抬起头。' });
  out.sign = scene.signOf(b, scene.get(sc.id)).name;
  const n = await import('/src/system/nav.js'); n.unlock(); n.goHome(); n.openApp('us', `/work/${w.id}/edit`);
  return { ...out, w: w.id, sc: sc.id, chat: chat.id };
});
ok('一、改写回来了名字与人设', r.made.name === '沈砚' && /书肆/.test(r.made.persona), JSON.stringify(r.made));
const sys1 = reqs[0]?.messages?.[0]?.content || '';
ok('一、交给模型的有角色卡原文、简介、世界书、对方的名字', /程序员/.test(sys1) && /书肆重逢/.test(sys1) && /驿站/.test(sys1) && /林一/.test(sys1), sys1.slice(0, 200));
const sys2 = reqs[1]?.messages?.[0]?.content || '';
ok('一、改过一次再改：交的仍是角色卡原文', /程序员/.test(sys2) && !/书肆掌柜/.test(sys2));
ok('二、带着记忆那一档：身份进了提示词，并写明记忆记的是原来那个世界的事', r.carryIdent);
ok('二、不带记忆那一档：身份进了，没有那句，原人设不在', r.noCarryIdent);
ok('三、线下：没填身份时是角色卡原文', r.sceneBefore);
ok('三、线下：填了身份之后是新人设，角色卡原文不在，开场按新名字', r.sceneAfter);
ok('三、线下：署名按新名字', r.sign === '沈砚', r.sign);

// 四
await page.waitForTimeout(800);
const btn = page.locator('button', { hasText: '按这里的世界改写' });
ok('四、作品设定页有两个改写按钮（角色与我）', await btn.count() === 2, await btn.count());
await btn.first().click();
await page.waitForTimeout(900);
ok('四、改写结果先显示出来', await page.locator('.fullsheet', { hasText: '角色在这里的身份' }).count() === 1);
await page.locator('.fullsheet button', { hasText: '存入' }).click();
await page.waitForTimeout(400);
ok('四、存入后落在作品上', await ev(async id => (await import('/src/system/work.js')).get(id).charAs?.persona?.includes('书肆'), r.w));
await ev(async () => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('us', '/new'); });
await page.waitForTimeout(800);
ok('四、新建向导里也有', await page.locator('button', { hasText: '按这里的世界改写' }).count() === 2);
await ev(async id => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('chat', `/scene/${id}/edit`); }, r.sc);
await page.waitForTimeout(800);
ok('四、这一场的设定页也有', await page.locator('button', { hasText: '按这里的世界改写' }).count() === 2);

console.log(`\n${R.filter(x => x.pass).length}/${R.length} 通过`);
if (errs.length) console.log(errs.join('\n'));
await browser.close();
process.exit(R.every(x => x.pass) && !errs.length ? 0 : 1);
