// 使用须知与内测说明（system/terms.js、shell/TermsGate.js，ARCHITECTURE 4.246）
//
//   一、第一次打开：挡在一切之上；先是使用须知全文，再是内测说明一条一页（第 k / 6 条），每步同意 / 不同意
//   二、全部同意：放行，记下；重开不再弹（用户要求「弹一次就够了，不要更新一次看一次」）
//   三、换设备恢复备份（本机那份记号没了、设置里还在）：不再弹
//   四、使用须知处不同意：结束页，进不去；「重新阅读」回到开头
//   五、内测说明第 3 条不同意：结束页写明是内测说明
//   六、安卓安装包（有 exitApp）：不同意直接关掉应用
//   七、每页要读够时间才能同意：使用须知 5 秒，内测说明每条 3 秒，按钮上倒数；不同意随时能点
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
async function open(init) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/src/site.js*', async r => {
    const res = await r.fetch();
    r.fulfill({ response: res, body: (await res.text()).replace(/accounts:\s*'[^']*'/, "accounts: ''") });
  });
  await ctx.addInitScript(() => { try { localStorage.setItem('eira-terms-test', '1'); } catch { /* 无 */ } });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/index.html`);
  await page.waitForTimeout(2000);
  return { ctx, page };
}
const gate = page => page.locator('.terms-gate');
const text = page => gate(page).innerText().catch(() => '');
const agree = page => page.locator('.terms-acts button', { hasText: /^同意$/ }).click();
const nope = page => page.locator('.terms-acts button', { hasText: '不同意' }).click();

// ---- 一、二、三 ----
{
  const { ctx, page } = await open();
  const t0 = await text(page);
  ok('第一次打开：使用须知挡在最前面', /Eira 使用须知/.test(t0) && /1\. 使用资格/.test(t0) && /7\. 关于酒馆人设与世界书/.test(t0), t0.slice(0, 120));
  ok('使用须知里有「情感与现实边界」「费用」', /5\. 情感与现实边界/.test(t0) && /4\. 费用/.test(t0));
  const covered = await page.evaluate(() => {
    const r = document.querySelector('.terms-gate').getBoundingClientRect();
    const el = document.elementFromPoint(r.width / 2, r.height / 2);
    return !!el && !!el.closest('.terms-gate');
  });
  ok('挡住了下面的应用：点不到主界面', covered);
  // 七：倒计时（打开之后已经等了约 2 秒）
  const btn = () => page.locator('.terms-acts button').nth(1);
  const early = { dis: await btn().isDisabled(), txt: await btn().innerText() };
  ok('使用须知：读够 5 秒之前「同意」点不了，按钮上倒数', early.dis && /同意（\d）/.test(early.txt), JSON.stringify(early));
  ok('「不同意」随时能点', !(await page.locator('.terms-acts button').nth(0).isDisabled()));
  await page.waitForTimeout(3500);
  ok('读够 5 秒：可以同意', !(await btn().isDisabled()) && (await btn().innerText()) === '同意');
  await agree(page);
  await page.waitForTimeout(300);
  const e1 = { dis: await btn().isDisabled(), txt: await btn().innerText() };
  ok('内测说明每一条：重新计时，读够 3 秒之前点不了', e1.dis && /同意（[1-3]）/.test(e1.txt), JSON.stringify(e1));
  await page.waitForTimeout(1500);
  ok('不到 3 秒仍然点不了', await btn().isDisabled());
  await page.waitForTimeout(1500);
  ok('读够 3 秒：可以同意', !(await btn().isDisabled()));
  // 回到第一条那一页，接着走一遍（上面这一页不再点，由下面的循环从第 1 条开始）
  const steps = [];
  for (let i = 1; i <= 6; i++) {
    const t = await text(page);
    steps.push(new RegExp(`第 ${i} / 6 条`).test(t) && t.includes(`${i}. `));
    await agree(page);
    await page.waitForTimeout(200);
  }
  ok('内测说明一条一页，六页依次同意', steps.every(Boolean), JSON.stringify(steps));
  ok('全部同意：放行', await gate(page).count() === 0);
  const saved = await page.evaluate(async () => ({
    local: localStorage.getItem('eira-terms'),
    set: (await import('/src/system/db/index.js')).settings.get().termsAccepted,
  }));
  ok('记下了（本机与设置各一份）', saved.local === '1' && saved.set === '1', JSON.stringify(saved));
  await page.waitForTimeout(800);
  await page.reload(); await page.waitForTimeout(2000);
  ok('重开：不再弹', await gate(page).count() === 0);
  // 换设备恢复备份：本机那份没了，设置里还在
  await page.evaluate(() => localStorage.removeItem('eira-terms'));
  await page.reload(); await page.waitForTimeout(2000);
  ok('本机记号没了、设置里还在（恢复备份）：不再弹', await gate(page).count() === 0);
  // 设置里可以重看
  await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('settings', '/'); n.push('/terms'); });
  await page.waitForTimeout(600);
  const again = await page.evaluate(() => document.querySelector('.app-layer')?.innerText || '');
  ok('「设置 - 使用须知与内测说明」可以重看全文', /情感与现实边界/.test(again) && /遇到问题请及时反馈/.test(again), again.slice(0, 120));
  await ctx.close();
}

// ---- 四、五 ----
{
  const { ctx, page } = await open();
  await nope(page);
  await page.waitForTimeout(300);
  const end = await text(page);
  ok('使用须知处不同意：结束页，进不去', /你未同意使用须知，无法使用 Eira/.test(end) && await page.locator('.terms-acts').count() === 0, end);
  await page.locator('.terms-end button', { hasText: '重新阅读' }).click();
  await page.waitForTimeout(300);
  ok('「重新阅读」回到使用须知开头', /Eira 使用须知/.test(await text(page)));
  await agree(page); await page.waitForTimeout(150);
  await agree(page); await page.waitForTimeout(150);
  await agree(page); await page.waitForTimeout(150);
  ok('走到内测说明第 3 条', /第 3 \/ 6 条/.test(await text(page)));
  await nope(page);
  await page.waitForTimeout(300);
  ok('内测说明不同意：结束页写明是内测说明', /你未同意内测说明，无法使用 Eira/.test(await text(page)));
  const notSaved = await page.evaluate(async () => (await import('/src/system/db/index.js')).settings.get().termsAccepted || '');
  ok('没同意完：不记', !notSaved, notSaved);
  await page.reload(); await page.waitForTimeout(2000);
  ok('重开：照样要从头确认', /Eira 使用须知/.test(await text(page)));
  await ctx.close();
}

// ---- 六、安卓安装包 ----
{
  const { ctx, page } = await open(() => { window.__exited = 0; window.EiraNative = { exitApp: () => { window.__exited += 1; } }; });
  await nope(page);
  await page.waitForTimeout(300);
  ok('安卓安装包里不同意：直接关掉应用', await page.evaluate(() => window.__exited) === 1);
  await ctx.close();
}

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
