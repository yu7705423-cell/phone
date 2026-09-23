// 复刻页：和真会话页的契约钩子结构必须对得上，否则对着它调出来的东西回去不生效
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1800);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// 真会话页：造一段能把大多数钩子凑齐的历史
const ids = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const c=db.characters.create({ name:'阿岚' });
  const chat=db.chats.create({ characterIds:[c.id], lastMessageAt:Date.now() });
  const a=db.messages.create({ chatId:chat.id, role:'char', kind:'text', content:'连着的第一条', status:'done' });
  db.messages.create({ chatId:chat.id, role:'char', kind:'text', content:'连着的第二条', status:'done' });
  db.messages.create({ chatId:chat.id, role:'user', kind:'text', content:'我回一条', status:'done',
    quoteId:a.id, quoteRole:'char', quoteText:'连着的第一条' });
  db.settings.set({ msgStamp:'side', msgRead:true });
  const s=(await import('/src/system/skin.js')).create({ name:'对表' });
  return { chatId:chat.id, skinId:s.id };
});
await page.evaluate(async ({chatId}) => {
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('chat','/'); n.popToRoot(); n.push(`/chat/${chatId}`);
}, ids);
await page.waitForSelector('.ph-msg'); await page.waitForTimeout(1000);

// 两边各量一次：每个钩子出现没有、以及它的父钩子是谁
const shapeOf = () => page.evaluate(async () => {
  const skin = await import('/src/system/skin.js');
  const out = {};
  skin.HOOKS.forEach(h => {
    const el = document.querySelector(`.ph-${h.hook}`);
    if (!el) { out[h.hook] = null; return; }
    // 往上找最近的一个契约钩子，当作它的「父」
    let p = el.parentElement, parent = '';
    while (p && !parent) {
      const hit = skin.HOOKS.find(x => p.classList?.contains(`ph-${x.hook}`));
      if (hit) parent = hit.hook;
      p = p.parentElement;
    }
    out[h.hook] = parent || '(顶)';
  });
  return out;
});
const real = await shapeOf();

// 复刻页：塞进一个离屏容器，量同一批
const stage = await page.evaluate(async () => {
  const skin = await import('/src/system/skin.js');
  const host = document.createElement('div');
  host.id = 'stage-probe';
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:430px';
  host.innerHTML = skin.buildStage();
  document.body.appendChild(host);
  const out = {};
  skin.HOOKS.forEach(h => {
    const el = host.querySelector(`.ph-${h.hook}`);
    if (!el) { out[h.hook] = null; return; }
    let p = el.parentElement, parent = '';
    while (p && p !== host && !parent) {
      const hit = skin.HOOKS.find(x => p.classList?.contains(`ph-${x.hook}`));
      if (hit) parent = hit.hook;
      p = p.parentElement;
    }
    out[h.hook] = parent || '(顶)';
  });
  host.remove();
  return out;
});

// 会话那一档里，真页面上有的，复刻页也必须有
const chatHooks = await page.evaluate(async () =>
  (await import('/src/system/skin.js')).HOOKS.filter(h => h.on.includes('chat')).map(h => h.hook));
const missing = chatHooks.filter(h => real[h] && !stage[h]);
ok('真页面上有的钩子，复刻页一个都不少', missing.length === 0, missing.join('、'));
// 复刻页比真页面多出来的，必须是契约里标了「要满足什么才看得见」的那些
// —— 摆出真页面上凑不齐的状态正是它存在的理由。多出来一个没标条件的，
// 才说明复刻页在无中生有
const conditional = await page.evaluate(async () =>
  (await import('/src/system/skin.js')).HOOKS.filter(h => h.needs).map(h => h.hook));
const extra = chatHooks.filter(h => stage[h] && !real[h] && !conditional.includes(h));
ok('复刻页多出来的都是真页面当时没凑齐的那几种状态', extra.length === 0, extra.join('、'));
// `page` 本身不比：真页面外面还套着外壳（screen），复刻页没有外壳，
// 这一处不同是对的
const wrong = chatHooks.filter(h => h !== 'page' && real[h] && stage[h] && real[h] !== stage[h])
  .map(h => `${h}: 真=${real[h]} 复刻=${stage[h]}`);
ok('每个钩子的父级也对得上', wrong.length === 0, wrong.join(' | '));

// 复刻页要摆出真页面上不好凑的几种状态
const states = await page.evaluate(async () => {
  const skin = await import('/src/system/skin.js');
  const host = document.createElement('div');
  host.innerHTML = skin.buildStage();
  const q = s => host.querySelectorAll(s).length;
  const rows = [...host.querySelectorAll('.ph-msg')];
  let run = 0, best = 0;
  rows.forEach(r => {
    if (r.classList.contains('ph-msg-theirs')) { run += 1; best = Math.max(best, run); }
    else run = 0;
  });
  const multi = rows.some(r => r.querySelectorAll('.ph-bubble').length >= 2);
  return { rows: rows.length, run: best, multi, quote: q('.ph-quote'),
    sticker: q('.ph-sticker'), stamp: q('.ph-stamp'), read: q('.ph-read'),
    mine: q('.ph-msg-mine'), theirs: q('.ph-msg-theirs'),
    back: q('.ph-back'), act: q('.ph-nav-action'),
    plus: q('.ph-plus'), stk: q('.ph-sticker-btn'), send: q('.ph-send') };
});
ok('摆出了同一个人连发三条', states.run >= 3, JSON.stringify(states));
ok('摆出了一轮拆成两个气泡', states.multi, JSON.stringify(states));
ok('引用、表情、时刻、已读都在',
  states.quote >= 1 && states.sticker >= 1 && states.stamp >= 1 && states.read >= 1,
  JSON.stringify(states));
ok('双方各有几条', states.mine >= 1 && states.theirs >= 1, JSON.stringify(states));
ok('四个能换图的按钮都在',
  states.back && states.act && states.plus && states.stk && states.send, JSON.stringify(states));

// ---- 生成器那一页：预览画出来了，展开一组会放大 ----
await page.evaluate(async ({skinId}) => {
  const n=await import('/src/system/nav.js');
  n.goHome(); n.openApp('skin','/'); n.popToRoot(); n.push(`/gen/${skinId}`);
}, ids);
await page.waitForSelector('.gen-rail'); await page.waitForTimeout(1200);
const shown = await page.evaluate(() => {
  const root = document.querySelector('.gen-stage')?.shadowRoot;
  if (!root) return null;
  const sc = root.querySelector('.stage-scale');
  return { bubbles: root.querySelectorAll('.ph-bubble').length,
    nav: !!root.querySelector('.ph-navbar'), composer: !!root.querySelector('.ph-composer'),
    transform: sc?.style.transform || '' };
});
ok('预览画在 shadow root 里，整屏都在',
  shown && shown.bubbles >= 6 && shown.nav && shown.composer, JSON.stringify(shown));
// 默认整页看得见：宽高各算一个倍率取小的，再横向居中
ok('默认是整页缩放，不放大',
  /^scale\([\d.]+\) translateX\([-\d.]+px\)$/.test(shown.transform), shown.transform);
ok('默认能看到顶栏与底栏', await page.evaluate(() => {
  const host = document.querySelector('.gen-stage');
  const sc = host?.shadowRoot?.querySelector('.stage-scale');
  const k = parseFloat((sc?.style.transform.match(/scale\(([\d.]+)\)/) || [])[1] || '1');
  // 盒子多高由布局决定（收起旋钮时占满），所以对着它本身量，不写死
  return sc && sc.offsetHeight * k <= host.clientHeight + 1;
}), '整页装不进那个盒子');

await page.locator('.gen-rail-btn').filter({hasText:'顶栏'}).first().click();
await page.waitForTimeout(800);
const zoomed = await page.evaluate(() => {
  const sc = document.querySelector('.gen-stage')?.shadowRoot?.querySelector('.stage-scale');
  return sc?.style.transform || '';
});
// **横向一刀都不许切。** 第一版按目标的高度算倍率，顶栏才几十像素高，
// 于是算出一个很大的倍率 —— 430 宽的页面只看得见中间 240，两边全没了。
// 那几样本来就是整行宽的，横向放大一点好处没有。
const seen = async () => page.evaluate(() => {
  const host = document.querySelector('.gen-stage');
  const sc = host.shadowRoot.querySelector('.stage-scale');
  const k = parseFloat((sc.style.transform.match(/scale\(([\d.]+)\)/) || [])[1] || '1');
  const ty = parseFloat((sc.style.transform.match(/translateY\(([-\d.]+)px\)/) || [])[1] || '0');
  return { k, ty, seeW: host.clientWidth / k, boxH: host.clientHeight, seeH: host.clientHeight / k };
});
const cut = [];
for (const g of ['顶栏', '挂图', '消息', '头像', '尾巴', '时刻', '气泡', '边框', '底栏']) {
  await page.locator('.gen-rail-btn').filter({ hasText: g }).first().click();
  await page.waitForTimeout(500);
  const v = await seen();
  if (v.seeW < 429.5) cut.push(`${g}: 只看得见 ${Math.round(v.seeW)}`);
}
ok('每一组展开时，整页宽度都看得全，没有一处被切', cut.length === 0, cut.join(' | '));

// 聚焦要真的把那一块滚进视野
const inView = async sel => page.evaluate(s2 => {
  const host = document.querySelector('.gen-stage');
  const sc = host.shadowRoot.querySelector('.stage-scale');
  const k = parseFloat((sc.style.transform.match(/scale\(([\d.]+)\)/) || [])[1] || '1');
  const ty = parseFloat((sc.style.transform.match(/translateY\(([-\d.]+)px\)/) || [])[1] || '0');
  const el = host.shadowRoot.querySelector(s2);
  if (!el) return null;
  const top = (el.offsetTop + ty) * k;
  const bot = (el.offsetTop + el.offsetHeight + ty) * k;
  return { top, bot, boxH: host.clientHeight };
}, sel);
await page.locator('.gen-rail-btn').filter({ hasText: '底栏' }).first().click();
await page.waitForTimeout(600);
const bar = await inView('.ph-composer');
ok('点底栏，底栏真的在视野里',
  bar && bar.top >= -1 && bar.bot <= bar.boxH + 1, JSON.stringify(bar));
await page.locator('.gen-rail-btn').filter({ hasText: '顶栏' }).first().click();
await page.waitForTimeout(600);
const top = await inView('.ph-navbar');
ok('点顶栏，顶栏真的在视野里',
  top && top.top >= -1 && top.bot <= top.boxH + 1, JSON.stringify(top));

// 收起来时整页都装得下
await page.locator('.gen-rail-btn').filter({ hasText: '顶栏' }).first().click();
await page.waitForTimeout(600);
const whole = await page.evaluate(() => {
  const host = document.querySelector('.gen-stage');
  const sc = host.shadowRoot.querySelector('.stage-scale');
  const k = parseFloat((sc.style.transform.match(/scale\(([\d.]+)\)/) || [])[1] || '1');
  return { h: sc.offsetHeight * k, box: host.clientHeight, w: 430 * k, boxW: host.clientWidth };
});
ok('收起来时整页高度也装得下', whole.h <= whole.box + 1, JSON.stringify(whole));
ok('收起来时宽度也不切', whole.w <= whole.boxW + 1, JSON.stringify(whole));

// 改一个旋钮，预览当场变
await page.evaluate(async (skinId) => {
  const skin=await import('/src/system/skin.js');
  skin.update(skinId, { gen: { nav: { bg:'#00ff00' } } });
}, ids.skinId);
await page.waitForTimeout(900);
const navBg = await page.evaluate(() => {
  const el = document.querySelector('.gen-stage')?.shadowRoot?.querySelector('.ph-navbar');
  return el ? getComputedStyle(el).backgroundColor : '';
});
ok('改旋钮，预览当场跟着变', navBg === 'rgb(0, 255, 0)', navBg);

await page.screenshot({path:`${OUT}/stage.png`});
ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
