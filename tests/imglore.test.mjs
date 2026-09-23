// 生图世界书：只进生图提示词，不进对话。外加自定义尺寸
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const PNG='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';
let imgReq=[];
await page.route('**/*', async r => {
  const u=r.request().url();
  if (/images\/generations/.test(u)) { imgReq.push(JSON.parse(r.request().postData()||'{}'));
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[{b64_json:PNG}]})}); }
  if (u.startsWith(BASE)) return r.continue();
  return r.fulfill({status:200,contentType:'application/json',body:'{}'});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const ids = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const svc=await import('/src/system/ai/services.js');
  const p=svc.newImagePreset({ kind:'relay', name:'中转' });
  svc.updateImagePreset(p.id, { baseUrl:`${BASE}/v1`, apiKey:'sk-t', model:'gpt-image-1' });
  svc.setActiveImage(p.id);
  db.settings.set({ imagePrompt:'soft film grain' });
  // 一本普通世界书、一本生图世界书，都设成全局
  const chat = db.lorebooks.create({ name:'校园设定', global:true, entries:[
    { id:'e1', enabled:true, constant:false, keys:['天台'], content:'天台常年上锁。',
      part:'before', depth:0, priority:100, order:0, probability:100 }]});
  const img = db.lorebooks.create({ name:'画风', global:true, forImage:true, entries:[
    { id:'i1', enabled:true, constant:true, keys:[], content:'watercolor, muted palette',
      part:'before', depth:0, priority:100, order:0, probability:100 },
    { id:'i2', enabled:true, constant:false, keys:['天台'], content:'wide shot, overcast sky',
      part:'before', depth:0, priority:90, order:0, probability:100 },
    { id:'i3', enabled:true, constant:false, keys:['海边'], content:'should not appear',
      part:'before', depth:0, priority:90, order:0, probability:100 }]});
  const c=db.characters.create({ name:'阿岚', imagePrompt:'silver hair' });
  const chatRow=db.chats.create({ characterIds:[c.id], title:'阿岚' });
  return { chat:chat.id, img:img.id, charId:c.id, chatId:chatRow.id };
});

// ---- 一、生图那半 ----
const compose = (prompt) => page.evaluate(async ({prompt, charId}) => {
  const db=await import('/src/system/db/index.js');
  const ip=await import('/src/system/ai/imageprompt.js');
  return ip.compose({ prompt, char: db.characters.get(charId) });
}, { prompt, charId: ids.charId });

let got = await compose('阿岚站在天台上');
ok('常驻的生图条目拼进去了', /watercolor, muted palette/.test(got), got);
ok('关键词命中的也拼进去了', /wide shot, overcast sky/.test(got), got);
ok('没命中的不拼', !/should not appear/.test(got), got);
ok('普通世界书不进生图提示词', !/天台常年上锁/.test(got), got);
ok('画面描述仍然在最前面', got.startsWith('阿岚站在天台上'), got.slice(0,40));
ok('角色与全局提示词还在', /silver hair/.test(got) && /soft film grain/.test(got), got);
ok('生图世界书排在角色提示词之前',
  got.indexOf('watercolor') < got.indexOf('silver hair'), got);

got = await compose('阿岚在房间里');
ok('换个画面描述，只留常驻那条',
  /watercolor/.test(got) && !/wide shot/.test(got), got);

// ---- 二、对话那半 ----
const chatLore = await page.evaluate(async ({charId}) => {
  const db=await import('/src/system/db/index.js');
  const lore=await import('/src/system/ai/context/lorebook.js');
  const r = lore.activate(db.characters.get(charId), '我们去天台吧', 4000);
  return r.items.map(e => e.content);
}, ids);
ok('对话里命中普通世界书', chatLore.some(t=>/天台常年上锁/.test(t)), JSON.stringify(chatLore));
ok('对话里一条生图条目都不进',
  !chatLore.some(t=>/watercolor|wide shot/.test(t)), JSON.stringify(chatLore));

// ---- 三、真发出去的那一次 ----
await page.evaluate(async ({charId, chatId}) => {
  const db=await import('/src/system/db/index.js');
  const reply=await import('/src/system/ai/reply.js');
  const m=db.messages.create({ chatId, authorId:charId, role:'char', kind:'image',
    prompt:'阿岚站在天台上', media:'pending' });
  reply.regenMedia(m.id);
  for (let i=0;i<40 && db.messages.get(m.id).media==='pending'; i++) await new Promise(r=>setTimeout(r,100));
}, ids);
ok('真发出去的请求里带着生图世界书',
  /watercolor/.test(imgReq[0]?.prompt||'') && /wide shot/.test(imgReq[0]?.prompt||''),
  imgReq[0]?.prompt);
ok('真发出去的请求里没有对话世界书',
  !/天台常年上锁/.test(imgReq[0]?.prompt||''), imgReq[0]?.prompt);

// ---- 四、尺寸 ----
const sz = await page.evaluate(async () => {
  const img=await import('/src/system/ai/image.js');
  return { nai: img.sizesFor('nai').map(x=>x.value), oa: img.sizesFor('openai').map(x=>x.value),
    good: img.okSize('832x1216'), full: img.okSize('832×1216'), bad: img.okSize('大一点'),
    t1: img.sizeText('832x1216'), t2: img.sizeText(' 832 × 1216 '), t3: img.sizeText('大一点'),
    t4: img.sizeText('') };
});
ok('NAI 常用尺寸里有 832x1216', sz.nai.includes('832x1216'), JSON.stringify(sz.nai));
ok('NAI 那份和 OpenAI 那份不一样', sz.nai.join()!==sz.oa.join(), JSON.stringify(sz.oa));
ok('全角的 × 也认', sz.full===true && sz.t2==='832x1216', JSON.stringify(sz));
ok('认得出的规整成 宽x高', sz.t1==='832x1216' && sz.good===true);
ok('认不出的退回 1024x1024，不原样发出去', sz.bad===false && sz.t3==='1024x1024' && sz.t4==='1024x1024', JSON.stringify(sz));

imgReq=[];
await page.evaluate(async () => {
  const svc=await import('/src/system/ai/services.js');
  const img=await import('/src/system/ai/image.js');
  svc.updateImagePreset(svc.activeImage().id, { size:' 832 × 1216 ' });
  await img.generate({ prompt:'猫', preset:svc.activeImage(), key:'sz1' });
  svc.updateImagePreset(svc.activeImage().id, { size:'随便' });
  await img.generate({ prompt:'猫', preset:svc.activeImage(), key:'sz2' });
});
ok('自己填的尺寸发出去是规整过的', imgReq[0]?.size==='832x1216', imgReq[0]?.size);
ok('填错的不原样发', imgReq[1]?.size==='1024x1024', imgReq[1]?.size);

// ---- 五、界面 ----
await page.evaluate(async () => {
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('lorebook','/'); n.popToRoot();
});
await page.waitForSelector('.page'); await page.waitForTimeout(500);
const list = await page.locator('.page').innerText();
ok('列表里标出「只用于生图」', /只用于生图/.test(list), list.slice(0,300));
await page.locator('.list-item').filter({hasText:'画风'}).first().click();
await page.waitForTimeout(500);
const book = await page.locator('.page').innerText();
ok('书详情页的用途选在「生图」', /用途/.test(book)
  && (await page.locator('.seg-item.is-active').first().innerText()).trim() === '生图', book.slice(0,400));
ok('生图那种不显示「设定区」位置', !/设定区/.test(book), book.slice(0,500));
await page.locator('.list-item').filter({hasText:'watercolor'}).first().click();
await page.waitForTimeout(500);
const entry = await page.locator('.page').innerText();
ok('条目页不显示「所属部分」', !/所属部分/.test(entry), entry.slice(0,400));
ok('条目页不显示「注入深度」', !/注入深度/.test(entry), entry.slice(0,400));
ok('关键词说明改成按画面描述匹配', /按画面描述匹配/.test(entry), entry.slice(0,600));
ok('优先级说明不再提「注入预算」', !/注入预算/.test(entry) && /不设预算/.test(entry), entry.slice(0,900));
ok('常驻说明改成「每次生成图片时」', /每次生成图片时均拼入/.test(entry), entry.slice(0,900));
await page.screenshot({path:`${OUT}/imglore-entry.png`});

// 普通世界书仍然有那两项
await page.evaluate(async () => {
  const n=await import('/src/system/nav.js'); n.popToRoot();
});
await page.waitForTimeout(400);
await page.locator('.list-item').filter({hasText:'校园设定'}).first().click();
await page.waitForTimeout(400);
await page.locator('.list-item').filter({hasText:'天台常年上锁'}).first().click();
await page.waitForTimeout(500);
const normal = await page.locator('.page').innerText();
ok('普通世界书的条目仍然有「所属部分」', /所属部分/.test(normal), normal.slice(0,300));
ok('普通世界书的条目仍然有「注入深度」', /注入深度/.test(normal), normal.slice(0,300));
ok('普通世界书的优先级说明照旧', /注入预算不足时/.test(normal), normal.slice(0,900));

// 尺寸那一栏
await page.evaluate(async () => {
  const n=await import('/src/system/nav.js');
  n.goHome(); n.openApp('settings','/'); n.popToRoot(); n.push('/image');
});
await page.waitForSelector('.page'); await page.waitForTimeout(500);
await page.locator('.list-item').filter({hasText:'中转'}).first().click();
await page.waitForTimeout(600);
const sheet = page.locator('.sheet');
ok('尺寸那一栏有常用值可点', await sheet.locator('.chip').count()>=5,
  String(await sheet.locator('.chip').count()));
ok('也能自己填', await sheet.locator('input[placeholder="1024x1024"]').count()>0);
await sheet.locator('input[placeholder="1024x1024"]').fill('大一点');
await page.waitForTimeout(400);
ok('填错时当场说清楚', /无法识别/.test(await sheet.innerText()), (await sheet.innerText()).slice(0,400));
await sheet.locator('.chip').filter({hasText:'1024x1536'}).first().click();
await page.waitForTimeout(400);
ok('点一下常用值就填上了',
  await page.evaluate(async()=>{const s=await import('/src/system/ai/services.js');
    return s.activeImage().size==='1024x1536';}));
await page.screenshot({path:`${OUT}/imglore-size.png`});
// 换成 NovelAI，常用值跟着换
await sheet.locator('.seg-item').filter({hasText:'NovelAI'}).first().click();
await page.waitForTimeout(500);
ok('换成 NovelAI 之后列的是它的常用值', /832x1216/.test(await sheet.innerText()),
  (await sheet.innerText()).slice(0,500));
ok('并且说清楚 64 的倍数那条', /64 的倍数/.test(await sheet.innerText()));
ok('全程没有运行时报错', errs.length===0, errs.join(' | '));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
