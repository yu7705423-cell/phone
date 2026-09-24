// 侧边栏：一下点到任何一组，旋钮那一栏要真的滚得动
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1800);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const sid = await page.evaluate(async () => {
  const skin=await import('/src/system/skin.js');
  return skin.create({ name:'侧栏' }).id;
});
await page.evaluate(async (id) => {
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('skin','/'); n.popToRoot(); n.push(`/gen/${id}`);
}, sid);
await page.waitForSelector('.gen-rail'); await page.waitForTimeout(1000);

// ---- 竖栏 ----
const rail = await page.evaluate(() => {
  const btns=[...document.querySelectorAll('.gen-rail-btn')];
  const el=document.querySelector('.gen-rail');
  return { n: btns.length, labels: btns.map(b=>b.innerText.trim()),
    w: Math.round(el.getBoundingClientRect().width),
    scrollable: el.scrollHeight > el.clientHeight + 1 ? 'yes' : 'no',
    fits: el.scrollHeight <= el.clientHeight + 1 };
});
// 七种卡片在竖栏上合成一格「卡片」，点进去再选；一种一格的话十九格，一屏装不下
ok('十一组、卡片、总样式，一共十三格', rail.n === 13, JSON.stringify(rail.labels));
ok('竖栏很窄，不抢地方', rail.w <= 70, String(rail.w));
ok('一屏装得下，不用滚就点得到每一组', rail.fits, `scrollHeight 超出：${rail.scrollable}`);

// ---- 收起时预览占满 ----
const closed = await page.evaluate(() => {
  const st=document.querySelector('.gen-stage');
  const main=document.querySelector('.gen-main');
  return { stage: Math.round(st.getBoundingClientRect().height),
    main: Math.round(main.getBoundingClientRect().height),
    panel: !!document.querySelector('.gen-panel') };
});
ok('一进来旋钮是收着的', !closed.panel, JSON.stringify(closed));
ok('收着时预览占满整块', Math.abs(closed.stage - closed.main) <= 2, JSON.stringify(closed));

// ---- 点一格就展开 ----
const hit = label => page.locator('.gen-rail-btn').filter({hasText:label}).first();
await hit('底栏').click();
await page.waitForTimeout(800);
const opened = await page.evaluate(() => {
  const p=document.querySelector('.gen-panel');
  const st=document.querySelector('.gen-stage');
  return { panel: !!p, title: document.querySelector('.gen-panel-title')?.innerText || '',
    stage: Math.round(st.getBoundingClientRect().height),
    panelH: p ? Math.round(p.getBoundingClientRect().height) : 0,
    on: document.querySelectorAll('.gen-rail-btn.is-on').length };
});
ok('点一格就展开那一组', opened.panel && opened.title === '底栏', JSON.stringify(opened));
ok('展开时预览让出一半左右', opened.stage < closed.stage && opened.stage > 150, JSON.stringify(opened));
ok('只有一格是选中态', opened.on === 1, String(opened.on));

// ---- 这一栏必须真的滚得动（从前就是这里坏的）----
const scrolls = await page.evaluate(async () => {
  const p = document.querySelector('.gen-panel');
  const before = p.scrollTop;
  p.scrollTop = 99999;
  await new Promise(r => requestAnimationFrame(r));
  return { can: p.scrollHeight > p.clientHeight + 1, before, after: p.scrollTop,
    h: Math.round(p.clientHeight), sh: Math.round(p.scrollHeight) };
});
ok('底栏那一组内容比一屏长', scrolls.can, JSON.stringify(scrolls));
ok('旋钮那一栏真的滚得动', scrolls.after > scrolls.before, JSON.stringify(scrolls));

// 滚下去之后，预览还在原处看得见
const stillThere = await page.evaluate(() => {
  const st=document.querySelector('.gen-stage').getBoundingClientRect();
  return st.top >= 0 && st.height > 100;
});
ok('滚动旋钮时预览不动，一直看得见', stillThere);

// ---- 切到另一组，预览跟着换焦点 ----
const tf = () => page.evaluate(() => {
  const sc=document.querySelector('.gen-stage')?.shadowRoot?.querySelector('.stage-scale');
  return sc?.style.transform || '';
});
const atComposer = await tf();
await hit('顶栏').first().click();
await page.waitForTimeout(800);
const atNav = await tf();
ok('换一组，预览跟着挪到那一块', atNav !== atComposer, `${atComposer} -> ${atNav}`);
ok('标题跟着换',
  (await page.locator('.gen-panel-title').innerText()) === '顶栏');

// ---- 再点同一格收起来 ----
await hit('顶栏').first().click();
await page.waitForTimeout(700);
ok('再点一下收起来', !(await page.evaluate(() => !!document.querySelector('.gen-panel'))));
const back = await page.evaluate(() => {
  const st=document.querySelector('.gen-stage');
  const main=document.querySelector('.gen-main');
  return Math.abs(st.getBoundingClientRect().height - main.getBoundingClientRect().height) <= 2;
});
ok('收起来之后预览又占满', back);

// ---- 改过的那几组要有标记 ----
await hit('气泡').click();
await page.waitForTimeout(600);
await page.evaluate(async (id) => {
  const skin=await import('/src/system/skin.js');
  skin.update(id, { gen: { bubble: { bg:'#123456' } } });
}, sid);
await page.waitForTimeout(700);
const dots = await page.evaluate(() => {
  const on=[...document.querySelectorAll('.gen-rail-btn')]
    .filter(b => b.querySelector('.gen-rail-dot')).map(b => b.innerText.trim());
  return on;
});
ok('改过的那一组在竖栏上有小点', dots.includes('气泡') && dots.length === 1, JSON.stringify(dots));

// ---- 总样式也在竖栏上 ----
await hit('总样式').click();
await page.waitForTimeout(700);
const cssPanel = await page.locator('.gen-panel').innerText();
ok('总样式点得到，并且列出行数', /共 \d+ 行/.test(cssPanel), cssPanel.slice(0,160));
ok('总样式里有复制', /复制这段 CSS/.test(cssPanel), cssPanel.slice(0,200));

await page.screenshot({path:`${OUT}/rail.png`});
ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
