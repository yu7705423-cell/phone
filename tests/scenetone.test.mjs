// 线下：文风可以多选（ARCHITECTURE 4.267）、这一场自己增减世界书（4.268）
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
  const tone = await import('/src/system/tone.js');
  const scene = await import('/src/system/scene.js');
  const work = await import('/src/system/work.js');
  const lore = await import('/src/system/ai/context/lorebook.js');
  const e = await import('/src/system/ai/engine.js');
  const out = {};

  // 世界书：角色挂了 A，全局 G，库里另有 X（没挂）
  const mk = (name, global, tag) => db.lorebooks.create({ name, global, entries: [
    { id: `${tag}1`, comment: tag, content: `${tag}-CONST`, keys: [], constant: true, enabled: true, part: 'before', depth: 0 }] });
  const A = mk('挂在角色上的', false, 'AAA'), G = mk('全局的', true, 'GGG'), X = mk('没挂的', false, 'XXX');
  const c = db.characters.create({ name: '阿岚', lorebookIds: [A.id] });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });

  // 文风：选两份 + 自己写
  const sc = scene.create({ chatId: chat.id, title: '雨夜', tones: ['lean', 'second', 'custom'], toneText: 'Custom line here.',
    offBookIds: [A.id], bookIds: [X.id] });
  const row = scene.get(sc.id);
  out.tones = row.tones;
  out.text = tone.forScene(row);
  out.label = tone.labelOf(row);
  out.last = db.settings.get().sceneToneLast;
  out.lastOff = db.settings.get().sceneBooksOffLast;
  // 老数据：只有一个 tone 字符串
  out.oldIds = tone.idsOf({ tone: 'dense' });
  out.oldText = tone.forScene({ tone: 'dense' });
  out.oldWork = tone.forScene({ tone: 'custom', toneText: 'Old custom.' });
  // 作品也一样
  const w = work.create({ chatId: chat.id, kind: work.EXTRA, title: 't', tones: ['script', 'lean'] });
  out.workTones = w.tones;
  out.workText = tone.forScene(w);

  // 这一场的世界书：A 关掉、X 挂上、G 照旧
  const items = lore.activate(c, '', 100000, lore.sceneBooks(row)).items.map(x => x.content);
  out.items = items;
  // 没有这一场的清单时，照原样：A 和 G
  out.plain = lore.activate(c, '', 100000).items.map(x => x.content);
  // 整条链路：线下的提示词里有文风那三段、世界书按这一场的清单
  const sys = e.buildSceneSystem(row, chat, c, [], {
    lore: lore.activate(c, '', 100000, lore.sceneBooks(row)).items }).system;
  out.sys = sys;
  return { ...out, chat: chat.id, scene: sc.id };
});

ok('一场可以选多份文风', JSON.stringify(r.tones) === '["lean","second","custom"]', JSON.stringify(r.tones));
ok('几份按顺序各成一段，自己写的也在', /No metaphor/.test(r.text) && /second person/.test(r.text) && /Custom line here\./.test(r.text)
  && r.text.indexOf('No metaphor') < r.text.indexOf('second person') && r.text.indexOf('second person') < r.text.indexOf('Custom line'), r.text);
ok('列表上写的是几份的名字', r.label === '克制、第二人称、自己写', r.label);
ok('记住上一次选的几份', JSON.stringify(r.last) === '["lean","second","custom"]', JSON.stringify(r.last));
ok('老数据只有一个 tone 字符串：照读', JSON.stringify(r.oldIds) === '["dense"]' && /subordinate clauses/.test(r.oldText) && r.oldWork === 'Old custom.', JSON.stringify([r.oldIds, r.oldText, r.oldWork]));
ok('作品也可以多选', JSON.stringify(r.workTones) === '["script","lean"]' && /Present tense/.test(r.workText) && /No metaphor/.test(r.workText), JSON.stringify(r.workTones));
ok('这一场：关掉的不进，额外挂上的进，全局照旧', JSON.stringify([...r.items].sort()) === '["GGG-CONST","XXX-CONST"]', JSON.stringify(r.items));
ok('没有这一场的清单时照原样', JSON.stringify([...r.plain].sort()) === '["AAA-CONST","GGG-CONST"]', JSON.stringify(r.plain));
ok('线下提示词里有那几段文风', /No metaphor/.test(r.sys) && /Custom line here/.test(r.sys), r.sys.slice(-600));
ok('线下提示词里的世界书按这一场的清单', /XXX-CONST/.test(r.sys) && /GGG-CONST/.test(r.sys) && !/AAA-CONST/.test(r.sys), '');
ok('记住上一次关掉的书', Array.isArray(r.lastOff) && r.lastOff.length === 1, JSON.stringify(r.lastOff));

// 界面：这一场的设置页上，文风与世界书两行
await ev(async o => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/scene/${o.scene}/edit`); }, r);
await page.waitForTimeout(900);
const route = await ev(async () => (await import('/src/system/nav.js')).currentRoute());
const txt = await ev(() => document.body.innerText);
ok('这一场的设置页打开', /文风/.test(txt) && /世界书/.test(txt), route + ' ' + txt.slice(0, 200));
ok('文风那一行写着选中的几份', /克制、第二人称、自己写/.test(txt), '');
ok('世界书那一行写着几本生效、关掉几本', /2 本生效，关掉 1 本/.test(txt), (txt.match(/.{0,10}本生效.{0,10}/) || [''])[0]);
await page.getByText('2 本生效，关掉 1 本').first().click();
await page.waitForTimeout(500);
const sheet = await ev(() => [...document.querySelectorAll('.sheet')].map(x => x.innerText).join('\n'));
ok('单子里分两栏：角色已挂的与全局的、只在这一场挂上', /角色已挂的与全局的/.test(sheet) && /只在这一场挂上/.test(sheet) && /没挂的/.test(sheet), sheet.slice(0, 300));
// 把 A 打开回来
await page.locator('.sheet .list-item', { hasText: '挂在角色上的' }).locator('.switch').first().click();
await page.waitForTimeout(400);
const after = await ev(async o => (await import('/src/system/db/index.js')).db.scenes.get(o.scene).offBookIds, r);
ok('单子上拨开关写回这一场', Array.isArray(after) && after.length === 0, JSON.stringify(after));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
