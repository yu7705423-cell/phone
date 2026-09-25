// 美化包：导出、导入、以及各种坏文件
import { BASE, OUT, EXE, chromium } from './_env.mjs';
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

// ---- 纯逻辑 ----
const lg = await page.evaluate(async () => {
  const skin = await import('/src/system/skin.js');
  const out = {};
  const row = skin.create({ name:'夜色', tokens:{ bubbleR: 20, navH: 60, 乱来: 9 }, shape:'round',
    css:'.bubble{background:#222;background-image:url(https://x/y.png)}' });
  out.text = skin.pack(row);
  out.parsed = skin.unpack(out.text);
  out.assets = skin.assetsOf('.a{background:url(data:image/png;base64,AA)}'
    + '.b{background:url("https://x/y.png")}.c{background:url(blob:zz)}.d{background:url(img/1.png)}');
  // 坏文件各一种
  const bad = t => { try { skin.unpack(t); return '没报错'; } catch(e){ return String(e.message||e); } };
  out.e1 = bad('这不是 json');
  out.e2 = bad('[1,2,3]');
  out.e3 = bad(JSON.stringify({ kind:'别的东西', version:1 }));
  out.e4 = bad(JSON.stringify({ kind:'phone-skin', version:99 }));
  // 重名要加后缀，不覆盖
  const a1 = skin.install(skin.unpack(out.text));
  const a2 = skin.install(skin.unpack(out.text));
  out.names = [a1.name, a2.name];
  out.count = skin.all().filter(x=>x.name.startsWith('夜色')).length;
  out.installed = { tokens: a1.tokens, shape: a1.shape, css: a1.css };
  // 导入的那一份不该带着「挂在哪几段会话」
  out.keys = Object.keys(a1).sort().join(',');
  return out;
});
ok('导出的是 JSON 且带 kind 与版本', JSON.parse(lg.text).kind==='phone-skin' && JSON.parse(lg.text).version===1, lg.text?.slice(0,80));
ok('名字、形状、CSS 原样带走',
  lg.parsed.name==='夜色' && lg.parsed.shape==='round' && /background:#222/.test(lg.parsed.css),
  JSON.stringify(lg.parsed).slice(0,160));
ok('认识的令牌留下', lg.parsed.tokens.bubbleR===20 && lg.parsed.tokens.navH===60, JSON.stringify(lg.parsed.tokens));
ok('不认识的字段丢掉', !('乱来' in lg.parsed.tokens), JSON.stringify(lg.parsed.tokens));
ok('url 三类分得开',
  lg.assets.data===1 && lg.assets.remote===1 && lg.assets.local.length===2, JSON.stringify(lg.assets));
ok('不是 JSON：说得出是 JSON 的问题', /JSON/.test(lg.e1), lg.e1);
ok('是数组不是对象：说得出来', /不是一个对象/.test(lg.e2), lg.e2);
ok('标记不对：把标记原样写出来', /别的东西/.test(lg.e3), lg.e3);
ok('版本太新：说得出版本号', /99/.test(lg.e4), lg.e4);
// 库里本来就有一份「夜色」，所以两次导入应该是（2）和（3），彼此不同也不等于原名
ok('重名不覆盖，各自加后缀',
  lg.names[0]!==lg.names[1] && !lg.names.includes('夜色')
  && lg.names.every(n => /^夜色（\d+）$/.test(n)), JSON.stringify(lg.names));
ok('两份都在，没被盖掉', lg.count>=3, String(lg.count));
ok('导入的内容和导出的一致',
  lg.installed.shape==='round' && lg.installed.tokens.bubbleR===20, JSON.stringify(lg.installed));
ok('包里不含「挂在哪几段会话」', !/skinId|chatId/.test(lg.text), lg.text?.slice(0,200));

// ---- 界面：导出下载 ----
const ids = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const skin=await import('/src/system/skin.js');
  const c=db.characters.create({ name:'阿岚' });
  const chat=db.chats.create({ characterIds:[c.id], title:'阿岚' });
  const s=skin.create({ name:'测试皮', tokens:{bubbleR:18}, shape:'soft', css:'.bubble{opacity:.9}' });
  skin.attach(chat.id, s.id);
  return { chatId: chat.id, skinId: s.id };
});
// 导出改的是这一份美化本身，在「美化」app 里那一份的页面上；会话里的美化页只管挂哪一份
await page.evaluate(async ({chatId}) => {
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('chat','/'); n.popToRoot(); n.push(`/skin/${chatId}`);
}, ids);
await page.waitForSelector('.page'); await page.waitForTimeout(700);
const chatSkin = await page.locator('.app-layer').innerText();
ok('会话里的美化页不再放导出、尺寸、自定义 CSS', !/导出美化包|尺寸|自定义 CSS/.test(chatSkin.replace(/在「美化」中编辑尺寸、生成器与自定义 CSS/, '')), chatSkin.slice(0, 400));
ok('会话里的美化页有头像形状与显示头像', /头像形状/.test(chatSkin) && /显示头像/.test(chatSkin));
await page.evaluate(async ({skinId}) => {
  const n=await import('/src/system/nav.js');
  n.goHome(); n.openApp('skin', `/one/${skinId}`);
}, ids);
await page.waitForSelector('.page'); await page.waitForTimeout(700);
ok('美化 app 里那一份的页面出现「导出美化包」', /导出美化包/.test(await page.locator('.app-layer').innerText()));

// 复制 CSS：尺寸、生成器、自定义 CSS 合在一起的那一整段
await page.evaluate(() => { window.__clip = ''; navigator.clipboard.writeText = async t => { window.__clip = t; }; });
await page.locator('.list-item').filter({hasText:'复制 CSS'}).first().click();
await page.waitForTimeout(300);
const clip = await page.evaluate(() => window.__clip);
ok('复制 CSS：拿到的是这一份最终生效的全部样式', /--ph-bubble-r:18px/.test(clip) && /opacity:\.9/.test(clip), clip.slice(0, 200));
// 记下点下载那一刻 a.download 是什么。
// **不用 Playwright 的 suggestedFilename()** —— 这个 context 里它稳定回
// 「download」，而页面明明设对了；测的该是页面的行为，不是它的转述
await page.evaluate(() => {
  window.__dl = [];
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    window.__dl.push(this.download);
    return orig.apply(this, arguments);
  };
});
// 点「导出美化包」先出一页：填作者、选格式（ARCHITECTURE 4.239），默认 JSON、不署名
await page.locator('.list-item').filter({hasText:'导出美化包'}).first().click();
await page.waitForTimeout(400);
const [dl] = await Promise.all([
  page.waitForEvent('download', {timeout:10000}).catch(()=>null),
  page.locator('button:has-text("导出文件")').last().click(),
]);
ok('点了真的下载出一个文件', !!dl, '没有 download 事件');
const dlNames = await page.evaluate(() => window.__dl || []);
ok('文件名是「美化-名字.json」', dlNames[0]==='美化-测试皮.json', JSON.stringify(dlNames));
if (dl) {
  const fs = await import('node:fs/promises');
  const path = `${OUT}/skinpack-dl.json`;
  await dl.saveAs(path);
  const got = JSON.parse(await fs.readFile(path,'utf-8'));
  ok('文件内容是那一份美化', got.name==='测试皮' && got.shape==='soft' && got.tokens.bubbleR===18,
    JSON.stringify(got).slice(0,140));
}

// ---- 界面：导入（会话里的美化页） ----
await page.evaluate(async ({chatId}) => {
  const skin=await import('/src/system/skin.js');
  skin.detach(chatId);          // 回到选择页
  const n=await import('/src/system/nav.js');
  n.goHome(); n.openApp('chat','/'); n.popToRoot(); n.push(`/skin/${chatId}`);
}, ids);
await page.waitForTimeout(800);
ok('选择页出现「导入美化包」', /导入美化包/.test(await page.locator('.page').innerText()),
  (await page.locator('.page').innerText()).slice(0,200));
const pack = JSON.stringify({ kind:'phone-skin', version:1, name:'别人给的',
  tokens:{ bubbleFS:17 }, shape:'square', css:'.bubble{letter-spacing:1px}' });
await page.setInputFiles('input[type=file]', { name:'x.json', mimeType:'application/json', buffer: Buffer.from(pack) });
await page.waitForTimeout(600);
const dlg = await page.locator('.modal, .sheet, .confirm').innerText().catch(()=>'');
ok('导入前先问一句，并说明不会覆盖', /不会覆盖/.test(dlg), dlg.slice(0,200));
await page.locator('button:has-text("导入")').last().click();
await page.waitForTimeout(800);
const after = await page.evaluate(async () => {
  const skin=await import('/src/system/skin.js');
  const db=await import('/src/system/db/index.js');
  const chat=db.chats.all()[0];
  const cur=skin.ofChat(chat.id);
  return cur ? { name:cur.name, shape:cur.shape, fs:cur.tokens?.bubbleFS, css:cur.css } : null;
});
ok('导入之后当场挂上了', after && after.name==='别人给的', JSON.stringify(after));
ok('内容对', after && after.shape==='square' && after.fs===17 && /letter-spacing/.test(after.css),
  JSON.stringify(after));
await page.screenshot({path:`${OUT}/skinpack.png`});
ok('全程没有运行时报错', errs.length===0, errs.join(' | '));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
