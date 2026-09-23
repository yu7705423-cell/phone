// 健康一键生成：只收表里有的 id、覆盖前要问、界面按钮
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
let reply='{}';
await page.route('**/*', async r => {
  const u=r.request().url();
  if (/chat\/completions/.test(u)) return r.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({choices:[{message:{content:reply}}]})});
  if (u.startsWith(BASE)) return r.continue();
  return r.fulfill({status:200,contentType:'application/json',body:'{}'});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const ids = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const svc=await import('/src/system/ai/services.js');
  svc.newChatPreset({ name:'主', provider:'openai', baseUrl:`${BASE}/v1`,
    apiKey:'sk-t', model:'gpt-4o' });
  const c=db.characters.create({ name:'阿岚', persona:'夜里写稿，白天补觉' });
  return { charId:c.id };
});
const gen = async (json) => {
  reply = json;
  return page.evaluate(async ({charId}) => {
    const t=await import('/src/system/ai/tasks/health.js');
    const h=await import('/src/system/health.js');
    try { const row = await t.generateDay(charId);
      return { ok:true, row: { energy:row.energy, mood:row.mood, symptoms:row.symptoms,
        sleepMin:row.sleepMin, poops:row.poops, note:row.note, source:row.source } }; }
    catch(e){ return { ok:false, err:String(e.message||e) }; }
  }, ids);
};

// ---- 一、正常一份 ----
let g = await gen(JSON.stringify({ energy:'low', mood:'flat', symptoms:['sleepy','headache'],
  sleepMin:310, poops:[{at:'08:20',form:'b4'}], note:'昨晚三点才睡' }));
ok('生成成功', g.ok, g.err);
ok('精力、心情落对', g.row?.energy==='low' && g.row?.mood==='flat', JSON.stringify(g.row));
ok('症状落对', JSON.stringify(g.row?.symptoms)===JSON.stringify(['sleepy','headache']), JSON.stringify(g.row?.symptoms));
ok('睡眠分钟落对', g.row?.sleepMin===310, String(g.row?.sleepMin));
ok('排便那条落对', g.row?.poops?.[0]?.at==='08:20' && g.row?.poops?.[0]?.form==='b4', JSON.stringify(g.row?.poops));
ok('备注落对', g.row?.note==='昨晚三点才睡', g.row?.note);
ok('标出来是生成的', g.row?.source==='ai', g.row?.source);

// ---- 二、模型自己发明的 id 一律丢掉 ----
g = await gen(JSON.stringify({ energy:'tired', mood:'anxious', symptoms:['sleepy','emo','b8'],
  sleepMin:9999, poops:[{at:'25:99',form:'b9'},{at:'07:00',form:'b3'}], note:'x'.repeat(400) }));
ok('认不出的精力丢掉，不硬塞', g.row?.energy==='', JSON.stringify(g.row?.energy));
ok('认不出的心情丢掉', g.row?.mood==='', JSON.stringify(g.row?.mood));
ok('症状只留表里有的', JSON.stringify(g.row?.symptoms)===JSON.stringify(['sleepy']), JSON.stringify(g.row?.symptoms));
ok('睡眠钳在一天之内', g.row?.sleepMin===1440, String(g.row?.sleepMin));
ok('坏时间与坏形态各自清空，但那一条还在',
  g.row?.poops?.length===2 && g.row.poops[0].at==='' && g.row.poops[0].form===''
  && g.row.poops[1].at==='07:00' && g.row.poops[1].form==='b3', JSON.stringify(g.row?.poops));
ok('备注截到 200 字', g.row?.note?.length===200, String(g.row?.note?.length));

// ---- 三、空回复也不该崩 ----
g = await gen(JSON.stringify({}));
ok('模型什么都没给：不崩，落一份空的', g.ok===true && g.row?.energy==='', JSON.stringify(g));

// ---- 四、界面 ----
await page.evaluate(async ({charId}) => {
  const h=await import('/src/system/health.js');
  h.set(charId, h.dateKey(), { energy:'', mood:'', symptoms:[], sleepMin:0, poops:[], note:'', source:'manual' });
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('health','/'); n.popToRoot(); n.push(`/char/${charId}`);
}, ids);
await page.waitForSelector('.page'); await page.waitForTimeout(700);
let body = await page.locator('.page').innerText();
ok('空的时候按钮写「按人设生成今天」', /按人设生成今天/.test(body), body.slice(0,200));
ok('说明里提到可以一键生成', /一键生成/.test(body), body.slice(0,200));

reply = JSON.stringify({ energy:'mid', mood:'good', symptoms:[], sleepMin:420, poops:[], note:'还行' });
await page.locator('button:has-text("按人设生成今天")').click();
await page.waitForTimeout(1500);
body = await page.locator('.page').innerText();
ok('点完之后按钮变成「重新生成今天」', /重新生成今天/.test(body), body.slice(0,200));
ok('并标明这一份是生成的', /由模型按人设生成/.test(body), body.slice(0,300));
const after = await page.evaluate(async ({charId}) => {
  const h=await import('/src/system/health.js');
  return h.dayOf(charId, h.dateKey());
}, ids);
ok('界面这一路也真的落库了', after.energy==='mid' && after.note==='还行', JSON.stringify(after).slice(0,120));

// 已有内容时要先问一句
await page.locator('button:has-text("重新生成今天")').click();
await page.waitForTimeout(600);
const dlg = await page.locator('.modal, .sheet').innerText().catch(()=>'');
ok('已有内容时先问一句，并说明会覆盖手填的', /覆盖/.test(dlg) && /手动填写/.test(dlg), dlg.slice(0,200));
await page.screenshot({path:`${OUT}/healthgen.png`});
ok('全程没有运行时报错', errs.length===0, errs.join(' | '));

await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
