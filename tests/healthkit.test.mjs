// @serial  有时间上的断言，和别的测试抢 CPU 时会误报
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const fail = [], ok = [];
const check = (c, m) => { (c ? ok : fail).push(m); console.log((c ? '  ok   ' : '  FAIL ') + m); };

async function boot(bridge) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
  if (bridge) await ctx.addInitScript(bridge);
  const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
  page.on('pageerror', e => check(false, 'PAGEERROR ' + e.message));
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  // 先手记一天，看同步会不会把手写的东西冲掉
  await page.evaluate(async () => {
    const h = await import('/src/system/health.js');
    const d = new Date(); d.setDate(d.getDate() - 1);
    const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    h.set('me', k, { mood: '愉悦', note: '手写的备注', steps: 111, source: 'manual' });
    window.__k = k;
  });
  await page.evaluate(() => import('/src/system/nav.js').then(n => n.openApp('health', '/settings')));
  await page.waitForTimeout(800);
  return { ctx, page };
}

// ---- 1. 没有外壳：整段不出现 ----
{
  const { ctx, page } = await boot(null);
  const t = await page.evaluate(() => document.body.innerText);
  check(!t.includes('从「健康」app 同步'), '浏览器里不出现同步那一段');
  check(await page.evaluate(async () =>
    !(await import('/src/system/healthkit.js')).available()), 'available() 是 false');
  await ctx.close();
}

// ---- 2. 有外壳、能授权：写进去，手记的不动 ----
{
  const { ctx, page } = await boot(() => {
    window.phoneHealth = true;
    const d = new Date(); d.setDate(d.getDate() - 1);
    const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    window.webkit = { messageHandlers: { health: { postMessage: async m => {
      if (m.action === 'request') return { granted: true };
      if (m.action === 'status') return { available: true };
      return { days: [
        { date: k, steps: 8421, sleepMin: 431, weightKg: 58.4, water: 6 },
        { date: '2026-09-10', steps: 3010 },
        { date: '坏日期', steps: 999 },
        { date: '2026-09-09' },
      ] };
    } } } };
  });
  const t = await page.evaluate(() => document.body.innerText);
  check(t.includes('从「健康」app 同步'), '装成应用时出现同步那一段');
  await page.click('text=从「健康」app 同步');
  await page.waitForTimeout(1200);
  const got = await page.evaluate(async () => {
    const h = await import('/src/system/health.js');
    const row = h.dayOf('me', window.__k);
    return { row, all: h.recent('me', 10).map(r => r.date),
      toast: [...document.querySelectorAll('.toast')].map(e => e.innerText).join('|') };
  });
  check(got.row.steps === 8421 && got.row.sleepMin === 431 && got.row.weight === 58.4 && got.row.water === 6,
    `系统那几项写进去了：${got.row.steps} 步 / ${got.row.sleepMin} 分 / ${got.row.weight} kg / ${got.row.water} 杯`);
  check(got.row.mood === '愉悦' && got.row.note === '手写的备注',
    `手记的心情与备注没被冲掉：「${got.row.mood}」「${got.row.note}」`);
  check(got.row.source === 'healthkit', `这一行标成了 ${got.row.source}`);
  check(got.all.includes('2026-09-10') && !got.all.includes('坏日期'),
    `坏日期被挡掉了，有数据的那天写进来了：${JSON.stringify(got.all)}`);
  check(!got.all.includes('2026-09-09'), '一项数据都没有的那天不建空行');
  check(/已同步 2 天/.test(got.toast), `提示写的是实际写入的天数：${got.toast}`);
  await ctx.close();
}

// ---- 3. 有外壳但签名没带权限：把原话显示出来 ----
{
  const { ctx, page } = await boot(() => {
    window.phoneHealth = true;
    window.webkit = { messageHandlers: { health: { postMessage: async m => {
      if (m.action === 'request') {
        return { error: '系统没有授权：Missing com.apple.developer.healthkit entitlement' };
      }
      return {};
    } } } };
  });
  await page.click('text=从「健康」app 同步');
  await page.waitForTimeout(1000);
  const t = await page.evaluate(() => document.body.innerText);
  check(/entitlement/.test(t), '拒绝的原话显示在那一行上，不是一句「失败」');
  check(await page.evaluate(async () => {
    const h = await import('/src/system/health.js');
    return h.dayOf('me', window.__k).steps === 111;
  }), '失败时一个字都没改');
  await ctx.close();
}

console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length ? 1 : 0);
