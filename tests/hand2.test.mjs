// @serial  有时间上的断言，和别的测试抢 CPU 时会误报
// 正在输入只留文字、接口页顺序与限高、整个外壳不可选
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:760},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
if (process.env.DBG) page.on('console',m=>console.log('[page]',m.text()));
const REPLY='在的';
const sse=[...REPLY].map(ch=>`data: ${JSON.stringify({choices:[{delta:{content:ch}}]})}\n\n`).join('')+'data: [DONE]\n\n';
await page.route('**/v1/chat/completions', async r => {
  await new Promise(res=>setTimeout(res,1500));
  await r.fulfill({status:200,contentType:'text/event-stream; charset=utf-8',body:sse});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
if (await page.locator('.lock-unlock').count()) { await page.locator('.lock-unlock').click(); await page.waitForTimeout(300); }
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const ids = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const svc=await import('/src/system/ai/services.js');
  svc.newChatPreset({name:'t',provider:'openai',baseUrl:`${BASE}/v1`,apiKey:'k',model:'m'});
  const c=db.characters.create({name:'阿岚',persona:'x'});
  const chat=db.chats.create({characterIds:[c.id]});
  db.messages.create({chatId:chat.id,role:'user',authorId:'me',kind:'text',content:'在吗',status:'done'});
  const nav=await import('/src/system/nav.js'); nav.openApp('chat',`/chat/${chat.id}`);
  return { chatId:chat.id, charId:c.id };
});
await page.waitForTimeout(800);

// ---- 正在输入：名字变成「正在输入」，消息流里不多一个泡 ----
const before = await page.locator('.bubble').count();
await page.locator('[aria-label="让对方回复"]').click();
await page.waitForTimeout(600);
ok('没有转圈', await page.locator('.spinner').count()===0);
ok('没有三个点', await page.locator('.typing-dots').count()===0);
ok('标题变成正在输入', (await page.locator('.nav-title').innerText()).trim()==='正在输入',
  await page.locator('.nav-title').innerText());
ok('没有占位气泡', await page.locator('.conv-typing').count()===1
  && await page.locator('.bubble').count()===before, await page.locator('.bubble').count());
await page.screenshot({path:`${OUT}/h2-typing.png`});
await page.waitForTimeout(2600);
ok('回完标题换回名字', (await page.locator('.nav-title').innerText()).trim()==='阿岚',
  await page.locator('.nav-title').innerText());
ok('气泡这时候才出来', await page.locator('.bubble').count()===before+1,
  await page.locator('.bubble').count());
ok('气泡里就是回复', (await page.locator('.bubble').last().innerText()).includes('在的'),
  await page.locator('.bubble').last().innerText());

// ---- 整个外壳不可选 ----
const sel = await page.evaluate(() => {
  const get = sel => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).webkitUserSelect || getComputedStyle(el).userSelect : null;
  };
  return {
    root: get('.root'),
    bubble: get('.bubble'),
    notice: get('.conv-body'),
    navTitle: get('.nav-title'),
    input: get('.composer-input'),
  };
});
ok('外壳整体不可选', sel.root==='none', sel.root);
ok('气泡不可选', sel.bubble==='none', sel.bubble);
ok('消息区其余地方也不可选', sel.notice==='none', sel.notice);
ok('标题也不可选', sel.navTitle==='none', sel.navTitle);
ok('输入框仍然可以选', sel.input==='text', sel.input);

// -webkit-touch-callout 只有 iOS Safari 认，Chromium 连解析都不解析，
// cssRules 里根本没有这一条。所以直接读样式文件的原文
const css = await page.evaluate(() => fetch('/styles/ui.css').then(r => r.text()));
const block = css.slice(css.indexOf('.root, .no-callout'), css.indexOf('.root, .no-callout') + 400);
ok('外壳上写了不弹系统浮层', /-webkit-touch-callout:\s*none/.test(block), block.slice(0, 120));
ok('输入框那条单独放开了',
  /input, textarea[\s\S]{0,200}-webkit-touch-callout:\s*default/.test(css), '没找到');

// 长按气泡走的还是自己的菜单
await page.evaluate(async ({chatId}) => {
  const db=await import('/src/system/db/index.js');
  const m=db.messagesOf(chatId)[0];
  document.getElementById(`msg-${m.id}`).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}));
}, ids);
await page.waitForTimeout(500);
ok('长按还是弹自己的菜单', (await page.locator('.app-layer').innerText()).includes('复制'),
  (await page.locator('.app-layer').innerText()).slice(0,200));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// ---- 接口页 ----
await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const svc=await import('/src/system/ai/services.js');
  for (let i=0;i<8;i++) svc.newChatPreset({name:`接口 ${i}`,provider:'openai',baseUrl:'x',apiKey:'k',model:'m'});
  const nav=await import('/src/system/nav.js'); nav.openApp('settings','/api');
});
await page.waitForTimeout(800);
const txt = await page.locator('.app-layer').innerText();
const iNew = txt.indexOf('新建 Anthropic');
const iSaved = txt.indexOf('已保存的接口');
ok('新建在最上面', iNew >= 0 && iNew < iSaved, `${iNew} / ${iSaved}`);
ok('标题上写了共几个', /已保存的接口 \d+/.test(txt), txt.slice(iSaved, iSaved+20));

const caps = await page.evaluate(() => [...document.querySelectorAll('.list-cap')].map(el => ({
  h: Math.round(el.getBoundingClientRect().height),
  scroll: el.scrollHeight > el.clientHeight,
})));
ok('三个列表都限了高', caps.length===3, JSON.stringify(caps));
ok('九个预设撑不破区域', caps.every(c => c.h <= 250), JSON.stringify(caps));
ok('区域内自己能滚', caps.every(c => c.scroll), JSON.stringify(caps));
await page.screenshot({path:`${OUT}/h2-api.png`});

// 编辑器里先地址后密钥
await page.locator('.list-item').filter({ hasText:'接口 0' }).first().click();
await page.waitForTimeout(600);
const sheet = await page.locator('.sheet').innerText();
const iUrl = sheet.indexOf('接口地址');
const iKey = sheet.indexOf('API Key');
ok('先填地址再填密钥', iUrl >= 0 && iUrl < iKey, `${iUrl} / ${iKey}`);
ok('名称仍在最前', sheet.indexOf('名称') < iUrl);
await page.screenshot({path:`${OUT}/h2-editor.png`});

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
