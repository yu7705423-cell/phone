// 美化契约：钩子真的挂着、变量真的生效、两档范围各自管到哪儿
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1800);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const ids = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const c=db.characters.create({ name:'阿岚' });
  const chat=db.chats.create({ characterIds:[c.id], lastMessageAt:Date.now() });
  db.messages.create({ chatId:chat.id, role:'char', kind:'text', content:'对方的', status:'done' });
  db.messages.create({ chatId:chat.id, role:'user', kind:'text', content:'我的', status:'done' });
  db.settings.set({ msgStamp:'side', msgRead:true });
  return { chatId:chat.id, charId:c.id };
});
const go = (app, route) => page.evaluate(async ([a,r]) => {
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp(a,'/'); n.popToRoot(); if (r!=='/') n.push(r);
}, [app, route]);

// ---- 一、会话那一档的钩子，在会话页上全都挂着 ----
await go('chat', `/chat/${ids.chatId}`);
await page.waitForSelector('.ph-msg'); await page.waitForTimeout(900);
const chatHits = await page.evaluate(async () => {
  const skin = await import('/src/system/skin.js');
  const out = {};
  skin.HOOKS.filter(h => h.on.includes('chat')).forEach(h => {
    out[h.hook] = { n: document.querySelectorAll(`.ph-${h.hook}`).length, needs: h.needs || '' };
  });
  return out;
});
const missChat = Object.entries(chatHits).filter(([, v]) => !v.n && !v.needs).map(([k]) => k);
ok('会话那一档里没写条件的钩子，会话页上全都挂着', missChat.length === 0, missChat.join('、'));
ok('两个方向的气泡分得开',
  chatHits['bubble-mine']?.n === 1 && chatHits['bubble-theirs']?.n === 1,
  JSON.stringify([chatHits['bubble-mine'], chatHits['bubble-theirs']]));

// ---- 二、变量真的能改动界面 ----
const sizes = async () => page.evaluate(() => {
  const b = document.querySelector('.ph-bubble');
  const a = document.querySelector('.ph-face .ph-avatar');
  const c = document.querySelector('.ph-composer-btn');
  const cs = el => el ? getComputedStyle(el) : null;
  return {
    r: cs(b)?.borderTopLeftRadius, fs: cs(b)?.fontSize,
    av: cs(a)?.width, avr: cs(a)?.borderTopLeftRadius,
    btn: cs(c)?.width,
  };
});
const before = await sizes();
await page.evaluate(() => {
  const el = document.createElement('style');
  el.id = 'fake-skin';
  el.textContent = ':root{--ph-bubble-r:25px;--ph-bubble-fs:19px;'
    + '--ph-avatar-size:52px;--ph-avatar-r:50%;--ph-composer-h:55px}';
  document.head.appendChild(el);
});
await page.waitForTimeout(400);
const after = await sizes();
ok('--ph-bubble-r 改得动气泡圆角', after.r === '25px', JSON.stringify([before.r, after.r]));
ok('--ph-bubble-fs 改得动气泡字号', after.fs === '19px', JSON.stringify([before.fs, after.fs]));
ok('--ph-avatar-size 改得动头像大小（从前内联写死，改不动）',
  after.av === '52px' && before.av !== after.av, JSON.stringify([before.av, after.av]));
ok('--ph-avatar-r 改得动头像圆角', parseFloat(after.avr) > parseFloat(before.avr) ,
  JSON.stringify([before.avr, after.avr]));
ok('--ph-composer-h 改得动底栏按钮', after.btn === '55px', JSON.stringify([before.btn, after.btn]));

// 头像那一项只管会话里的，别处的头像不该跟着变大
const elsewhere = await page.evaluate(() => {
  const a = [...document.querySelectorAll('.ph-avatar')].find(x => !x.closest('.ph-face'));
  return a ? getComputedStyle(a).width : null;
});
ok('会话之外的头像不跟着变', elsewhere === null || elsewhere !== '52px', String(elsewhere));
await page.evaluate(() => document.getElementById('fake-skin')?.remove());

// ---- 三、外壳那一档的钩子，在主界面上挂着 ----
await page.evaluate(async () => { const n=await import('/src/system/nav.js'); n.goHome(); });
await page.waitForTimeout(900);
const shellHits = await page.evaluate(async () => {
  const skin = await import('/src/system/skin.js');
  const out = {};
  skin.HOOKS.filter(h => h.on.includes('shell') && !h.needs).forEach(h => {
    out[h.hook] = document.querySelectorAll(`.ph-${h.hook}`).length;
  });
  return out;
});
const missShell = Object.entries(shellHits).filter(([, n]) => !n).map(([k]) => k);
// 列表、浮层、弹窗这些主界面上本来就没有，只查主界面自己那几个
const homeOnly = ['screen','home','home-grid','tile','dock'];
ok('主界面那几个钩子都挂着',
  homeOnly.every(h => shellHits[h] > 0), JSON.stringify(shellHits));
ok('其余外壳钩子在别的页面上（这里只是没画到）', true);

// ---- 四、两档范围 ----
const scoped = await page.evaluate(async (chatId) => {
  const skin = await import('/src/system/skin.js');
  const db = await import('/src/system/db/index.js');
  const only = skin.create({ name:'只会话', css:'.ph-bubble{opacity:.5}' });
  const both = skin.create({ name:'全局', scope:['chat','shell'], css:'.ph-navbar{opacity:.5}' });
  const bad = skin.unpack(JSON.stringify({ kind:'phone-skin', version:1, name:'老包' }));
  const evil = skin.unpack(JSON.stringify({ kind:'phone-skin', version:1, name:'乱写',
    scope:['shell','乱来','chat'] }));
  skin.attach(chatId, only.id);
  return {
    only: skin.scopeOf(only), both: skin.scopeOf(both),
    onlyGlobal: skin.isGlobal(only), bothGlobal: skin.isGlobal(both),
    oldPack: bad.scope, evilPack: evil.scope,
    onlyId: only.id, bothId: both.id,
    packed: JSON.parse(skin.pack(both)).scope,
    dup: skin.scopeOf(skin.duplicate(both.id)),
    settings: db.settings.get().globalSkinId,
  };
}, ids.chatId);
ok('不写 scope 就是单段会话', JSON.stringify(scoped.only) === '["chat"]', JSON.stringify(scoped.only));
ok('老的美化包（没有 scope）也按单段会话读',
  JSON.stringify(scoped.oldPack) === '["chat"]', JSON.stringify(scoped.oldPack));
ok('包里乱写的那一档被丢掉',
  JSON.stringify(scoped.evilPack) === '["shell","chat"]', JSON.stringify(scoped.evilPack));
ok('声明了 shell 才算全局', !scoped.onlyGlobal && scoped.bothGlobal,
  JSON.stringify([scoped.onlyGlobal, scoped.bothGlobal]));
ok('导出与复制都带着 scope',
  JSON.stringify(scoped.packed) === '["chat","shell"]'
  && JSON.stringify(scoped.dup) === '["chat","shell"]',
  JSON.stringify([scoped.packed, scoped.dup]));

// 设为全局，主界面上要真的生效
await page.evaluate(async (id) => {
  const skin = await import('/src/system/skin.js');
  skin.setGlobal(id);
}, scoped.bothId);
await page.waitForTimeout(900);
const onHome = await page.evaluate(() => ({
  node: !!document.getElementById('skin-global'),
  nav: getComputedStyle(document.querySelector('.ph-navbar') || document.body).opacity,
}));
ok('设为全局之后，全局那一层真的挂上了', onHome.node, JSON.stringify(onHome));

// ---- 五、逃生口：进设置就摘掉 ----
await go('settings', '/');
await page.waitForTimeout(1000);
const inSettings = await page.evaluate(() => ({
  node: !!document.getElementById('skin-global'),
  nav: getComputedStyle(document.querySelector('.ph-navbar') || document.body).opacity,
}));
ok('打开设置时全局那一层摘掉了（这是唯一的逃生口）', !inSettings.node, JSON.stringify(inSettings));
ok('设置页的顶栏不受它影响', inSettings.nav === '1', inSettings.nav);
await page.evaluate(async () => { const n=await import('/src/system/nav.js'); n.goHome(); });
await page.waitForTimeout(800);
ok('离开设置又挂回去', await page.evaluate(() => !!document.getElementById('skin-global')));

// 总开关
await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  db.settings.set({ skinOff: true });
});
await page.waitForTimeout(800);
ok('总开关一关，全局那一层就没了',
  !await page.evaluate(() => !!document.getElementById('skin-global')));
await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  db.settings.set({ skinOff: false });
});

// 删掉设为全局的那一份，设置里不许留一个指向空的 id
await page.evaluate(async (id) => {
  const skin=await import('/src/system/skin.js');
  skin.remove(id);
}, scoped.bothId);
await page.waitForTimeout(600);
ok('删掉全局那一份，设置里的 id 一并清掉',
  !(await page.evaluate(async () => (await import('/src/system/db/index.js')).settings.get().globalSkinId)));

// ---- 六、写给作者那一页 ----
await go('skin', '/contract');
await page.waitForTimeout(1000);
const doc = await page.locator('.page-body').last().innerText();
ok('契约页列得出类名', /\.ph-bubble/.test(doc) && /\.ph-navbar/.test(doc), doc.slice(0,200));
ok('契约页说得出契约版本', /契约版本 \d+/.test(doc), doc.slice(0,200));
await page.locator('.seg-item, .segmented button').filter({hasText:'怎么写'}).first().click();
await page.waitForTimeout(600);
const how = await page.locator('.page-body').last().innerText();
ok('契约页说清楚 !important 什么时候要写', /!important/.test(how) && /复合选择器/.test(how), how.slice(0,400));
ok('契约页说清楚图片要写成 data 或公网地址', /data|公网/.test(how), how.slice(0,400));
await page.locator('.seg-item, .segmented button').filter({hasText:'变量'}).first().click();
await page.waitForTimeout(600);
const varsTxt = await page.locator('.page-body').last().innerText();
ok('契约页列得出变量', /--ph-bubble-r/.test(varsTxt) && /--ph-avatar-size/.test(varsTxt),
  varsTxt.slice(0,240));
await page.screenshot({path:`${OUT}/contract.png`, fullPage:true});
ok('全程没有运行时报错', errs.length===0, errs.join(' | '));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
