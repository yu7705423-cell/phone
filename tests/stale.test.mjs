// 代码版本对不上时的自愈：最多试两次，还不行要明说，不许安静地混着开
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// version.js 永远回一个对不上的构建号，模拟「js 是旧的、HTML 是新的」
async function run(label) {
  const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});
  const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
  const loads=[]; const warns=[];
  page.on('framenavigated', f => { if (f === page.mainFrame()) loads.push(f.url()); });
  page.on('console', m => { if (m.type()!=='log') warns.push(m.text()); });
  await page.route('**/src/version.js', r =>
    r.fulfill({status:200, contentType:'application/javascript',
      body:"export const BUILD = '0000-00-00.0';"}));
  await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
  // 两轮自愈各要一次导航，给足时间
  await page.waitForTimeout(6000);
  const out = await page.evaluate(() => ({
    bar: document.getElementById('stale')?.classList.contains('is-on') || false,
    barText: document.getElementById('stale')?.innerText || '',
    booted: !!document.querySelector('.home-grid, .lock, .app-layer, #app > *'),
    heal: (() => { try { return localStorage.getItem('build-heal'); } catch { return 'n/a'; } })(),
    url: location.href,
  }));
  const shot = `${OUT}/stale-${label}.png`;
  await page.screenshot({path:shot});
  await ctx.close();
  return { ...out, loads, warns };
}

const a = await run('a');
console.log('导航次数:', a.loads.length, a.loads.map(u=>u.replace(BASE,'')).join(' -> '));
ok('两次都没救回来时，顶上明说代码是旧的', a.bar, JSON.stringify({bar:a.bar, booted:a.booted}));
ok('那句话是书面语，且说清楚会怎样',
  /旧版本的代码/.test(a.barText) && /可能显示不正常/.test(a.barText), a.barText);
ok('挂着那一条，界面照常开起来（不是白屏）', a.booted, JSON.stringify(a));
ok('真的试满了两次才放弃', a.loads.length >= 3, a.loads.join(' | '));
ok('第二次换了带查询串的地址', a.loads.some(u => /\?v=/.test(u)), a.loads.join(' | '));
ok('记号记的是次数，不是一句「愈过了」',
  /"tries":2/.test(a.heal || ''), String(a.heal));
ok('自愈失败会在控制台留一句', a.warns.some(w => /仍然对不上/.test(w)),
  a.warns.slice(0,4).join(' | '));

// 版本对得上的那一路：不许挂那条，也不许多跳一次
const ctx2 = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});
const p2 = await ctx2.newPage();
const loads2=[]; p2.on('framenavigated', f => { if (f===p2.mainFrame()) loads2.push(f.url()); });
await p2.evaluateOnNewDocument?.(() => {});
await p2.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await p2.waitForTimeout(3000);
const good = await p2.evaluate(() => ({
  bar: document.getElementById('stale')?.classList.contains('is-on') || false,
  heal: (() => { try { return localStorage.getItem('build-heal'); } catch { return 'n/a'; } })(),
}));
ok('版本对得上时不挂那一条', !good.bar, JSON.stringify(good));
ok('版本对得上时不重载', loads2.length === 1, loads2.join(' | '));
ok('版本对得上时把记号清掉', !good.heal, String(good.heal));
await ctx2.close();

await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
