// NPC 那一页直接打字新建：建完当场关联，关系方向不能反
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.route('**/chat/completions', r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const ids = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const c=db.characters.create({ name:'阿岚' });
  return { charId:c.id };
});
const open = async () => {
  await page.evaluate(async ({charId}) => {
    const n=await import('/src/system/nav.js');
    n.goHome(); n.openApp('contact','/'); n.popToRoot(); n.push(`/npc/${charId}`);
  }, ids);
  await page.waitForSelector('.page'); await page.waitForTimeout(600);
};
await open();
let body = await page.locator('.page').innerText();
ok('页面上有「直接新建一个人」', /直接新建一个人/.test(body), body.slice(0,300));
ok('并且说明不用出去再回来', /无需先到/.test(body), body.slice(0,400));
ok('原来那条改叫「关联已有的角色」', /关联已有的角色/.test(body), body.slice(0,400));

// ---- 填一个人 ----
await page.locator('.list-item').filter({hasText:'直接新建一个人'}).click();
await page.waitForTimeout(500);
let sheet = await page.locator('.sheet').innerText();
ok('表里问的是「在阿岚看来，这个人是」', /在 阿岚 看来，这个人是/.test(sheet), sheet.slice(0,300));
ok('反向那栏说明留空即相同', /留空则与上一栏相同/.test(sheet), sheet.slice(0,400));

// 姓名不填不让存
await page.locator('.sheet button:has-text("建好并关联")').click();
await page.waitForTimeout(500);
let toastTxt = await page.locator('.toast, .toast-item').innerText().catch(()=>'');
ok('不填姓名时拦住并说明', /请填写姓名/.test(toastTxt), toastTxt);

const fill = async (label, val) => {
  const f = page.locator('.sheet .field').filter({hasText:label}).first();
  await f.locator('input, textarea').first().fill(val);
};
await fill('姓名','林母');
await fill('在 阿岚 看来，这个人是','妈妈');
await fill('反过来','女儿');
await fill('一句话签名','话不多');
await fill('人设','退休教师，住在老城区');
await page.locator('.sheet button:has-text("建好并关联")').click();
await page.waitForTimeout(800);

const made = await page.evaluate(async ({charId}) => {
  const db=await import('/src/system/db/index.js');
  const card=await import('/src/system/ai/tasks/card.js');
  const npc = db.characters.all().find(c => c.name==='林母');
  const rels = card.relationsOf(charId);
  return {
    npc: npc && { name:npc.name, isNpc:npc.isNpc, signature:npc.signature, persona:npc.persona },
    // 主角身上记的：这个人在主角眼里是什么
    onChar: rels.find(r => r.charId===npc?.id)?.label,
    // 对方身上记的：主角在对方眼里是什么
    onNpc: (npc?.relations||[]).find(r => r.charId===charId)?.label,
  };
}, ids);
ok('人建出来了', made.npc?.name==='林母', JSON.stringify(made.npc));
ok('标成了 NPC', made.npc?.isNpc===true, String(made.npc?.isNpc));
ok('签名与人设都存下了',
  made.npc?.signature==='话不多' && /退休教师/.test(made.npc?.persona||''), JSON.stringify(made.npc));
ok('主角这边记的是「妈妈」（方向没反）', made.onChar==='妈妈', JSON.stringify(made));
ok('对方那边记的是「女儿」', made.onNpc==='女儿', JSON.stringify(made));

await page.waitForTimeout(400);
body = await page.locator('.page').innerText();
ok('列表里当场就看得到', /林母/.test(body) && /妈妈/.test(body), body.slice(0,300));

// ---- 反向留空则沿用正向 ----
await page.locator('.list-item').filter({hasText:'直接新建一个人'}).click();
await page.waitForTimeout(500);
await fill('姓名','老周');
await fill('在 阿岚 看来，这个人是','邻居');
await page.locator('.sheet button:has-text("建好并关联")').click();
await page.waitForTimeout(800);
const sym = await page.evaluate(async ({charId}) => {
  const db=await import('/src/system/db/index.js');
  const card=await import('/src/system/ai/tasks/card.js');
  const npc = db.characters.all().find(c => c.name==='老周');
  return { onChar: card.relationsOf(charId).find(r=>r.charId===npc.id)?.label,
    onNpc: (npc.relations||[]).find(r=>r.charId===charId)?.label };
}, ids);
ok('反向留空时两边都是「邻居」', sym.onChar==='邻居' && sym.onNpc==='邻居', JSON.stringify(sym));

// ---- 建出来的人能单独存在（和批量生成那批同一种东西）----
const standalone = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const npc = db.characters.all().find(c=>c.name==='林母');
  return { canVoice: npc.canSendVoice, lore: Array.isArray(npc.lorebookIds) };
});
ok('默认字段和批量生成那批一致', standalone.canVoice===true && standalone.lore, JSON.stringify(standalone));
await page.screenshot({path:`${OUT}/npcnew.png`});
ok('全程没有运行时报错', errs.length===0, errs.join(' | '));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
