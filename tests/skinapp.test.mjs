// 美化 app（独立的库那一页）：列表、预览、复制、导入导出、删除、使用情况
import { BASE, OUT, EXE, chromium, PNG_PATH } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2,acceptDownloads:true});
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.route('**/chat/completions', r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};
const open = (route='/') => page.evaluate(async r => {
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('skin', r); n.popToRoot(); if (r!=='/') n.push(r);
}, route);
const txt = () => page.locator('.page-body').last().innerText();

// ---- 注册进主界面了没有 ----
const reg = await page.evaluate(async () => {
  const { getApp } = await import('/src/system/registry.js');
  const m = getApp('skin');
  return m ? { id:m.id, name:m.name, icon:m.icon } : null;
});
ok('美化 app 已注册', reg && reg.id==='skin' && reg.name==='美化', JSON.stringify(reg));
ok('图标是 SVG 名字，不是 emoji', !!reg && /^[a-z-]+$/.test(reg.icon), JSON.stringify(reg));

// ---- 空库 ----
await page.evaluate(async () => {
  const skin=await import('/src/system/skin.js');
  skin.all().forEach(s => skin.remove(s.id));
});
await open('/');
await page.waitForSelector('.page'); await page.waitForTimeout(600);
let t = await txt();
ok('空库有空状态，说得出美化是做什么的', /还没有任何美化/.test(t) && /会话页面的样式/.test(t), t.slice(0,220));
ok('空库也能直接导入美化包', /导入美化包/.test(t), t.slice(0,220));

// ---- 新建，跳到详情 ----
await page.evaluate(async () => {
  const skin=await import('/src/system/skin.js');
  skin.create({ name:'夜航', tokens:{ bubbleR:20 }, shape:'round', css:'.bubble{opacity:.92}' });
  skin.create({ name:'白日', tokens:{ bubbleFS:17 } });
});
await page.waitForTimeout(500);
t = await txt();
ok('列表把两份都列出来', /夜航/.test(t) && /白日/.test(t), t.slice(0,220));
ok('列表数得出共几份', /共 2 份/.test(t), t.slice(0,120));
ok('没挂上的那份说「尚未用于任何会话」', /尚未用于任何会话/.test(t), t.slice(0,220));
ok('列表一个字人设都不露', !/persona|description/i.test(t), t.slice(0,220));

// ---- 详情页：预览画在 shadow root 里 ----
const sid = await page.evaluate(async () => {
  const skin=await import('/src/system/skin.js');
  return skin.all().find(s=>s.name==='夜航').id;
});
await open(`/one/${sid}`);
await page.waitForTimeout(900);
const prev = await page.evaluate(() => {
  const host = document.querySelector('.skin-preview');
  if (!host) return { none:true };
  const root = host.shadowRoot;
  if (!root) return { noShadow:true };
  // 底样式与这份美化各占一个 style 节点（改样式时只换后面那个的文字，
  // 不重建 DOM，见 GenPage），所以要把两个都读出来
  const style = [...root.querySelectorAll('style')].map(s => s.textContent).join('\n');
  return {
    bubbles: root.querySelectorAll('.bubble').length,
    mine: root.querySelectorAll('.msg.is-mine').length,
    host: /:host\{/.test(style),
    root: /:root\{/.test(style),
    mycss: /opacity:\.92/.test(style),
    leak: !!document.getElementById('skin-css'),
  };
});
ok('预览挂了 shadow root', !prev.none && !prev.noShadow, JSON.stringify(prev));
ok('样板消息画出来了', prev.bubbles>=3 && prev.mine>=1, JSON.stringify(prev));
ok('令牌挂在 :host 上，不是 :root', prev.host && !prev.root, JSON.stringify(prev));
ok('这份美化自己写的 CSS 也进去了', prev.mycss, JSON.stringify(prev));
ok('预览不会把样式漏到整个 app 上', !prev.leak, JSON.stringify(prev));
// 头像框在库里也要看得见 —— 那是这一份最认得出来的特征
const fs0 = await import('node:fs/promises');
const PNG = (await fs0.readFile(PNG_PATH,'utf-8')).trim();
await page.evaluate(async ([id, b64]) => {
  const skin=await import('/src/system/skin.js');
  skin.update(id, { gen: { avatar: { frameTheirs:`data:image/png;base64,${b64}`, frameScale:200 } } });
}, [sid, PNG]);
await page.waitForTimeout(900);
const framed = await page.evaluate(() => {
  const root = document.querySelector('.skin-preview')?.shadowRoot;
  if (!root) return null;
  const face = [...root.querySelectorAll('.msg')].find(m => !m.classList.contains('is-mine'))
    ?.querySelector('.msg-face');
  const mineFace = root.querySelector('.msg.is-mine .msg-face');
  const bg = face ? getComputedStyle(face, '::after').backgroundImage : '';
  const mineBg = mineFace ? getComputedStyle(mineFace, '::after').backgroundImage : '';
  return { bg: bg.slice(0, 22), mineBg };
});
ok('库里的预览也戴上了头像框', /^url\("data:image/.test(framed?.bg || ''), JSON.stringify(framed));
ok('「仅角色」在预览里也认', framed && framed.mineBg==='none', JSON.stringify(framed));
t = await txt();
ok('说清楚这只是静态预览，实时效果在会话里', /静态预览/.test(t) && /会话/.test(t), t.slice(0,300));

// ---- 复制一份 ----
await page.locator('.list-item').filter({hasText:'复制一份'}).first().click();
await page.waitForTimeout(700);
const dup = await page.evaluate(async () => {
  const skin=await import('/src/system/skin.js');
  const made = skin.all().find(s=>/副本/.test(s.name));
  const src = skin.all().find(s=>s.name==='夜航');
  if (!made) return null;
  skin.update(made.id, { css:'.bubble{opacity:.1}' });
  return { name:made.name, id:made.id, tokens:made.tokens, shape:made.shape,
    srcCss: skin.get(src.id).css };
});
ok('复制出一份，名字缀「副本」', dup && dup.name==='夜航 副本', JSON.stringify(dup));
ok('样式一并带过来', dup && dup.tokens.bubbleR===20 && dup.shape==='round', JSON.stringify(dup));
ok('改副本不动原件', dup && /opacity:\.92/.test(dup.srcCss), JSON.stringify(dup));

// ---- 使用情况：挂上之后列得出是哪几段会话 ----
const ids = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const skin=await import('/src/system/skin.js');
  const c=db.characters.create({ name:'阿岚', persona:'这一段人设一个字都不该露出来' });
  const chat=db.chats.create({ characterIds:[c.id], title:'阿岚' });
  const s=skin.all().find(x=>x.name==='夜航');
  skin.attach(chat.id, s.id);
  return { chatId:chat.id, skinId:s.id };
});
await open(`/one/${ids.skinId}`);
await page.waitForTimeout(800);
t = await txt();
ok('使用情况这一栏的标题是书面语', /使用情况/.test(t) && !/哪儿/.test(t), t.slice(0,300));
ok('列得出挂在哪段会话', /阿岚/.test(t), t.slice(0,400));
ok('资料页不露人设', !/一个字都不该露出来/.test(t), t.slice(0,400));
await open('/');
await page.waitForTimeout(600);
t = await txt();
ok('列表上也数得出用于几段会话', /已用于 1 段会话/.test(t), t.slice(0,300));

// ---- 跳去会话里调整，走的是 Intent ----
await open(`/one/${ids.skinId}`);
await page.waitForTimeout(700);
await page.locator('.list-item').filter({hasText:'阿岚'}).first().click();
await page.waitForTimeout(900);
const landed = await page.evaluate(async () => {
  const n=await import('/src/system/nav.js');
  return { app:n.nav.get().appId, route:n.currentRoute() };
});
ok('点进去落在 chat 的美化页', landed.app==='chat' && /^\/skin\//.test(String(landed.route)),
  JSON.stringify(landed));

// ---- 导出 ----
await open(`/one/${ids.skinId}`);
await page.waitForTimeout(700);
await page.evaluate(() => {
  window.__dl = [];
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { window.__dl.push(this.download); return orig.apply(this, arguments); };
});
await page.locator('.list-item').filter({hasText:'导出美化包'}).first().click();
await page.waitForTimeout(700);
// 这一份带着头像框，所以导出前会先说一句体积
const exDlg = await page.locator('.modal, .sheet, .confirm').innerText().catch(()=>'');
ok('带图的那一份，导出前说得出它有多大', /内嵌/.test(exDlg) && /KB/.test(exDlg), exDlg.slice(0,240));
await page.locator('button:has-text("继续导出")').last().click();
await page.waitForTimeout(400);
const [dl] = await Promise.all([
  page.waitForEvent('download', {timeout:10000}).catch(()=>null),
  page.locator('button:has-text("导出文件")').last().click(),
]);
ok('库里就能导出，不必先找一段会话', !!dl, '没有 download 事件');
ok('文件名是「美化-名字.json」', (await page.evaluate(()=>window.__dl||[]))[0]==='美化-夜航.json',
  JSON.stringify(await page.evaluate(()=>window.__dl||[])));

// ---- 导入 ----
await open('/');
await page.waitForTimeout(600);
const pack = JSON.stringify({ kind:'phone-skin', version:1, name:'别人给的',
  tokens:{ bubbleFS:19 }, shape:'square', css:'.bubble{letter-spacing:1px}' });
await page.setInputFiles('input[type=file]', { name:'x.json', mimeType:'application/json', buffer: Buffer.from(pack) });
await page.waitForTimeout(700);
const dlg = await page.locator('.modal, .sheet, .confirm').innerText().catch(()=>'');
ok('导入前先问一句，说明不会覆盖', /不会覆盖/.test(dlg), dlg.slice(0,220));
await page.locator('button:has-text("导入")').last().click();
await page.waitForTimeout(900);
const imported = await page.evaluate(async () => {
  const skin=await import('/src/system/skin.js');
  const s=skin.all().find(x=>x.name==='别人给的');
  const n=await import('/src/system/nav.js');
  return s ? { name:s.name, fs:s.tokens?.bubbleFS, shape:s.shape, route:n.currentRoute(),
    used: skin.chatsUsing(s.id).length } : null;
});
ok('导入之后库里多了一份', imported && imported.fs===19 && imported.shape==='square', JSON.stringify(imported));
ok('导入之后直接打开它', imported && imported.route===`/one/${(await page.evaluate(async()=>{const s=await import('/src/system/skin.js');return s.all().find(x=>x.name==='别人给的').id;}))}`,
  JSON.stringify(imported));
ok('从库里导入的不自动挂到任何会话上', imported && imported.used===0, JSON.stringify(imported));

// ---- 删除：先说清楚会影响哪几段会话 ----
await open(`/one/${ids.skinId}`);
await page.waitForTimeout(700);
await page.locator('button:has-text("删除这一份")').first().click();
await page.waitForTimeout(600);
const delDlg = await page.locator('.modal, .sheet, .confirm').innerText().catch(()=>'');
ok('删之前说得出会连累几段会话', /1 段会话/.test(delDlg) && /无法恢复/.test(delDlg), delDlg.slice(0,260));
await page.locator('button:has-text("删除")').last().click();
await page.waitForTimeout(900);
const gone = await page.evaluate(async ({chatId, skinId}) => {
  const skin=await import('/src/system/skin.js');
  const db=await import('/src/system/db/index.js');
  const n=await import('/src/system/nav.js');
  return { row: skin.get(skinId), chatSkin: db.chats.get(chatId)?.skinId, route: n.currentRoute() };
}, ids);
ok('删掉了', !gone.row, JSON.stringify(gone));
ok('挂着它的会话一并取下，不留孤儿', !gone.chatSkin, JSON.stringify(gone));
ok('删完退回列表', gone.route==='/', JSON.stringify(gone));

// ---- 详情页指向一份已经没了的美化 ----
await open(`/one/不存在的id`);
await page.waitForTimeout(700);
t = await txt();
ok('打开不存在的一份不炸，给一句话', /已经不在了/.test(t), t.slice(0,200));

await page.screenshot({path:`${OUT}/skinapp.png`});
ok('全程没有运行时报错', errs.length===0, errs.join(' | '));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
