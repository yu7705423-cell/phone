// 生图要进抓包，而且要标出最终那一串是由哪几段拼成的
import { BASE, EXE, chromium, PNG_PATH } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const fs = await import('node:fs/promises');
const PNG = (await fs.readFile(PNG_PATH,'utf-8')).trim();
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

await page.route('**/images/generations', r => r.fulfill({ status:200,
  contentType:'application/json', body: JSON.stringify({ data:[{ b64_json: PNG }] }) }));
await page.route('**/images/edits', r => r.fulfill({ status:500,
  contentType:'application/json', body: JSON.stringify({ error:{ message:'no such endpoint' } }) }));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1800);

const setup = await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  const db = await import('/src/system/db/index.js');
  const tr = await import('/src/system/ai/trace.js');
  tr.setOn(true); tr.clear();
  const p = svc.newImagePreset({ name:'我的中转' });
  svc.updateImagePreset(p.id, { baseUrl:'https://relay.example.com/v1',
    apiKey:'sk-x', model:'gpt-image-1', size:'1024x1024' });
  // 全局提示词里写一句，看它会不会被标出来
  db.settings.set({ imagePrompt: 'masterpiece, best quality' });
  const c = db.characters.create({ name:'阿岚', imagePrompt: 'long black hair, red coat' });
  return { cid: c.id };
});

const made = await page.evaluate(async ({cid}) => {
  const img = await import('/src/system/ai/image.js');
  const ip = await import('/src/system/ai/imageprompt.js');
  const db = await import('/src/system/db/index.js');
  const char = db.characters.get(cid);
  const args = { prompt: 'a girl standing by the window', char };
  const blob = await img.generate({ prompt: ip.compose(args), parts: ip.explain(args),
    key: 'img:t1' });
  return { size: blob.size, composed: ip.compose(args), explained: ip.explain(args) };
}, setup);
ok('图取回来了', made.size > 0, String(made.size));

ok('最终提示词把三段都拼上了',
  /a girl standing by the window/.test(made.composed)
  && /long black hair, red coat/.test(made.composed)
  && /masterpiece, best quality/.test(made.composed), made.composed);
ok('逐段标出来源', /【画面描述】/.test(made.explained)
  && /【这个角色的固定提示词】/.test(made.explained)
  && /【全局生图提示词】/.test(made.explained), made.explained);

const rows = await page.evaluate(async () => {
  const tr = await import('/src/system/ai/trace.js');
  return tr.list().map(r => ({ taskId: r.taskId, preset: r.preset, model: r.model,
    system: r.system, msgs: r.messages.map(m => ({ role: m.role, head: m.content.slice(0, 60) })),
    reply: r.reply, error: r.error }));
});
ok('生图进抓包了', rows.length >= 1, JSON.stringify(rows.length));
const row = rows[0];
ok('记的是生图这一项', row && row.taskId === '生图', JSON.stringify(row?.taskId));
ok('记下了接口名与模型',
  row && row.preset === '我的中转' && row.model === 'gpt-image-1', JSON.stringify(row));
ok('记下了端点、尺寸、返回格式',
  /images\/generations/.test(row.system) && /1024x1024/.test(row.system)
  && /返回格式/.test(row.system), row.system);
ok('明写这一次是不是带参考图', /纯文生图/.test(row.system), row.system);
ok('记下了最终发出去的提示词',
  row.msgs.some(m => m.role === '最终发出去的提示词'), JSON.stringify(row.msgs));
ok('也记下了它由哪几段拼成',
  row.msgs.some(m => m.role === '它由哪几段拼成' && /画面描述/.test(m.head)),
  JSON.stringify(row.msgs));
ok('成功那一条记了取回多少字节', /取回 \d+ 字节/.test(row.reply || ''), row.reply);

// 失败也要进抓包
const failed = await page.evaluate(async () => {
  const img = await import('/src/system/ai/image.js');
  try {
    await img.generateWithRef({ prompt: 'x', refBlob: new Blob([1]), key: 'img:t2' });
  } catch (e) { /* 预期失败 */ }
  const tr = await import('/src/system/ai/trace.js');
  const r = tr.list()[0];
  return { taskId: r.taskId, system: r.system, error: r.error };
});
ok('带参考图那一条单独标出来', /带参考图/.test(failed.taskId), failed.taskId);
ok('系统那一栏也写明这次带了参考图', /带了参考图/.test(failed.system), failed.system);
ok('失败也留下记录，并带上原因', /no such endpoint|500/.test(failed.error || ''), failed.error);

// 抓包那一页看得见
await page.evaluate(async () => {
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('settings','/'); n.popToRoot(); n.push('/trace');
});
await page.waitForTimeout(900);
const seen = await page.locator('.page-body').last().innerText();
ok('抓包页列得出生图这几条', /生图/.test(seen), seen.slice(0, 300));

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
