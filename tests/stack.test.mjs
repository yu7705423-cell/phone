// @serial  有时间上的断言，和别的测试抢 CPU 时会误报
// 多张图摞成一叠
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
if (process.env.DBG) page.on('console',m=>console.log('[page]',m.text()));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
if (await page.locator('.lock-unlock').count()) { await page.locator('.lock-unlock').click(); await page.waitForTimeout(300); }
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// ---- 分组规则 ----
const g = await page.evaluate(async () => {
  const { groupImages } = await import('/src/apps/chat/pages/ImageStack.js');
  const R=[]; const ok=(n,c,e)=>R.push({name:n,pass:!!c,extra:e});
  const img=(id,role='user',extra={})=>({id,role,authorId:role==='user'?'me':'c',kind:'image',...extra});
  const txt=(id,role='user')=>({id,role,authorId:role==='user'?'me':'c',kind:'text',content:'x'});

  let r=groupImages([img('a'),img('b'),img('c')]);
  ok('三张连着就摞成一叠', r.length===1 && r[0].stack && r[0].msgs.length===3, JSON.stringify(r.map(x=>x.stack)));

  r=groupImages([img('a')]);
  ok('只有一张不摞', r.length===1 && !r[0].stack);

  r=groupImages([img('a'),txt('t'),img('b')]);
  ok('中间夹了一句话就断开', r.length===3 && !r.some(x=>x.stack), JSON.stringify(r.map(x=>x.stack)));

  r=groupImages([img('a'),img('b'),txt('t'),img('c'),img('d')]);
  ok('断开之后各摞各的', r.filter(x=>x.stack).length===2, JSON.stringify(r.map(x=>x.stack)));

  r=groupImages([img('a','user'),img('b','char')]);
  ok('两个人各发一张不摞在一起', !r.some(x=>x.stack), JSON.stringify(r.map(x=>x.stack)));

  r=groupImages([img('a'),img('b',"user",{status:'error'}),img('c')]);
  ok('出错的那张单独放', r.filter(x=>x.stack).length===0, JSON.stringify(r.map(x=>x.stack)));

  r=groupImages([img('a'),img('b',"user",{media:'pending'})]);
  ok('还在生成的也不并进来', !r.some(x=>x.stack));

  // 带着状态的那几张下面挂着一行说明，摞进去那行就没了
  r=groupImages([img('a'),img('b','user',{vision:'off'})]);
  ok('识图没开的那张不并进来', !r.some(x=>x.stack), JSON.stringify(r.map(x=>x.stack)));
  r=groupImages([img('a'),img('b','user',{vision:'pending'})]);
  ok('还在识别的也不并', !r.some(x=>x.stack));
  r=groupImages([img('a'),img('b','user',{vision:'error'})]);
  ok('识别失败的也不并', !r.some(x=>x.stack));
  r=groupImages([img('a','user',{vision:'done'}),img('b','user',{vision:'done'})]);
  ok('识别完了的照常摞', r.length===1 && r[0].stack);

  r=groupImages([]);
  ok('空的不炸', r.length===0);

  ok('叠的 id 取的是第一张', groupImages([img('a'),img('b')])[0].id==='a');
  return R;
});
g.forEach(r=>ok(r.name,r.pass,r.extra));

// ---- 界面 ----
const ids = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const c=db.characters.create({name:'阿岚',persona:'x'});
  const chat=db.chats.create({characterIds:[c.id]});
  // 造五张真图
  const png=(hue)=>{
    const cv=document.createElement('canvas'); cv.width=60; cv.height=80;
    const g=cv.getContext('2d'); g.fillStyle=`hsl(${hue},60%,70%)`; g.fillRect(0,0,60,80);
    return new Promise(res=>cv.toBlob(res,'image/png'));
  };
  for (let i=0;i<5;i++) {
    const id=await db.images.put(await png(i*60));
    db.messages.create({chatId:chat.id,role:'user',authorId:'me',kind:'image',
      imageId:id,vision:'done',status:'done'});
  }
  db.messages.create({chatId:chat.id,role:'user',authorId:'me',kind:'text',content:'看这几张',status:'done'});
  return { chatId:chat.id, charId:c.id };
});
await page.evaluate(async ({chatId}) => {
  const nav=await import('/src/system/nav.js'); nav.openApp('chat',`/chat/${chatId}`);
}, ids);
await page.waitForTimeout(900);

ok('摞成了一叠', await page.locator('.stack-cards').count()===1, String(await page.locator('.stack-cards').count()));
ok('五张只占一叠的位置', await page.locator('.bubble-image').count()===0);
const more = await page.locator('.stack-more').innerText();
ok('按钮上写着几张', more.includes('展开 5'), more);
ok('背后露出两张边', await page.locator('.stack-card.is-back').count()===2,
  String(await page.locator('.stack-card.is-back').count()));
ok('那条文字消息照常显示', (await page.locator('.conv-body').innerText()).includes('看这几张'));
await page.screenshot({path:`${OUT}/stack-folded.png`});

// 点叠：换最上面那张
const nth = async () => (await page.locator('.stack-n').innerText());
ok('角标写着第几张', (await nth()).includes('5 / 5'), await nth());
await page.locator('.stack-cards').click();
await page.waitForTimeout(300);
ok('点一下换上一张', (await nth()).includes('4 / 5'), await nth());
await page.locator('.stack-cards').click();
await page.waitForTimeout(300);
ok('接着换', (await nth()).includes('3 / 5'), await nth());
for (let i=0;i<3;i++) { await page.locator('.stack-cards').click(); await page.waitForTimeout(200); }
ok('翻一圈回到最后一张', (await nth()).includes('5 / 5'), await nth());
ok('换来换去还是一叠', await page.locator('.stack-cards').count()===1);
await page.screenshot({path:`${OUT}/stack-cycle.png`});

await page.locator('.stack-more').click();
await page.waitForTimeout(500);
ok('展开就是平常的图片气泡', await page.locator('.bubble-image').count()===5,
  String(await page.locator('.bubble-image').count()));
ok('叠没有了', await page.locator('.stack-cards').count()===0);
const fold = await page.locator('.stack-fold').innerText();
ok('末尾挂着收起', fold.includes('收起这 5 张'), fold);
await page.screenshot({path:`${OUT}/stack-open.png`});

await page.locator('.stack-fold').click();
await page.waitForTimeout(500);
ok('收得回去', await page.locator('.stack-cards').count()===1);

// 选择模式下必须摊开，否则挑不出单张
await page.evaluate(async ({chatId}) => {
  const db=await import('/src/system/db/index.js');
  const m=db.messagesOf(chatId).find(x=>x.kind==='text');
  const el=document.getElementById(`msg-${m.id}`);
  el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}));
}, ids);
await page.waitForTimeout(500);
const sheet = await page.locator('.app-layer').innerText();
if (sheet.includes('多选')) {
  await page.locator('.sheet').getByText('多选').click();
  await page.waitForTimeout(500);
  ok('选择模式下摊开成单张', await page.locator('.bubble-image').count()===5,
    String(await page.locator('.bubble-image').count()));
  ok('选择模式下没有叠', await page.locator('.stack-cards').count()===0);
  await page.screenshot({path:`${OUT}/stack-select.png`});
} else {
  ok('选择模式下摊开成单张', false, '没找到多选入口：'+sheet.slice(0,200));
}

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
