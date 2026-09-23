// 打给角色：默认总是接（从前被「主动发起对话」的免打扰时段偷偷管着，夜里几乎不接）；
// 角色卡上改成「按作息」才按时段掷骰子
import { BASE, OUT, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
await page.addInitScript(b => { window.BASE = b; }, BASE);
await page.route('**/relay.example.com/**', r => r.fulfill({ status: 200, contentType: 'text/event-stream',
  body: `data: ${JSON.stringify({ choices: [{ delta: { content: '喂？' } }] })}\n\ndata: [DONE]\n\n` }));
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newChatPreset({ name: '主用' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm', provider: 'openai' });
  svc.setActiveChat(p.id);
  db.settings.set({ callSpeak: false, callMic: false });
  // 免打扰时段正好罩住此刻 —— 从前这时候打过去 85% 不接
  const h = new Date().getHours();
  const c = db.characters.create({ name: '阿岚', persona: 'x',
    proactiveQuietFrom: h, proactiveQuietTo: (h + 2) % 24 });
  const chat = db.chats.create({ characterIds: [c.id], personaId: acc.current().id });
  return { char: c.id, chat: chat.id };
});

// 拨一通，等它有结果（接通，或者响完没人接）
const dial = () => page.evaluate(async o => {
  const call = await import('/src/system/call.js');
  const real = Math.random;
  Math.random = () => 0.99;            // 最坏的那一下：从前掷到这里一定不接
  call.dial(o.chat);
  const until = Date.now() + 12000;
  while (Date.now() < until && call.call.get().phase === 'dialing') await new Promise(r => setTimeout(r, 200));
  Math.random = real;
  const phase = call.call.get().phase;
  if (phase === 'active') call.hangUp();
  await new Promise(r => setTimeout(r, 300));
  return phase;
}, ids);

ok('默认：在免打扰时段里、随机掷到最坏，也接通', await dial() === 'active');

await page.evaluate(async o => (await import('/src/system/db/index.js')).characters.update(o.char, { callAnswer: 'schedule' }), ids);
const ph = await dial();
const missed = await page.evaluate(async o => (await import('/src/system/db/index.js')).messages.all()
  .some(m => m.chatId === o.chat && m.kind === 'call' && m.outcome === 'missed'), ids);
ok('改成「按作息」：时段里掷到不接就不接，记一条未接', ph === 'idle' && missed, `${ph} ${missed}`);

// ---- 界面：角色卡「通话」下面 ----
await page.evaluate(async o => {
  (await import('/src/system/db/index.js')).characters.update(o.char, { callAnswer: 'always' });
  const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/edit/${o.char}`);
}, ids);
await page.waitForTimeout(800);
let txt = await page.locator('.page').last().innerText();
ok('角色卡上有「接听你的来电」，默认总是接听', /接听你的来电/.test(txt) && /你打过去，角色总会接听/.test(txt), txt.slice(0, 200));
await page.locator('.seg-item', { hasText: '按作息' }).click();
await page.waitForTimeout(300);
txt = await page.locator('.page').last().innerText();
const saved = await page.evaluate(async o => (await import('/src/system/db/index.js')).characters.get(o.char).callAnswer, ids);
ok('点「按作息」：存上了，说明里写出免打扰时段', saved === 'schedule' && /时段内多半不接/.test(txt) && /\d+:00 到 \d+:00/.test(txt), saved);

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
