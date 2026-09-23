// 生图：发出去的请求长什么样，空提示词拦没拦住
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const seen=[];
await page.route('**/*', async r => {
  const u=r.request().url();
  if (/images\/(generations|edits)/.test(u)) {
    seen.push({ url:u, post:r.request().postData()||'' });
    return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[{b64_json:PNG}]})});
  }
  if (/chat\/completions/.test(u)) return r.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({choices:[{message:{content:'好'}}]})});
  if (u.startsWith(BASE)) return r.continue();
  return r.fulfill({status:200,contentType:'application/json',body:'{}'});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const out = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const svc=await import('/src/system/ai/services.js');
  const img=await import('/src/system/ai/image.js');
  const reply=await import('/src/system/ai/reply.js');
  const p=svc.newImagePreset({ kind:'relay', name:'测试' });
  svc.updateImagePreset(p.id, { baseUrl:`${BASE}/v1`,
    apiKey:'sk-test', model:'gpt-image-1', size:'1024x1024' });
  svc.setActiveImage(p.id);
  const at=()=>svc.imagePresets().find(x=>x.id===p.id);
  const R={ fmtDefault: at().respFormat, formats: img.FORMATS.map(f=>f.id) };

  try { await img.generate({ prompt:'一只猫', preset:at(), key:'t1' }); R.ok1=true; }
  catch(e){ R.err1=String(e.message||e); }

  svc.updateImagePreset(p.id, { respFormat:'b64_json' });
  try { await img.generate({ prompt:'一只狗', preset:at(), key:'t2' }); R.ok2=true; }
  catch(e){ R.err2=String(e.message||e); }
  svc.updateImagePreset(p.id, { respFormat:'' });

  try { await img.generate({ prompt:'  ', preset:at(), key:'t3' }); R.ok3=true; }
  catch(e){ R.err3=String(e.message||e); }
  try { await img.generate({ preset:at(), key:'t4' }); R.ok4=true; }
  catch(e){ R.err4=String(e.message||e); }

  // 会话里那条路：全局提示词非空，而这一条自己没有画面描述
  db.settings.set({ imagePrompt:'soft film grain, no watermark' });
  const c=db.characters.create({ name:'阿岚', imagePrompt:'silver hair' });
  const chat=db.chats.create({ charId:c.id, title:'阿岚' });
  const good=db.messages.create({ chatId:chat.id, authorId:c.id, role:'char',
    kind:'image', prompt:'窗边的猫', media:'pending' });
  const blank=db.messages.create({ chatId:chat.id, authorId:c.id, role:'char',
    kind:'image', prompt:'', media:'pending' });
  reply.regenMedia(good.id); reply.regenMedia(blank.id);
  await new Promise(r=>setTimeout(r,1200));
  R.good=db.messages.get(good.id).media;
  R.blank=db.messages.get(blank.id).media;
  R.blankErr=db.messages.get(blank.id).mediaError;
  return R;
});

ok('FORMATS 三档，默认那一档是空串', out.formats.join(',')==='' + ',b64_json,url', out.formats.join(','));
ok('新建的生图接口默认「自动」', out.fmtDefault==='', JSON.stringify(out.fmtDefault));
ok('正常提示词能画出来', out.ok1===true, out.err1);
const b0=seen[0]?.post||'';
ok('默认那一档不发 response_format', !!b0 && !b0.includes('response_format'), b0);
ok('发出去的 prompt 是原样那一句', JSON.parse(b0||'{}').prompt==='一只猫', b0);
ok('选了 base64 就把字段发出去', (seen[1]?.post||'').includes('"response_format":"b64_json"'), seen[1]?.post);
ok('空白提示词报错而不是发出去', /没有提示词/.test(out.err3||''), out.err3??out.ok3);
ok('没有 prompt 键也报同一句', /没有提示词/.test(out.err4||''), out.err4??out.ok4);
ok('发出去的请求没有一条是空提示词',
  seen.every(s=>String(JSON.parse(s.post||'{}').prompt||'').trim()),
  seen.map(s=>s.post).join(' | '));
ok('有描述的那条画成了', out.good==='done', out.good);
ok('没描述的那条落在报错上', out.blank==='error', out.blank);
ok('报错写明是没有提示词', /没有提示词/.test(out.blankErr||''), out.blankErr);
ok('画风提示词没把空描述撑成一次请求', seen.length===3, seen.length+'');

// 设置页上那个「返回格式」
await page.evaluate(async () => {
  const nav=await import('/src/system/nav.js');
  nav.goHome(); nav.openApp('settings','/'); nav.popToRoot(); nav.push('/image');
});
await page.waitForSelector('.page');
await page.waitForTimeout(400);
await page.locator('.list-item').filter({hasText:'测试'}).first().click();
await page.waitForTimeout(500);
const body=await page.locator('.sheet').innerText();
ok('接口设置里有「返回格式」', body.includes('返回格式'), body.slice(0,300));
ok('底下写清楚了这一档是做什么的', /gpt-image-1 一类只认这一档/.test(body), body.slice(0,400));
await page.locator('.sheet .seg-item').filter({hasText:'base64'}).first().click();
await page.waitForTimeout(400);
const desc=await page.locator('.sheet').innerText();
ok('换一档说明跟着换', /取不回来时选它/.test(desc), desc.slice(0,400));
ok('换的那一档存进去了',
  await page.evaluate(async()=>{const s=await import('/src/system/ai/services.js');
    return s.imagePresets().some(p=>p.respFormat==='b64_json');}));
await page.screenshot({path:`${OUT}/imggen.png`});

await browser.close();
const bad=R.filter(r=>!r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e=>console.log('  '+e)); }
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad||errs.length?1:0);
