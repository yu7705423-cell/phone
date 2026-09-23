// 拖滑杆时预览不许重建 DOM。重建就是一阵闪，而「闪」这件事测不了，
// 「那几个节点还是不是原来那几个」测得了
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1800);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const sid = await page.evaluate(async () => {
  const skin=await import('/src/system/skin.js');
  return skin.create({ name:'不闪' }).id;
});
await page.evaluate(async (id) => {
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('skin','/'); n.popToRoot(); n.push(`/gen/${id}`);
}, sid);
await page.waitForSelector('.gen-rail'); await page.waitForTimeout(1200);
await page.locator('.gen-rail-btn').filter({hasText:'气泡'}).first().click();
await page.waitForTimeout(800);

// 给预览里那几个节点做记号。重建过的话记号就没了
const mark = () => page.evaluate(() => {
  const root = document.querySelector('.gen-stage').shadowRoot;
  root.querySelectorAll('.ph-bubble').forEach((el, i) => { el.dataset.mark = 'm' + i; });
  const st = root.querySelector('style.skin-css');
  if (st) st.dataset.mark = 'style';
  return root.querySelectorAll('.ph-bubble').length;
});
const check = () => page.evaluate(() => {
  const root = document.querySelector('.gen-stage').shadowRoot;
  const bubbles = [...root.querySelectorAll('.ph-bubble')];
  const st = root.querySelector('style.skin-css');
  return {
    n: bubbles.length,
    kept: bubbles.filter(el => el.dataset.mark).length,
    styleKept: st?.dataset.mark === 'style',
    css: (st?.textContent || '').length,
    bg: getComputedStyle(root.querySelector('.ph-bubble-theirs')).backgroundColor,
    // 量算出来的圆角，不量 style 里那段文字 —— 文字截断与否跟「样式生效了没有」无关
    r: getComputedStyle(root.querySelector('.ph-bubble-theirs')).borderTopLeftRadius,
  };
});

const n0 = await mark();
ok('预览里有几个气泡', n0 >= 6, String(n0));

// 连改十次，模拟拖滑杆
for (let i = 0; i < 10; i++) {
  await page.evaluate(async ([id, r]) => {
    const skin=await import('/src/system/skin.js');
    skin.update(id, { gen: { bubble: { r, bg: '#ff0000' } } });
  }, [sid, 10 + i]);
  await page.waitForTimeout(90);
}
await page.waitForTimeout(600);
const after = await check();
ok('连改十次之后，气泡还是原来那几个节点（没重建）',
  after.kept === n0 && after.n === n0, JSON.stringify(after));
ok('那个 style 节点也还是原来那一个', after.styleKept, JSON.stringify(after));
ok('但样式确实跟着变了', after.bg === 'rgb(255, 0, 0)' && after.r === '19px',
  JSON.stringify(after).slice(0,240));

// 真的拖一次滑杆
await page.locator('.gen-rail-btn').filter({hasText:'气泡'}).first().click();
await page.waitForTimeout(400);
await page.locator('.gen-rail-btn').filter({hasText:'气泡'}).first().click();
await page.waitForTimeout(700);
await mark();
const box = await page.locator('.slider-row input[type=range]').first().boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 2; i <= 8; i++) {
    await page.mouse.move(box.x + box.width * (i / 10), box.y + box.height / 2);
    await page.waitForTimeout(60);
  }
  await page.mouse.up();
}
await page.waitForTimeout(700);
const dragged = await check();
ok('真的拖一遍滑杆，节点同样没被重建',
  dragged.kept === dragged.n && dragged.n === n0, JSON.stringify(dragged));

// 换一份美化时才该重建
const other = await page.evaluate(async () => {
  const skin=await import('/src/system/skin.js');
  return skin.create({ name:'另一份' }).id;
});
await page.evaluate(async (id) => {
  const n=await import('/src/system/nav.js'); n.replace(`/gen/${id}`);
}, other);
await page.waitForTimeout(1200);
const swapped = await check();
ok('换成另一份美化时，才重新搭一遍', swapped.kept === 0 && swapped.n === n0,
  JSON.stringify(swapped));

await page.screenshot({path:`${OUT}/noflicker.png`});
ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
