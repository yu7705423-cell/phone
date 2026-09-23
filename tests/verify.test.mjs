import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const fail = [], ok = [];
const check = (c, m) => (c ? ok : fail).push(m);

async function fresh(extra = {}, fb = false) {
  const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
  page.on('pageerror', e => fail.push('PAGEERROR ' + e.message));
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const ids = await page.evaluate(async ([extra, fb]) => {
    const db = await import('/src/system/db/index.js');
    const acc = await import('/src/system/accounts.js');
    const me = acc.roots()[0] || acc.createRoot({ name: '我' });
    const a = db.characters.create({ name: '甲', persona: '一个人' });
    const chat = db.chats.create({ characterIds: [a.id], personaId: me.id, lastMessageAt: Date.now() });
    for (let i = 0; i < 6; i++) db.messages.create({ chatId: chat.id,
      role: i % 2 ? 'char' : 'user', authorId: i % 2 ? a.id : 'me',
      kind: 'text', content: '下雨天', status: 'done' });
    db.settings.set({ ...extra, services: { ...db.settings.get().services,
      chat: { presets: [{ id: 'p1', name: '主用', provider: 'openai', baseUrl: 'https://fake.invalid/v1', apiKey: 'k', model: 'm' },
        ...(fb ? [{ id: 'p2', name: '副用', provider: 'openai', baseUrl: 'https://fake.invalid/v2', apiKey: 'k', model: 'm2' }] : [])],
        activeId: 'p1', fallbackId: fb ? 'p2' : null } } });
    return { chat: chat.id };
  }, [extra, fb]);
  return { page, ids };
}

// ---- 1. 总结记忆：慢接口时那一行要转起来，菜单不能先关 ----
{
  const { page, ids } = await fresh();
  await page.evaluate(() => {
    const real = window.fetch;
    window.fetch = (i, init) => {
      const url = typeof i === 'string' ? i : i.url;
      if (!/fake\.invalid/.test(url)) return real(i, init);
      // 慢接口：三秒才回
      return new Promise(res => setTimeout(() => res(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ memories: [
          { content: '喜欢下雨天', category: 'fact', rank: 'B', keywords: ['雨'] }] }) } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })), 3000));
    };
  });
  await page.evaluate(([r]) => import('/src/system/nav.js').then(n => n.openApp('chat', r)), [`/chat/${ids.chat}`]);
  await page.waitForTimeout(700);
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find(b => b.getAttribute('aria-label') === '更多')?.click());
  await page.waitForTimeout(400);
  await page.evaluate(() => [...document.querySelectorAll('.fullsheet .list-item')]
    .find(e => e.innerText.startsWith('立即总结记忆'))?.click());
  await page.waitForTimeout(800);
  const mid = await page.evaluate(() => ({
    sheet: !!document.querySelector('.fullsheet'),
    row: [...document.querySelectorAll('.fullsheet .list-item')]
      .map(e => e.innerText.split('\n')[0]).find(t => /总结记忆/.test(t)) || '(没有)',
    spinner: !!document.querySelector('.fullsheet .spinner, .fullsheet svg.spin, .fullsheet [class*=spin]'),
  }));
  check(mid.sheet, '跑着的时候菜单还开着（不再是点完就跳回聊天页）');
  check(mid.row === '正在总结记忆', `那一行写着「正在总结记忆」（实际「${mid.row}」）`);
  await page.waitForTimeout(4000);
  const done = await page.evaluate(async () => {
    const db = await import('/src/system/db/index.js');
    return { sheet: !!document.querySelector('.fullsheet'), mems: db.memories.count(),
      toast: [...document.querySelectorAll('.toast')].map(e => e.innerText).join('|') };
  });
  check(!done.sheet, '完成之后菜单自己收起来');
  check(done.mems === 1, `记忆真的写进去了（${done.mems} 条）`);
  check(/新增 1 条/.test(done.toast), `给了结果提示：${done.toast}`);
  await page.close();
}

// ---- 2. 总结失败：菜单留在原地，把原因说出来 ----
{
  const { page, ids } = await fresh();
  await page.evaluate(() => {
    const real = window.fetch;
    window.fetch = (i, init) => {
      const url = typeof i === 'string' ? i : i.url;
      if (!/fake\.invalid/.test(url)) return real(i, init);
      return Promise.resolve(new Response('{"error":"boom"}', { status: 500 }));
    };
  });
  await page.evaluate(([r]) => import('/src/system/nav.js').then(n => n.openApp('chat', r)), [`/chat/${ids.chat}`]);
  await page.waitForTimeout(700);
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find(b => b.getAttribute('aria-label') === '更多')?.click());
  await page.waitForTimeout(400);
  await page.evaluate(() => [...document.querySelectorAll('.fullsheet .list-item')]
    .find(e => e.innerText.startsWith('立即总结记忆'))?.click());
  await page.waitForTimeout(3000);
  const st = await page.evaluate(() => ({
    sheet: !!document.querySelector('.fullsheet'),
    row: [...document.querySelectorAll('.fullsheet .list-item')]
      .map(e => e.innerText.split('\n')[0]).find(t => /总结记忆/.test(t)) || '(没有)',
    toast: [...document.querySelectorAll('.toast')].map(e => e.innerText).join('|') || '(没有)',
  }));
  check(st.sheet, '失败时菜单留在原地');
  check(st.row === '立即总结记忆', '那一行转完了恢复原状，可以再点');
  check(st.toast !== '(没有)', `失败原因说出来了：${st.toast}`);
  await page.close();
}

// ---- 3. 次数：界面报的数要和真打出去的一致 ----
for (const [label, extra, fb, want] of [
  ['默认', {}, false, 1],
  ['只开自动重试 3', { retryMax: 3 }, false, 2],
  ['只开换用副用', { chatFallback: true }, true, 2],
  ['两个都开', { retryMax: 3, chatFallback: true }, true, 4],
]) {
  const { page, ids } = await fresh(extra, fb);
  const said = await page.evaluate(async ([c]) => {
    const cost = await import('/src/system/ai/cost.js');
    return { per: cost.perTurn(c), worst: cost.worstPerTurn(c), attempts: cost.attemptsPerCall() };
  }, [ids.chat]);
  await page.evaluate(() => {
    window.__n = 0;
    const real = window.fetch;
    window.fetch = (i, init) => {
      const url = typeof i === 'string' ? i : i.url;
      if (!/fake\.invalid/.test(url)) return real(i, init);
      window.__n += 1;
      return Promise.resolve(new Response('{"error":"boom"}', { status: 500 }));
    };
  });
  await page.evaluate(([r]) => import('/src/system/nav.js').then(n => n.openApp('chat', r)), [`/chat/${ids.chat}`]);
  await page.waitForTimeout(700);
  await page.fill('.composer-input', '你好');
  await page.waitForTimeout(200);
  await page.click('.send-btn:not(.is-ghost):not(.is-stop)');
  await page.waitForTimeout(500);
  await page.click('.send-btn.is-ghost', { timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(40000);
  const real = await page.evaluate(() => window.__n);
  check(real === want && said.worst === want,
    `${label}：真打了 ${real} 次，界面说最多 ${said.worst} 次（期望 ${want}）`);
  await page.close();
}

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
await browser.close();
process.exit(fail.length ? 1 : 0);
