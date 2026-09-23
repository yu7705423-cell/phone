import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// --- 1. 版本对不上时自愈 ---
{
  const page = await browser.newPage({ viewport:{width:430,height:932} });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
  const warns=[]; page.on('console', m => { if (m.type()==='warning') warns.push(m.text()); });
  let reloads = 0;
  page.on('framenavigated', f => { if (f === page.mainFrame()) reloads++; });
  // 把 HTML 里的构建号改成一个更新的，模拟「HTML 是新的、js 是旧的」
  let served = 0;
  await page.route(`${BASE}/index.html`, async route => {
    const res = await route.fetch();
    let body = await res.text();
    if (served++ === 0) body = body.replace(/name="build" content="[^"]*"/, 'name="build" content="9999-99-99.99"');
    await route.fulfill({ status:200, contentType:'text/html; charset=utf-8', body });
  });
  await page.goto(`${BASE}/index.html`, { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(3000);
  ok('版本对不上时打出警告', warns.some(w => w.includes('代码版本对不上')), warns.join(' | '));
  ok('自愈之后重新载入了一次', reloads >= 2, reloads);
  ok('重开后正常进到界面', await page.locator('.root, .boot-error').count() > 0
    && await page.locator('.boot-error').count() === 0);
  await page.waitForTimeout(500);
  ok('不会反复重开', reloads <= 3, reloads);
  await page.close();
}

// --- 2. 版本一致时不动 ---
{
  const page = await browser.newPage({ viewport:{width:430,height:932} });
  let reloads = 0;
  page.on('framenavigated', f => { if (f === page.mainFrame()) reloads++; });
  await page.goto(`${BASE}/index.html`, { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(2500);
  ok('版本一致就不重开', reloads === 1, reloads);
  ok('正常进到界面', await page.locator('.root').count() === 1);
  await page.close();
}

// --- 3. 崩溃页上的「更新代码并重开」 ---
{
  const page = await browser.newPage({ viewport:{width:430,height:932}, deviceScaleFactor:2 });
  await page.goto(`${BASE}/index.html`, { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(1500);
  // 让 settings 的一个依赖报错，制造真实崩溃
  await page.evaluate(async () => {
    const svc = await import('/src/system/ai/services.js');
    const orig = svc.visionConfig;
    // 直接改模块导出不行，改成让它取到的 settings 报错
    const db = await import('/src/system/db/index.js');
    const real = db.settings.get;
    db.settings.get = () => { throw new Error('模拟：旧代码里没有这个函数'); };
    const nav = await import('/src/system/nav.js');
    nav.goHome(); nav.openApp('settings', '/');
    window.__restore = () => { db.settings.get = real; };
  });
  await page.waitForTimeout(800);
  ok('崩溃页出来了', await page.locator('.crash').count() === 1);
  const btns = await page.locator('.crash-actions button').allInnerTexts();
  ok('崩溃页有三个按钮', btns.length === 3, JSON.stringify(btns));
  ok('其中一个是「更新代码并重开」', btns.includes('更新代码并重开'), JSON.stringify(btns));
  await page.screenshot({ path: `${OUT}/c1-crash.png` });
  let reloaded = false;
  page.on('framenavigated', f => { if (f === page.mainFrame()) reloaded = true; });
  await page.evaluate(() => window.__restore && window.__restore());
  await page.getByText('更新代码并重开').click();
  await page.waitForTimeout(2500);
  ok('点了会重新载入', reloaded);
  await page.close();
}

await browser.close();
const bad = R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
