// 通话缩成悬浮球、桌面悬浮窗（ARCHITECTURE 4.223）。
//
//   通话中左上角可以缩成悬浮球：通话照常进行，秒表照走，底下的页面点得到
//   球可以拖，松手贴到近的那一边；点一下展开回全屏
//   响铃时不给缩：接不接要当场决定
//   挂断后球跟着消失
//   安卓外壳（EiraNative.setFloat）：没有「显示在其他应用上层」权限时点按钮是去要权限，不记为开；
//     有权限再点就开，按时把名字、时长交给外壳；挂断时撤掉
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];

async function open({ nativeShell = false, iosShell = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (iosShell) {
    await ctx.addInitScript(() => {
      window.__ios = { pip: false, sent: [] };
      window.phoneCallFloat = true;
      window.webkit = { messageHandlers: { callfloat: { postMessage: async m => {
        window.__ios.sent.push(m);
        if (m.action === 'toggle') { window.__ios.pip = !window.__ios.pip; return { pip: window.__ios.pip }; }
        if (m.action === 'set' && m.on === false) window.__ios.pip = false;
        return { pip: window.__ios.pip };
      } } } };
    });
  }
  if (nativeShell) {
    await ctx.addInitScript(() => {
      window.__float = { allowed: false, asked: 0, sent: [] };
      window.EiraNative = {
        version: () => 'test',
        floatAllowed: () => window.__float.allowed,
        askFloat: () => { window.__float.asked += 1; },
        setFloat: json => { window.__float.sent.push(JSON.parse(json)); },
      };
    });
  }
  await ctx.route('**/*', async route => {
    const u = route.request().url();
    if (u.startsWith(BASE)) return route.continue();
    if (/v1\/messages/.test(u)) {
      const post = route.request().postDataJSON?.() || {};
      if (!post.stream) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: '在的。' }] }) });
      const ev = (t, d) => `event: ${t}\ndata: ${JSON.stringify(d)}\n\n`;
      return route.fulfill({ status: 200, contentType: 'text/event-stream',
        body: ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '喂，我在。' } })
          + ev('message_stop', { type: 'message_stop' }) });
    }
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const ids = await page.evaluate(async () => {
    const db = await import('/src/system/db/index.js');
    const acc = await import('/src/system/accounts.js');
    const svc = await import('/src/system/ai/services.js');
    const nav = await import('/src/system/nav.js');
    nav.unlock();
    svc.newChatPreset({ name: 'T', provider: 'anthropic', apiKey: 'k', model: 'm' });
    db.settings.set({ streamMode: 'once', callSpeak: false, callMic: false, callSummary: false });
    const me = acc.roots()[0] || acc.createRoot({ name: '我' });
    const c = db.characters.create({ name: '阿岚', callAnswer: 'always' });
    const chat = db.chats.create({ characterIds: [c.id], personaId: me.id });
    return { chat: chat.id, char: c.id };
  });
  return { ctx, page, ids };
}

const dialAndWait = async (page, chatId) => {
  await page.evaluate(async id => (await import('/src/system/call.js')).dial(id), chatId);
  for (let i = 0; i < 40; i++) {
    const ph = await page.evaluate(async () => (await import('/src/system/call.js')).call.get().phase);
    if (ph === 'active') return true;
    await page.waitForTimeout(250);
  }
  return false;
};
const state = page => page.evaluate(async () => {
  const s = (await import('/src/system/call.js')).call.get();
  const ball = document.querySelector('.call-ball');
  const layer = document.querySelector('.call-layer');
  const r = ball?.getBoundingClientRect();
  return { phase: s.phase, mini: s.mini, seconds: s.seconds,
    ball: !!ball && getComputedStyle(ball).visibility !== 'hidden', ballText: ball?.textContent || '',
    ballX: r ? Math.round(r.left) : -1, ballW: r ? Math.round(r.width) : 0,
    layerHidden: !!layer && getComputedStyle(layer).opacity === '0' && getComputedStyle(layer).pointerEvents === 'none',
    minBtn: !!document.querySelector('[aria-label="缩小为悬浮球"]') };
});

// ---- 浏览器里 ----
{
  const { ctx, page, ids } = await open();
  ok('接通了', await dialAndWait(page, ids.chat));
  let s = await state(page);
  ok('通话中左上角有「缩小为悬浮球」', s.minBtn && !s.ball, JSON.stringify(s));

  await page.locator('[aria-label="缩小为悬浮球"]').click();
  await page.waitForTimeout(500);
  s = await state(page);
  ok('点了之后：出现悬浮球，全屏那一层看不见也点不到，通话没断', s.mini && s.ball && s.layerHidden && s.phase === 'active', JSON.stringify(s));
  ok('悬浮球默认贴在右边，显示时长', s.ballX > 390 / 2 && /\d+:\d{2}/.test(s.ballText), JSON.stringify(s));

  const sec0 = s.seconds;
  await page.waitForTimeout(2200);
  s = await state(page);
  ok('缩起来之后秒表照走', s.seconds > sec0, `${sec0} -> ${s.seconds}`);

  // 底下的页面点得到
  const under = await page.evaluate(() => {
    const el = document.elementFromPoint(195, 600);
    return el ? (el.closest('.call-layer') ? 'call' : 'page') : 'none';
  });
  ok('底下的页面点得到（点到的不是通话层）', under === 'page', under);

  // 拖到左边：松手贴左边，不展开
  const box = await page.locator('.call-ball').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2 - i * 35, box.y + box.height / 2 + i * 10);
  await page.mouse.up();
  await page.waitForTimeout(500);
  s = await state(page);
  ok('拖到左半边松手：贴到左边，仍是悬浮球', s.mini && s.ball && s.ballX < 40, JSON.stringify(s));

  // 点一下展开
  await page.locator('.call-ball').click();
  await page.waitForTimeout(400);
  s = await state(page);
  ok('点一下悬浮球：展开回全屏', !s.mini && !s.ball && !s.layerHidden && s.phase === 'active', JSON.stringify(s));

  // 再缩，挂断，球消失
  await page.locator('[aria-label="缩小为悬浮球"]').click();
  await page.waitForTimeout(300);
  await page.evaluate(async () => (await import('/src/system/call.js')).hangUp());
  await page.waitForTimeout(400);
  s = await state(page);
  ok('缩着的时候挂断：球跟着消失', s.phase === 'idle' && !s.ball, JSON.stringify(s));

  // 响铃时不给缩
  const ring = await page.evaluate(async id => {
    const call = await import('/src/system/call.js');
    call.ring(id);
    await new Promise(r => setTimeout(r, 300));
    call.shrink();
    const out = { phase: call.call.get().phase, mini: call.call.get().mini, btn: !!document.querySelector('[aria-label="缩小为悬浮球"]') };
    call.decline();
    return out;
  }, ids.chat);
  ok('响铃时没有缩小按钮，也缩不起来', ring.phase === 'ringing' && !ring.mini && !ring.btn, JSON.stringify(ring));

  // 桌面悬浮窗的按钮：浏览器支持画中画才有
  const pipBtn = await (async () => {
    await dialAndWait(page, ids.chat);
    const r = await page.evaluate(async () => ({
      kind: (await import('/src/system/callfloat.js')).kind(),
      btn: !!document.querySelector('[aria-label="桌面悬浮窗"]'),
    }));
    await page.evaluate(async () => (await import('/src/system/call.js')).hangUp());
    return r;
  })();
  ok('桌面悬浮窗按钮只在支持的环境里出现', (pipBtn.kind !== '') === pipBtn.btn, JSON.stringify(pipBtn));

  // 画中画：点按钮弹出系统小窗，应用里缩起来（球让给系统小窗）；关掉小窗，球回来
  if (pipBtn.kind === 'pip') {
    await dialAndWait(page, ids.chat);
    await page.locator('[aria-label="桌面悬浮窗"]').click();
    await page.waitForTimeout(800);
    const inPip = await page.evaluate(async () => ({
      el: document.pictureInPictureElement?.className || '',
      mini: (await import('/src/system/call.js')).call.get().mini,
      ball: !!document.querySelector('.call-ball'),
    }));
    ok('画中画：点按钮弹出系统小窗，应用里缩起来，不再另画一个球', inPip.el === 'pip-source' && inPip.mini && !inPip.ball, JSON.stringify(inPip));
    await page.evaluate(() => document.exitPictureInPicture());
    await page.waitForTimeout(500);
    const back = await page.evaluate(async () => ({ pip: !!document.pictureInPictureElement, ball: !!document.querySelector('.call-ball') }));
    ok('关掉系统小窗：回到应用内的悬浮球', !back.pip && back.ball, JSON.stringify(back));
    await page.evaluate(async () => (await import('/src/system/call.js')).hangUp());
    await page.waitForTimeout(300);
    const gone = await page.evaluate(() => ({ src: !!document.querySelector('.pip-source') }));
    ok('挂断：画中画用的那段视频拆掉', !gone.src, JSON.stringify(gone));
  }
  await ctx.close();
}

// ---- 安卓外壳 ----
{
  const { ctx, page, ids } = await open({ nativeShell: true });
  ok('安卓外壳：接通了', await dialAndWait(page, ids.chat));
  const btn = page.locator('[aria-label="桌面悬浮窗"]');
  ok('安卓外壳：有桌面悬浮窗按钮', await btn.count() === 1);

  await btn.click();
  await page.waitForTimeout(300);
  let f = await page.evaluate(async () => ({ ...window.__float, desk: (await import('/src/system/db/index.js')).settings.get().callDesk }));
  ok('没有权限时点它：去要权限，不记为开', f.asked === 1 && f.desk !== true && !f.sent.some(x => x.on), JSON.stringify(f));

  await page.evaluate(() => { window.__float.allowed = true; });
  await btn.click();
  await page.waitForTimeout(1500);
  f = await page.evaluate(async () => ({ ...window.__float, desk: (await import('/src/system/db/index.js')).settings.get().callDesk }));
  const last = f.sent.filter(x => x.on).slice(-1)[0] || {};
  ok('有权限再点：开了，按时把名字与时长交给外壳', f.desk === true && last.title === '阿岚' && /\d+:\d{2}/.test(last.status || ''), JSON.stringify(last));
  ok('按钮亮着', await page.locator('[aria-label="关闭桌面悬浮窗"]').count() === 1);

  await page.evaluate(async () => (await import('/src/system/call.js')).hangUp());
  await page.waitForTimeout(400);
  f = await page.evaluate(() => window.__float);
  ok('挂断：外壳那边的小窗撤掉', f.sent.length && f.sent[f.sent.length - 1].on === false, JSON.stringify(f.sent.slice(-1)));
  await ctx.close();
}

// ---- iPhone 外壳：画中画由外壳画 ----
{
  const { ctx, page, ids } = await open({ iosShell: true });
  ok('iPhone 外壳：接通了', await dialAndWait(page, ids.chat));
  await page.waitForTimeout(1200);
  let f = await page.evaluate(() => window.__ios);
  const lastSet = f.sent.filter(m => m.action === 'set' && m.on).slice(-1)[0] || {};
  ok('iPhone 外壳：通话中就把名字与时长交给外壳（点按钮那一刻画面是现成的）', lastSet.title === '阿岚' && /\d+:\d{2}/.test(lastSet.status || ''), JSON.stringify(lastSet));
  await page.locator('[aria-label="桌面悬浮窗"]').click();
  await page.waitForTimeout(500);
  let st = await page.evaluate(async () => ({ toggled: window.__ios.sent.some(m => m.action === 'toggle'),
    mini: (await import('/src/system/call.js')).call.get().mini, ball: !!document.querySelector('.call-ball') }));
  ok('iPhone 外壳：点按钮弹出画中画，应用里缩起来，不另画球', st.toggled && st.mini && !st.ball, JSON.stringify(st));
  // 用户在小窗上点了关闭：下一次交状态时外壳回 pip:false，球回来
  await page.evaluate(() => { window.__ios.pip = false; });
  await page.waitForTimeout(1600);
  st = await page.evaluate(() => ({ ball: !!document.querySelector('.call-ball') }));
  ok('iPhone 外壳：小窗被关掉后回到应用内的悬浮球', st.ball, JSON.stringify(st));
  await page.evaluate(async () => (await import('/src/system/call.js')).hangUp());
  await page.waitForTimeout(400);
  f = await page.evaluate(() => window.__ios);
  const end = f.sent[f.sent.length - 1] || {};
  ok('iPhone 外壳：挂断时让外壳收掉', end.action === 'set' && end.on === false, JSON.stringify(end));
  await ctx.close();
}

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
