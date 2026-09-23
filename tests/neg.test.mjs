// @serial  有时间上的断言，和别的测试抢 CPU 时会误报
// 0 和负数都要能设。从前拿 0 当「不改」，于是圆角调不成方的、间距调不到 0，
// 负数一律被挡在外面 —— 而「两条消息叠起来」正需要它。
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1800);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const lg = await page.evaluate(async () => {
  const g = await import('/src/system/skin-gen.js');
  const o = {};
  o.zeroR = g.emit({ bubble: { r: 0 } });
  o.zeroPad = g.emit({ bubble: { px: 0, py: 0 } });
  o.zeroGap = g.emit({ msg: { gap: 0 } });
  o.negGap = g.emit({ msg: { gap: -14 } });
  o.negTop = g.emit({ msg: { top: -30 } });
  o.posTop = g.emit({ msg: { top: 60 } });
  o.negSide = g.emit({ msg: { sideP: -12 } });
  o.negAvGap = g.emit({ avatar: { gap: -8 } });
  o.zeroAvGap = g.emit({ avatar: { gap: 0 } });
  o.negIcon = g.emit({ composer: { plusX: -16, plusY: -4 } });
  // 底栏那一块：默认是「内边距 + 安全区」，所以写了就要整条盖掉
  o.padZero = g.emit({ composer: { padBottom: 0 } });
  o.padNeg = g.emit({ composer: { padBottom: -24 } });
  o.padTop = g.emit({ composer: { padTop: 6 } });
  o.zeroBorder = g.emit({ border: { w: 0 } });
  o.zeroShadow = g.emit({ border: { shadow: 0 } });
  o.negTailY = g.emit({ tail: { on:true, y:-12 } });
  o.zeroInR = g.emit({ composer: { inR: 0 } });
  o.zeroMetaless = g.emit({ meta: { x: 0, y: 0 } });
  // 一项都没设时仍然什么都不发
  o.blank = g.emit({});
  o.blankExplicit = g.emit({ bubble: { r: '' }, msg: { gap: '' } });
  // 「改过几项」要把 0 算成改过
  o.changedZero = g.changedIn({ bubble: { r: 0 } }, 'bubble');
  o.changedUnset = g.changedIn({ bubble: { r: '' } }, 'bubble');
  // 每一项数值旋钮的默认值，以及能不能填到负
  o.nums = [];
  g.GROUPS.forEach(grp => grp.items.forEach(it => {
    if (it.type !== 'num') return;
    o.nums.push({ g: grp.id, id: it.id, def: it.def, min: it.min, max: it.max });
  }));
  return o;
});

ok('圆角能调成 0（方气泡）', /border-radius: 0px/.test(lg.zeroR), lg.zeroR);
ok('内距能调成 0',
  /padding-left: 0px/.test(lg.zeroPad) && /padding-top: 0px/.test(lg.zeroPad), lg.zeroPad);
ok('消息间距能调成 0', /margin-bottom: 0px/.test(lg.zeroGap), lg.zeroGap);
ok('消息间距能填负数，两条叠起来',
  /margin-bottom: -14px/.test(lg.negGap) && /gap: 0/.test(lg.negGap), lg.negGap);
ok('正的顶部距离走内距', /padding-top: 60px/.test(lg.posTop), lg.posTop);
ok('负的顶部距离走外边距（内距不接受负值）',
  /margin-top: -30px/.test(lg.negTop) && !/padding-top: -/.test(lg.negTop), lg.negTop);
ok('左右留白能填负数，气泡贴到边上',
  /margin-left: -12px/.test(lg.negSide) && /margin-right: -12px/.test(lg.negSide), lg.negSide);
ok('头像与气泡的距离能填负数，两者叠起来',
  /margin-right: -8px/.test(lg.negAvGap) && /margin-left: -8px/.test(lg.negAvGap), lg.negAvGap);
ok('头像距离也能调成 0', /margin-right: 0px/.test(lg.zeroAvGap), lg.zeroAvGap);
ok('图标能往左往上挪', /translate\(-16px, -4px\)/.test(lg.negIcon), lg.negIcon);
ok('边框填 0 就是去掉边框', /border: none/.test(lg.zeroBorder), lg.zeroBorder);
ok('投影填 0 就是去掉投影', /box-shadow: none/.test(lg.zeroShadow), lg.zeroShadow);
ok('小尾巴能挪到气泡上沿之外', /top: -12px/.test(lg.negTailY), lg.negTailY.slice(0,300));
ok('输入框圆角能调成 0', /border-radius: 0px/.test(lg.zeroInR), lg.zeroInR);
ok('底栏下内边距能调成 0，把安全区一起去掉',
  /padding-bottom: 0px/.test(lg.padZero), lg.padZero);
ok('底栏下内边距能填负数，继续往下收',
  /padding-bottom: 0px/.test(lg.padNeg) && /margin-bottom: -24px/.test(lg.padNeg), lg.padNeg);
ok('上下内边距是两个旋钮，改上边不动下边',
  /padding-top: 6px/.test(lg.padTop) && !/padding-bottom/.test(lg.padTop), lg.padTop);
ok('位移填 0 也照发（那是一个正常的值）',
  /translate\(0px, 0px\)/.test(lg.zeroMetaless), lg.zeroMetaless);

ok('什么都没设时还是不发任何东西', lg.blank === '' && lg.blankExplicit === '',
  JSON.stringify([lg.blank, lg.blankExplicit]));
ok('把一项设成 0 算作「改过」', lg.changedZero === 1, String(lg.changedZero));
ok('空串不算改过', lg.changedUnset === 0, String(lg.changedUnset));

// 覆盖式的数值旋钮，默认值一律是空串，不是 0
const sentinel = lg.nums.filter(n => n.def === 0 && n.min >= 0);
ok('没有一项还拿 0 当「不改」', sentinel.length === 0,
  sentinel.map(n => `${n.g}.${n.id}`).join('、'));
const movers = lg.nums.filter(n => /X$|Y$|^x$|^y$/.test(n.id));
ok('每一项位移都能填负数', movers.every(n => n.min < 0),
  movers.filter(n => n.min >= 0).map(n => `${n.g}.${n.id}`).join('、'));

// 按名字查一遍：凡是「移动 / 偏移 / 距离 / 之间 / 留白」这一类，都得能填负。
// padding 那几项除外 —— CSS 本身不接受负的内边距（下内边距另有一条单查）
const NEG_WORDS = /移动|偏移|距离|之间|留白/;
const labels = await page.evaluate(async () => {
  const g = await import('/src/system/skin-gen.js');
  const out = [];
  g.GROUPS.forEach(grp => grp.items.forEach(it => {
    if (it.type === 'num') out.push({ g: grp.id, id: it.id, label: it.label, min: it.min });
  }));
  return out;
});
const oneWay = labels.filter(n => NEG_WORDS.test(n.label) && !/内边距/.test(n.label) && n.min >= 0);
ok('凡是「移动/偏移/距离/之间/留白」的都能填负',
  oneWay.length === 0, oneWay.map(n => `${n.g}.${n.id}（${n.label}，下限 ${n.min}）`).join('、'));
const padB = labels.find(n => n.id === 'padBottom');
ok('底栏下内边距单独放开到负', padB && padB.min < 0, JSON.stringify(padB));

// ---- 界面：滑杆有「不改」，数字框能填负 ----
const sid = await page.evaluate(async () => {
  const skin=await import('/src/system/skin.js');
  return skin.create({ name:'负值' }).id;
});
await page.evaluate(async (id) => {
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('skin','/'); n.popToRoot(); n.push(`/gen/${id}`);
}, sid);
await page.waitForSelector('.gen-rail'); await page.waitForTimeout(900);
await page.locator('.gen-rail-btn').filter({hasText:'消息'}).first().click();
await page.waitForTimeout(700);
const before = await page.evaluate(() => {
  const rows=[...document.querySelectorAll('.slider-row')];
  return { n: rows.length, unset: rows.filter(r=>r.classList.contains('is-unset')).length,
    clears: document.querySelectorAll('.slider-row .color-clear').length };
});
ok('没设过的滑杆标成未设置，且不显示「不改」',
  before.n > 0 && before.unset === before.n && before.clears === 0, JSON.stringify(before));

const box = page.locator('.slider-row .slider-num').first();
await box.fill('-20');
await page.waitForTimeout(700);
const after = await page.evaluate(async (id) => {
  const skin=await import('/src/system/skin.js');
  const row = skin.get(id);
  return { top: row.gen?.msg?.top,
    css: skin.gen.emit(row.gen),
    clears: document.querySelectorAll('.slider-row .color-clear').length };
}, sid);
ok('数字框填得进负数', Number(after.top) === -20, JSON.stringify(after.top));
ok('填了之后出现「不改」按钮', after.clears >= 1, String(after.clears));
ok('负数真的写进了 CSS', /margin-top: -20px/.test(after.css), after.css.slice(0,200));

await page.locator('.slider-row .color-clear').first().click();
await page.waitForTimeout(700);
const cleared = await page.evaluate(async (id) => {
  const skin=await import('/src/system/skin.js');
  return { top: skin.get(id).gen?.msg?.top, css: skin.gen.emit(skin.get(id).gen) };
}, sid);
ok('点「不改」就回到未设置', cleared.top === '' && cleared.css === '', JSON.stringify(cleared));

// 底部边距那一项也要能往下
await page.evaluate(async () => {
  const n=await import('/src/system/nav.js');
  n.goHome(); n.openApp('settings','/'); n.popToRoot(); n.push('/appearance');
});
await page.waitForTimeout(1000);
const lift = await page.evaluate(() => {
  const r=[...document.querySelectorAll('input[type=range]')]
    .find(x => Number(x.max) === 80);
  return r ? { min: Number(r.min), max: Number(r.max) } : null;
});
ok('底部边距那条滑杆放开到负', lift && lift.min < 0, JSON.stringify(lift));
// 滑杆放开了不等于真生效：applyLook 从前写着 Math.max(0, …)，值存了也被抹平
const applied = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const look = await import('/src/system/look.js');
  db.settings.set({ bottomLift: -24 });
  look.applyLook(db.settings.get());
  return getComputedStyle(document.documentElement).getPropertyValue('--bottom-lift').trim();
});
ok('负的底部边距真的写进了页面，没被钳成 0', applied === '-24px', applied);

await page.screenshot({path:`${OUT}/neg.png`});
ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
