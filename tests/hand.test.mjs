// 正在输入的三个点、回到最新、边缘滑动返回、命中区
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:760},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
if (process.env.DBG) page.on('console',m=>console.log('[page]',m.text()));

// 慢慢吐，好让「正在输入」停住给我们看
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
  for (let i=1;i<=40;i++) {
    db.messages.create({chatId:chat.id,role:i%2?'user':'char',authorId:i%2?'me':c.id,
      kind:'text',content:`第 ${i} 条消息`,status:'done'});
  }
  const nav=await import('/src/system/nav.js'); nav.openApp('chat',`/chat/${chat.id}`);
  return { chatId:chat.id, charId:c.id };
});
await page.waitForTimeout(900);

// ---- 正在输入 ----
// 默认是「按按钮才回」，所以发完还要点右边那个回复键
await page.locator('.composer-input').fill('在吗');
await page.locator('.send-btn').click();
await page.waitForTimeout(400);
await page.locator('[aria-label="让对方回复"]').click();
await page.waitForTimeout(600);
ok('转圈没有了', await page.locator('.bubble-empty .spinner').count()===0);
ok('三个点也没有', await page.locator('.typing-dots').count()===0);
ok('标题自己变成了正在输入',
  (await page.locator('.nav-title').innerText()).trim()==='正在输入',
  await page.locator('.nav-title').innerText().catch(()=>'(无)'));
ok('消息流里不多一个空泡', await page.locator('.bubble-empty').count()===0);
await page.screenshot({path:`${OUT}/hand-typing.png`});
await page.waitForTimeout(2600);
ok('回完标题换回名字', (await page.locator('.nav-title').innerText()).trim()!=='正在输入',
  await page.locator('.nav-title').innerText());
ok('页面上不再有正在输入', await page.locator('.conv-typing').count()===0);

// ---- 回到最新 ----
ok('贴着底部时不出现回到最新', await page.locator('.to-bottom').count()===0);
await page.locator('.conv-body').evaluate(el => { el.scrollTop = 0; });
await page.waitForTimeout(400);
ok('往上翻就出现', await page.locator('.to-bottom').count()===1);
await page.screenshot({path:`${OUT}/hand-tobottom.png`});

// 往上翻着的时候，别人发来消息不该把人拽下去
const before = await page.locator('.conv-body').evaluate(el => el.scrollTop);
await page.evaluate(async ({chatId,charId}) => {
  const db=await import('/src/system/db/index.js');
  db.messages.create({chatId,role:'char',authorId:charId,kind:'text',content:'新来的一条',status:'done'});
}, ids);
await page.waitForTimeout(500);
const after = await page.locator('.conv-body').evaluate(el => el.scrollTop);
ok('看旧消息时新消息不把人拽到底', Math.abs(after-before)<40, `${before} -> ${after}`);

await page.locator('.to-bottom').click();
await page.waitForTimeout(800);
ok('点一下回到底', await page.locator('.to-bottom').count()===0);

// 自己发的一定滚到底
await page.locator('.conv-body').evaluate(el => { el.scrollTop = 0; });
await page.waitForTimeout(300);
await page.locator('.composer-input').fill('我又说一句');
await page.locator('.send-btn').click();
await page.waitForTimeout(700);
const mine = await page.locator('.conv-body').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight);
ok('自己发的照样滚到底', mine < 120, String(mine));

// ---- 边缘滑动返回 ----
await page.waitForTimeout(2500);
const swipe = async (fromX, toX, y=400) => {
  await page.touchscreen.tap(fromX, y).catch(()=>{});
  await page.evaluate(async ({fromX,toX,y}) => {
    const el = document.querySelector('.app-layer .page') || document.querySelector('.page');
    const mk = (type, x) => new TouchEvent(type, { bubbles:true, cancelable:true,
      touches: type==='touchend' ? [] : [new Touch({identifier:1,target:el,clientX:x,clientY:y})],
      changedTouches: [new Touch({identifier:1,target:el,clientX:x,clientY:y})] });
    // 这一套手势要先划过一小段才认（page.js 里那个 OWN），
    // 只发 start 和 end 是不会开始的 —— 中间那几下 move 必须有
    el.dispatchEvent(mk('touchstart', fromX));
    // 每一下之间要真的隔一点时间：收尾按速度判甩不甩得动，
    // 一口气发完等于「零毫秒划了 20 像素」，再短的一划都会被当成甩
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      el.dispatchEvent(mk('touchmove', fromX + ((toX - fromX) * i) / steps));
      await new Promise(r => setTimeout(r, 24));
    }
    el.dispatchEvent(mk('touchend', toX));
  }, {fromX,toX,y});
  await page.waitForTimeout(500);
};
await page.evaluate(async ({charId}) => {
  const nav=await import('/src/system/nav.js'); nav.push(`/edit/${charId}`);
}, ids);
await page.waitForTimeout(600);
ok('先进到角色卡', (await page.locator('.app-layer').innerText()).includes('角色卡'));
await swipe(8, 140);
ok('从左边缘划回去了', !(await page.locator('.app-layer').innerText()).includes('角色卡'),
  (await page.locator('.app-layer').innerText()).slice(0,60));

await page.evaluate(async ({charId}) => {
  const nav=await import('/src/system/nav.js'); nav.push(`/edit/${charId}`);
}, ids);
await page.waitForTimeout(600);
await swipe(200, 340);
ok('从中间划不算返回', (await page.locator('.app-layer').innerText()).includes('角色卡'));
await swipe(8, 30);
ok('划得太短也不算', (await page.locator('.app-layer').innerText()).includes('角色卡'));
await page.evaluate(async () => { const nav=await import('/src/system/nav.js'); nav.pop(); });

// ---- 命中区 ----
const hit = await page.evaluate(() => {
  const box = sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el, '::after');
    const ins = k => parseFloat(cs[k]) || 0;
    // ::after 的 inset 是负数，撑出去多少就加多少
    return { w: r.width - ins('left') - ins('right'), h: r.height - ins('top') - ins('bottom') };
  };
  return { send: box('.send-btn'), side: box('.composer-side'), icon: box('.icon-btn') };
});
ok('发送键命中区够大', hit.send && hit.send.h >= 44 && hit.send.w >= 44, JSON.stringify(hit.send));
ok('输入栏左边那个也够大', hit.side && hit.side.h >= 44, JSON.stringify(hit.side));
ok('导航栏图标也够大', hit.icon && hit.icon.h >= 44 && hit.icon.w >= 44, JSON.stringify(hit.icon));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
