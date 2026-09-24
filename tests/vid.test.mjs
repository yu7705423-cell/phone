import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const videoMod = await import('/src/system/video.js');
  db.settings.set({ services: { chat: { presets: [{ id: 'p1', name: '主用',
    provider: 'openai', kind: 'openai', baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' }],
    activeId: 'p1', fallbackId: 'p1' } }, crowdCount: 2 });
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const a = db.characters.create({ name: '甲', persona: '影迷' });
  const b = db.characters.create({ name: '乙', persona: '编剧' });
  const chat = db.chats.create({ characterIds: [a.id], personaId: me.id, lastMessageAt: Date.now() });
  const srt = ['1\n00:00:00,000 --> 00:00:06,000\n天还没亮。',
               '2\n00:00:06,000 --> 00:00:12,000\n车就停了。',
               '3\n00:00:12,000 --> 00:00:18,000\n老板娘说只剩一间。'].join('\n\n') + '\n';
  const v = videoMod.addVideo({ title: '雨城', url: 'https://example.com/a.mp4', subtitle: srt });
  return { video: v.id, chat: chat.id, a: a.id, b: b.id };
});

const fail = []; const ck = (n, c) => { if (!c) fail.push(n); };

const r = await page.evaluate(async i => {
  const para = await import('/src/system/paracomment.js');
  const task = await import('/src/system/ai/tasks/para-comment.js');
  const db = await import('/src/system/db/index.js');
  const out = {};
  const subj = para.subjectOf(para.VIDEO, i.video);
  out.subj = subj;

  let calls = 0, seen = '';
  window.fetch = async (u, init) => {
    calls += 1;
    const bd = JSON.parse(init.body);
    seen = bd.system || bd.messages?.find(m => m.role === 'system')?.content || '';
    return new Response(JSON.stringify({ choices: [{ message: { content:
      JSON.stringify({ comments: [
        { name: '甲', text: '这句停顿得好。' },
        { name: '乙', text: '这里应该留白。' }] }) } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } }); };

  // 名单存在片子上，不是书上
  para.setCrew(subj, [i.a, i.b]);
  out.crewOnVideo = (db.videos.get(i.video).crew || []).length;
  out.crewNames = para.crewOf(subj).map(c => c.name);

  // 按秒锚定：第 12 秒那一句
  const rows = await task.crew({ subject: subj, at: 12, charIds: [i.a, i.b] });
  out.calls = calls;
  out.got = rows.length;
  out.passageHasCue = /老板娘说只剩一间/.test(seen);
  out.passageHasLead = /车就停了/.test(seen);       // 前几句当上下文
  out.passageStopsAtNow = !/(^|\n).*第四句/.test(seen);
  task.keep(subj, 12, rows);

  out.at12 = para.listFor(subj, 12).length;
  out.at0 = para.listFor(subj, 0).length;
  out.counts = [...para.countsIn(subj, 0, 60).entries()];
  out.countFor = para.countFor(subj);

  // 书和影片互不串
  const bookSubj = para.subjectOf(para.BOOK, 'nope');
  out.bookIsolated = para.listFor(bookSubj, 12).length;

  // 删片子连带清评论
  const videoMod = await import('/src/system/video.js');
  videoMod.removeVideo(i.video);
  await new Promise(r => setTimeout(r, 80));
  out.afterDelete = para.countFor(subj);
  return out;
}, ids);

ck('名单存在片子上', r.crewOnVideo === 2 && JSON.stringify(r.crewNames) === '["甲","乙"]');
ck('合写一次调用', r.calls === 1 && r.got === 2);
ck('要评的那一句进了 prompt', r.passageHasCue);
ck('前面几句当上下文也进去了', r.passageHasLead);
ck('评论按秒锚定在第 12 秒', r.at12 === 2 && r.at0 === 0);
ck('区间统计对 ('+JSON.stringify(r.counts)+')', JSON.stringify(r.counts) === '[[12,2]]');
ck('书和影片互不串', r.bookIsolated === 0);
ck('删片子连带清掉评论', r.afterDelete === 0);

// 界面：全屏 + 点屏互动
await page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const videoMod = await import('/src/system/video.js');
  const watch = await import('/src/system/watch.js');
  const srt = '1\n00:00:00,000 --> 00:00:30,000\n天还没亮。\n';
  const v = videoMod.addVideo({ title: '雨城', url: 'https://example.com/a.mp4', subtitle: srt });
  watch.start({ chatId: i.chat, videoId: v.id });
  const nav = await import('/src/system/nav.js');
  nav.goHome(); nav.openApp('theater', `/watch/${i.chat}`);
}, ids);
await page.waitForTimeout(900);
ck('台词旁有段评气泡', await page.locator('.wt-cue .rd-dot').count() > 0);
ck('有全屏按钮', await page.locator('[aria-label="全屏"]').count() > 0);
await page.locator('[aria-label="全屏"]').click(); await page.waitForTimeout(400);
ck('全屏后顶栏收起', await page.locator('.navbar').count() === 0);
ck('全屏后播放条收起', !(await page.locator('.wt-bar').isVisible()));
ck('全屏后画面撑满', await page.locator('.wt-stage').evaluate(e => e.getBoundingClientRect().height) > 600);
await page.screenshot({ path: `${OUT}/vfull.png` });
await page.locator('.wt-video').click({ position: { x: 200, y: 100 } }); await page.waitForTimeout(400);
ck('点画面叫出互动层', await page.locator('.wt-panel').count() > 0);
ck('互动层里能说话', await page.locator('.wt-panel input').count() > 0);
await page.screenshot({ path: `${OUT}/vpanel.png` });
await page.locator('.wt-video').click({ position: { x: 200, y: 100 } }); await page.waitForTimeout(400);
ck('再点一下收回去', await page.locator('.wt-panel').count() === 0);
await page.locator('.navback').click(); await page.waitForTimeout(400);  // 返回键模式（默认）下由它退出全屏
ck('退出全屏顶栏回来', await page.locator('.navbar').count() > 0);

console.log(fail.length ? '失败：\n  ' + fail.join('\n  ') : '影片段评与全屏全部通过');
if (errs.length) console.log('PAGEERRORS', errs);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
