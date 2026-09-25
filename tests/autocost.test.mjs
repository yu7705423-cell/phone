// 自动调接口的地方，失败之后不许反复重试、不许一条消息扣几次费（ARCHITECTURE 4.240）
//
// 用户报过：「第一次失败之后一直重试反复扣费、每次消息扣多次费用」。这里让接口一律失败，数真正打出去几次：
//
//   一、一起看：角色开口失败后，页面每五秒问一次「该不该开口」—— 从前每五秒再调一次，现在要再等一个间隔
//   二、自动总结记忆（设了每次总结条数、又有积压）：失败后下一条消息不再试；成功后剩下的积压不在下一条就接着总结
//   三、线下压缩前情：失败后下一段不再压，要再多出一个窗口才重试
//   四、角色发图（锁脸、走参考图）：接口报 500 / 超时这类错时不再退回去另画一张；只有「不支持参考图」才退
//   五、读脸图写外貌：失败一次之后，下一张图不再读
//   六、同一个网址开两个页面：只有一个页面跑后台巡检
import { BASE, EXE, chromium } from './_env.mjs';

// 这份测试替哪几个自动任务作证（scripts/check-autocost.mjs 核对：自动任务都要有一项，断言名必须真的存在）
const COVERS = {
  'due:watch': '一起看：开口失败之后不再每五秒重试（17 秒内只打出去一次）',
  'memory.extract': '总结失败之后，下一轮不再试（从前这一批之后的积压全算没试过）',
  'scene.summary': '线下压缩失败之后，下一段不再压（从前每写一段先再压一次）',
  'chat.face-describe': '读脸图失败过一次：下一张图不再读（每张图各扣一次识图费）',
};
void COVERS;

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route('**/src/site.js*', async r => {
  const res = await r.fetch();
  r.fulfill({ response: res, body: (await res.text()).replace(/accounts:\s*'[^']*'/, "accounts: ''") });
});
// 视频放不出来也要让页面以为在放：停在第 200 秒、没暂停
await ctx.addInitScript(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', { get() { return false; }, configurable: true });
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { get() { return 200; }, set() {}, configurable: true });
  Object.defineProperty(HTMLMediaElement.prototype, 'duration', { get() { return 600; }, configurable: true });
  HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
});
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

// 模型接口：按 mode 回。chat 那一路一律数一下是哪一类请求
let mode = 'fail';
const chatHits = [];
await ctx.route('**/relay.example.com/**', async route => {
  const body = JSON.parse(route.request().postData() || '{}');
  const all = JSON.stringify(body);
  chatHits.push(/Describe this person/.test(all) ? 'face' : /memories/.test(all) ? 'memory' : 'other');
  if (mode === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"boom"}}' });
  return route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: mode === 'json' ? '{"memories":[]}' : '一段摘要。' } }] }) });
});
// 生图接口
let editStatus = 500;
const imgHits = [];
await ctx.route('**/img.example.com/**', async route => {
  const u = new URL(route.request().url());
  imgHits.push(u.pathname.endsWith('/edits') ? 'edits' : 'gen');
  if (u.pathname.endsWith('/edits')) return route.fulfill({ status: editStatus, contentType: 'application/json', body: '{"error":{"message":"upstream error"}}' });
  return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"also down"}}' });
});
await ctx.route('**/video.invalid/**', r => r.abort());

const page = await ctx.newPage();
page.on('pageerror', e => errs.push(e.message));
await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(2000);
const ev = (fn, a) => page.evaluate(fn, a);

const ids = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newChatPreset({ name: '主用' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm', provider: 'openai' });
  svc.setActiveChat(p.id);
  db.settings.set({ retryMax: 0, chatFallback: false });
  const c = db.characters.create({ name: '阿岚' });
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  return { char: c.id, chat: chat.id };
});

// ---- 一、一起看 ----
await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const video = await import('/src/system/video.js');
  const watch = await import('/src/system/watch.js');
  db.settings.set({ watchGap: 1 });
  const row = video.addVideo({ title: '样片', url: 'https://video.invalid/a.mp4' });
  watch.start({ chatId: o.chat, videoId: row.id });
  const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('theater', `/watch/${o.chat}`);
}, ids);
chatHits.length = 0;
await page.waitForTimeout(17000);
const watchCalls = chatHits.length;
ok('一起看：开口失败之后不再每五秒重试（17 秒内只打出去一次）', watchCalls === 1, `打出去 ${watchCalls} 次`);
await ev(async () => { (await import('/src/system/watch.js')).stop(); const n = await import('/src/system/nav.js'); n.goHome(); });
await page.waitForTimeout(500);

// ---- 二、自动总结记忆 ----
const mem = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const ex = await import('/src/system/ai/tasks/memory-extract.js');
  db.settings.set({ memoryEnabled: true, autoSummarizeInterval: 2, memoryBatch: 4 });
  const chat = db.chats.create({ characterIds: [o.char], lastMessageAt: Date.now() });
  let t = Date.now() - 100000;
  const say = role => db.messages.create({ chatId: chat.id, role, authorId: role === 'char' ? o.char : 'me', kind: 'text', content: `第 ${t} 句`, status: 'done', createdAt: t += 1000 });
  for (let i = 0; i < 20; i++) say(i % 2 ? 'char' : 'user');
  const out = { before: ex.shouldAutoExtract(chat.id, 2) };
  try { await ex.extract(chat.id); } catch { /* 预期失败 */ }
  say('user'); say('char');
  out.afterFail1 = ex.shouldAutoExtract(chat.id, 2);
  say('user'); say('char');
  out.afterFail2 = ex.shouldAutoExtract(chat.id, 2);
  return { ...out, chatId: chat.id };
}, ids);
ok('积压着的会话：够了间隔就总结', mem.before === true);
ok('总结失败之后，下一轮不再试（从前这一批之后的积压全算没试过）', mem.afterFail1 === false, JSON.stringify(mem));
ok('失败之后再攒够一个间隔才重试', mem.afterFail2 === true, JSON.stringify(mem));
mode = 'json';
const mem2 = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const ex = await import('/src/system/ai/tasks/memory-extract.js');
  let t = Date.now();
  const say = role => db.messages.create({ chatId: o.chatId, role, authorId: role === 'char' ? o.char : 'me', kind: 'text', content: `又一句 ${t}`, status: 'done', createdAt: t += 1000 });
  await ex.extract(o.chatId);
  const left = ex.pendingOf(o.chatId).length;
  say('user'); say('char');
  const next1 = ex.shouldAutoExtract(o.chatId, 2);
  say('user'); say('char');
  return { left, next1, next2: ex.shouldAutoExtract(o.chatId, 2) };
}, { ...mem, char: ids.char });
ok('总结成功、还剩积压：下一轮不接着总结（从前每条消息都多总结一次，直到追平）', mem2.left > 4 && mem2.next1 === false, JSON.stringify(mem2));
ok('再攒够一个间隔，照常总结下一批', mem2.next2 === true, JSON.stringify(mem2));
mode = 'fail';

// ---- 三、线下压缩前情 ----
chatHits.length = 0;
const sc = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const scene = await import('/src/system/scene.js');
  const task = await import('/src/system/ai/tasks/scene.js');
  db.settings.set({ sceneCompress: true, sceneWindow: 2 });
  const row = scene.create({ chatId: o.chat, title: '雨夜' });
  const beat = i => scene.addBeat({ sceneId: row.id, role: i % 2 ? scene.CHAR : scene.ME, authorId: i % 2 ? o.char : 'me', text: `第 ${i} 段` });
  for (let i = 0; i < 5; i++) beat(i);
  const tries = [];
  tries.push(await task.compressIfDue(row.id).then(() => 'ok', () => 'fail'));
  beat(5);
  tries.push(await task.compressIfDue(row.id).then(v => String(v), () => 'fail'));
  beat(6);
  tries.push(await task.compressIfDue(row.id).then(v => String(v), () => 'fail'));
  return tries;
}, ids);
ok('线下压缩失败之后，下一段不再压（从前每写一段先再压一次）', chatHits.length === 2 && sc[0] === 'fail' && sc[1] === 'false', `请求 ${chatHits.length} 次，${JSON.stringify(sc)}`);
ok('再多出一个窗口的段落才重试', sc[2] === 'fail', JSON.stringify(sc));

// ---- 四、角色发图，走参考图 ----
const img = async status => {
  editStatus = status;
  imgHits.length = 0; chatHits.length = 0;
  const r = await ev(async o => {
    const { db } = await import('/src/system/db/index.js');
    const svc = await import('/src/system/ai/services.js');
    const reply = await import('/src/system/ai/reply.js');
    if (!svc.imagePresets().length) {
      const p = svc.newImagePreset({ name: '生图' });
      svc.updateImagePreset(p.id, { baseUrl: 'https://img.example.com/v1', apiKey: 'k', model: 'img', ref: 'edits' });
      svc.setActiveImage(p.id);
      const c = document.createElement('canvas'); c.width = c.height = 8;
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const face = await db.images.put(new File([blob], 'f.png', { type: 'image/png' }));
      db.characters.update(o.char, { faceImage: face, faceLock: 'always' });
      // 读脸图交给聊天模型（会失败），第五段要数它读了几次
      svc.setVision({ mode: 'chat' });
    }
    const chat = db.chats.get(o.chat);
    const char = db.characters.get(o.char);
    const made = await reply.renderTurn({ chat, char, raw: '[图片：窗边的自拍]', turnId: 't' + Date.now(), instant: true });
    const id = made.find(m => m.kind === 'image')?.id;
    for (let i = 0; i < 40; i++) {
      const m = db.messages.get(id);
      if (m && m.media !== 'pending') return { media: m.media, err: m.mediaError };
      await new Promise(r => setTimeout(r, 150));
    }
    return { media: 'timeout' };
  }, ids);
  return { ...r, hits: imgHits.slice(), face: chatHits.filter(x => x === 'face').length };
};
const i500 = await img(500);
ok('参考图那条路报 500：不再退回去另画一张（只打出去一次）', JSON.stringify(i500.hits) === '["edits"]' && i500.media === 'error', JSON.stringify(i500));
const i404 = await img(404);
ok('接口不认参考图（404）：照旧退回纯文字那条路', JSON.stringify(i404.hits) === '["edits","gen"]', JSON.stringify(i404));

// ---- 五、读脸图写外貌 ----
// 上面 404 那次已经退回去读过一次脸（接口失败）。再发一张，不该再读
const i404b = await img(404);
ok('读脸图失败过一次：下一张图不再读（每张图各扣一次识图费）', i404.face === 1 && i404b.face === 0, `第一次读 ${i404.face} 次，第二次读 ${i404b.face} 次`);
const reset = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  return db.characters.get(o.char).faceDescFailed === db.characters.get(o.char).faceImage;
}, ids);
ok('失败记在这张脸图上（换图或「重新读取」即清掉）', reset);

// ---- 六、两个页面 ----
const page2 = await ctx.newPage();
page2.on('pageerror', e => errs.push(e.message));
await page2.goto(`${BASE}/index.html`);
await page2.waitForTimeout(2500);
const locks = await page2.evaluate(async () => {
  const q = await navigator.locks.query();
  return { held: q.held.filter(l => l.name === 'eira-sweep').length, pending: q.pending.filter(l => l.name === 'eira-sweep').length };
});
ok('同一个网址开两个页面：一个跑后台巡检，另一个等着', locks.held === 1 && locks.pending === 1, JSON.stringify(locks));
await page.close();
await page2.waitForTimeout(800);
const took = await page2.evaluate(async () => (await navigator.locks.query()).held.filter(l => l.name === 'eira-sweep').length);
ok('跑巡检的那个页面关掉：另一个接手', took === 1, String(took));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
