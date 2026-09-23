import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// 放一个 Love 组件到第一页
await page.evaluate(async () => {
  const lay=await import('/src/system/db/index.js');
  const nav=await import('/src/system/nav.js');
  const L=lay.layout.get();
  L.pages[0].cells = [{ id:'love1', kind:'widget', ref:'love', x:0, y:0, w:4, h:4 }];
  lay.layout.set(L);
  nav.goHome();
});
await page.waitForTimeout(900);
ok('Love 组件渲染出来了', await page.locator('.wg-love').count() === 1);
ok("日历按当月实际行数铺（九月是 5 行）", await page.locator(".love-days > span").count() === 35,
  await page.locator('.love-days > span').count());
ok('今天被标成了音符', await page.locator('.love-day.is-today svg').count() === 1);
ok('均衡器有 26 根', await page.locator('.love-eq i').count() === 26);

// 最后一行不被切掉
const fit = await page.evaluate(() => {
  const days = document.querySelector('.love-days');
  const wg = document.querySelector('.wg-love');
  const cell = document.querySelector('.cell-widget');
  const last = days.lastElementChild.getBoundingClientRect();
  const box = cell.getBoundingClientRect();
  return { overflowY: days.scrollHeight - days.clientHeight,
    lastBottom: Math.round(last.bottom), cellBottom: Math.round(box.bottom),
    wgOver: wg.scrollHeight - wg.clientHeight };
});
ok('日历没有纵向溢出', fit.overflowY <= 1, JSON.stringify(fit));
ok('最后一行在卡片里面，没有被切', fit.lastBottom <= fit.cellBottom, JSON.stringify(fit));
ok('整个组件不溢出', fit.wgOver <= 1, JSON.stringify(fit));
await page.screenshot({path:`${OUT}/w1-love.png`});

// 默认黑白：颜色来自主题，不是写死的
const ink = await page.evaluate(() => {
  const el = document.querySelector('.wg-love');
  return { inline: el.getAttribute('style') || '', color: getComputedStyle(el).color };
});
ok('默认没有内联颜色', ink.inline === '', ink.inline);
ok('默认取主题前景色', /rgb\(1[0-9], 1[0-9], 1[0-9]\)|rgb\(0, 0, 0\)|rgb\(2[0-9]/.test(ink.color), ink.color);

// 指定颜色
await page.evaluate(async () => {
  const { setCellConfig } = await import('/src/screens/home/layout.js');
  setCellConfig('love1', { color: '#c2410c' });
});
await page.waitForTimeout(500);
const tinted = await page.evaluate(() => {
  const el = document.querySelector('.wg-love');
  const bar = document.querySelector('.love-eq i');
  const av = document.querySelector('.love-avatar');
  return { c: getComputedStyle(el).color, bar: getComputedStyle(bar).backgroundColor,
    border: getComputedStyle(av).borderTopColor };
});
ok('文字跟着换色', tinted.c === 'rgb(194, 65, 12)', tinted.c);
ok('均衡器跟着换色', tinted.bar === 'rgb(194, 65, 12)', tinted.bar);
ok('头像描边也跟着换', tinted.border === 'rgb(194, 65, 12)', tinted.border);
await page.screenshot({path:`${OUT}/w2-love-color.png`});

// 深色模式下默认色要翻过来
await page.evaluate(async () => {
  const { setCellConfig } = await import('/src/screens/home/layout.js');
  setCellConfig('love1', { color: '' });
  document.documentElement.setAttribute('data-theme','dark');
});
await page.waitForTimeout(500);
const dark = await page.evaluate(() => getComputedStyle(document.querySelector('.wg-love')).color);
ok('深色模式下默认变浅色', /rgb\(2[3-5][0-9]/.test(dark), dark);
await page.screenshot({path:`${OUT}/w3-love-dark.png`});
await page.evaluate(() => document.documentElement.setAttribute('data-theme','light'));

// 中文
await page.evaluate(async () => {
  const { setCellConfig } = await import('/src/screens/home/layout.js');
  setCellConfig('love1', { lang: 'zh' });
});
await page.waitForTimeout(500);
const week = await page.locator('.love-week').innerText();
ok('可以切成中文', week.replace(/\s/g,'') === '日一二三四五六', week);
await page.evaluate(async () => {
  const { setCellConfig } = await import('/src/screens/home/layout.js');
  setCellConfig('love1', { lang: 'en' });
});

// ---- 2x2 小号 ----
await page.evaluate(async () => {
  const lay=await import('/src/system/db/index.js');
  const L=lay.layout.get();
  L.pages[0].cells = [{ id:'lv2', kind:'widget', ref:'love', x:0, y:0, w:2, h:2 }];
  lay.layout.set(L);
});
await page.waitForTimeout(700);
ok('2x2 走紧凑版式', await page.locator('.wg-love.is-compact').count() === 1);
ok('紧凑版也有均衡器', await page.locator('.love-eq').count() === 1);
ok('紧凑版均衡器换成 14 根', await page.locator('.love-eq i').count() === 14,
  await page.locator('.love-eq i').count());
ok('紧凑版只铺两周', await page.locator('.love-days > span').count() === 14,
  await page.locator('.love-days > span').count());
ok('两周里今天在第一周', await page.evaluate(() => {
  const all = [...document.querySelectorAll('.love-days > span')];
  return all.findIndex(el => el.classList.contains('is-today')) < 7;
}));
ok('下个月的日子淡一档或者根本没有', await page.evaluate(() => {
  const out = [...document.querySelectorAll('.love-day.is-out')];
  return out.every(el => parseFloat(getComputedStyle(el).opacity) < .5);
}));
ok('星期只剩首字母', (await page.locator('.love-week').innerText()).replace(/\s+/g,' ') === 'S M T W T F S',
  await page.locator('.love-week').innerText());
const small = await page.evaluate(() => {
  const el = document.querySelector('.wg-love');
  const days = el.querySelector('.love-days');
  const wk = el.querySelector('.love-week');
  const cell = el.closest('.cell-widget').getBoundingClientRect();
  return { over: el.scrollHeight - el.clientHeight, daysOver: days.scrollHeight - days.clientHeight,
    weekOver: wk.scrollWidth - wk.clientWidth,
    lastIn: Math.round(days.lastElementChild.getBoundingClientRect().bottom) <= Math.round(cell.bottom) };
});
ok('小号纵向不溢出', small.over <= 1 && small.daysOver <= 1, JSON.stringify(small));
ok('小号星期行不横向溢出', small.weekOver <= 1, JSON.stringify(small));
ok('小号最后一行也在卡片里', small.lastIn, JSON.stringify(small));
ok('2x2 在可选尺寸里排第一', await page.evaluate(async () => {
  const { getWidget } = await import('/src/system/registry.js');
  const [first] = getWidget('love').sizes;
  return first[0] === 2 && first[1] === 2;
}));

// 回到大号继续后面的检查
await page.evaluate(async () => {
  const lay=await import('/src/system/db/index.js');
  const L=lay.layout.get();
  L.pages[0].cells = [{ id:'love1', kind:'widget', ref:'love', x:0, y:0, w:4, h:4 }];
  lay.layout.set(L);
});
await page.waitForTimeout(600);

// ---- 自定义组件 ----
await page.evaluate(async () => {
  const lay=await import('/src/system/db/index.js');
  const L=lay.layout.get();
  L.pages[0].cells.push({ id:'cus1', kind:'widget', ref:'custom', x:0, y:4, w:4, h:2 });
  lay.layout.set(L);
});
await page.waitForTimeout(700);
ok('没传文件时给出提示', (await page.locator('.wg-custom-empty').innerText()).includes('上传'),
  await page.locator('.wg-custom-empty').innerText());

const custom = `<!doctype html><meta charset="utf-8"><style>body{margin:0;font:14px sans-serif;display:grid;place-items:center;height:100vh}</style><div id="x">等待脚本</div><script>document.getElementById('x').textContent='脚本跑起来了';
try { window.localStorage.getItem('x'); document.title='CAN_READ'; } catch (e) { document.title='BLOCKED'; }
</script>`;
await page.evaluate(async src => {
  const { files } = await import('/src/system/db/files.js');
  const { setCellConfig } = await import('/src/screens/home/layout.js');
  const id = await files.put(new Blob([src], { type:'text/html' }), { name:'my.html', type:'text/html' });
  setCellConfig('cus1', { fileId: id, name: 'my.html' });
}, custom);
await page.waitForTimeout(1200);
ok('iframe 出现了', await page.locator('iframe.wg-custom').count() === 1);
const fr = page.frameLocator('iframe.wg-custom');
ok('自定义组件里的脚本跑起来了', (await fr.locator('#x').innerText()) === '脚本跑起来了',
  await fr.locator('#x').innerText().catch(()=>'(读不到)'));
const sandboxAttr = await page.locator('iframe.wg-custom').getAttribute('sandbox');
ok('sandbox 只给了 allow-scripts', sandboxAttr === 'allow-scripts', sandboxAttr);
const blocked = await page.evaluate(() => {
  const f = document.querySelector('iframe.wg-custom');
  try { return f.contentDocument ? 'SAME_ORIGIN' : 'OPAQUE'; } catch { return 'OPAQUE'; }
});
ok('宿主读不到 iframe 内部（说明是不透明源）', blocked === 'OPAQUE', blocked);
const title = await page.evaluate(async () => {
  const f = document.querySelector('iframe.wg-custom');
  try { return f.contentDocument?.title ?? 'OPAQUE'; } catch { return 'OPAQUE'; }
});
ok('storage 对它是禁止的', title === 'OPAQUE' || title === 'BLOCKED', title);
await page.screenshot({path:`${OUT}/w4-custom.png`});

// 组件列表里能挑到这两个
const inList = await page.evaluate(async () => {
  const { listWidgets } = await import('/src/system/registry.js');
  const all = listWidgets();
  return { love: !!all.find(w=>w.id==='love'), custom: !!all.find(w=>w.id==='custom'),
    loveSizes: all.find(w=>w.id==='love')?.sizes };
});
ok('两个组件都注册了', inList.love && inList.custom, JSON.stringify(inList));

await browser.close();
const bad = R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
