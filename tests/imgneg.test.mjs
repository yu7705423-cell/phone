// 两件事：负面提示词被当成要画的内容；以及只有对话里才有的名字，生图那一步不认得
import { BASE, EXE, chromium, PNG_PATH } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const fs = await import('node:fs/promises');
const PNG = (await fs.readFile(PNG_PATH,'utf-8')).trim();
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const sent = [];
await page.route('**/images/generations', async route => {
  sent.push(JSON.parse(route.request().postData() || '{}'));
  await route.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ data:[{ b64_json: PNG }] }) });
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1800);

// ---- 认出那一整段负面提示词 ----
const found = await page.evaluate(async () => {
  const img = await import('/src/system/ai/image.js');
  const real = `real smartphone snapshot,\nauthentic camera roll photo,\n\nNegative\n\nselfie,\nmirror selfie,\nface close-up,\nportrait`;
  return {
    real: img.negativeBlock(real),
    cn: img.negativeBlock('画风写实\n负面提示词：\n低分辨率\n多手指'),
    colon: img.negativeBlock('a, b\nNegative prompt: \nlowres\nbad hands'),
    none: img.negativeBlock('soft light, film texture, no watermark'),
    inline: img.negativeBlock('avoid negative space in the composition'),
    empty: img.negativeBlock('a, b\nNegative\n'),
  };
});
ok('认出英文的 Negative 分段', found.real && found.real.lines === 4, JSON.stringify(found.real));
ok('认出中文的「负面提示词」', found.cn && found.cn.lines === 2, JSON.stringify(found.cn));
ok('带冒号的也认', found.colon && found.colon.lines === 2, JSON.stringify(found.colon));
ok('普通提示词不误报', found.none === null, JSON.stringify(found.none));
ok('句子里出现 negative 这个词不误报', found.inline === null, JSON.stringify(found.inline));
ok('后面没内容的不报', found.empty === null, JSON.stringify(found.empty));

// ---- 界面上要直说 ----
await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  db.settings.set({ imagePrompt: 'real smartphone snapshot,\nauthentic photo,\n\nNegative\n\nselfie,\nportrait,\nstudio lighting' });
  const p = svc.newImagePreset({ name:'中转' });
  svc.updateImagePreset(p.id, { baseUrl:'https://relay.example.com/v1',
    apiKey:'sk-x', model:'gpt-image-1' });
  const n = await import('/src/system/nav.js');
  n.unlock(); n.openApp('settings','/'); n.popToRoot(); n.push('/image');
});
await page.waitForTimeout(1000);
const pageText = await page.locator('.page-body').last().innerText();
ok('全局提示词里混了负面段落时，页面直接说出来',
  /要画的内容/.test(pageText), pageText.slice(0, 400));
ok('并数出后面还有几行', /还有 3 行/.test(pageText), pageText.slice(0, 400));

// ---- 负面提示词现在有自己的一栏，而且默认不发 ----
await page.locator('.list-item').filter({hasText:'中转'}).first().click();
await page.waitForTimeout(700);
const sheet = await page.locator('.sheet').innerText();
ok('OpenAI 兼容那一档也有「负面提示词」一栏', /负面提示词/.test(sheet), sheet.slice(0,300));
ok('并写明标准里没有这一项', /标准里没有这一项/.test(sheet), sheet.slice(0,400));
ok('有一个「这套接口认得 negative_prompt」的开关',
  /认得 negative_prompt/.test(sheet), sheet.slice(0,500));

const bodies = await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  const img = await import('/src/system/ai/image.js');
  const id = svc.activeImage().id;
  svc.updateImagePreset(id, { negative: 'lowres, bad hands' });
  await img.generate({ prompt: 'a cat', key: 'n1' });
  svc.updateImagePreset(id, { negOn: true });
  await img.generate({ prompt: 'a cat', key: 'n2' });
  return true;
});
ok('开关关着时，负面提示词一个字都不发',
  !('negative_prompt' in sent[sent.length - 2]), JSON.stringify(sent[sent.length - 2]));
ok('开关打开才发出去',
  sent[sent.length - 1].negative_prompt === 'lowres, bad hands',
  JSON.stringify(sent[sent.length - 1]));

// ---- 提示词骨架要告诉模型：生图那一步看不到对话 ----
const tpl = await page.evaluate(async () => {
  const t = await import('/src/system/ai/templates.js');
  return t.DEFAULT_TEMPLATES['skeleton.image'];
});
ok('骨架里写明生图是另一个模型、看不到这段对话',
  /does not receive this\s*conversation/.test(tpl), tpl);
ok('并说明只有这里才有的名字要改写成样子',
  /nickname/.test(tpl) && /what the thing looks like/.test(tpl), tpl);
ok('那一段仍然是客观规则，没有替角色做判断',
  !/should|prefer|avoid using|try to/i.test(tpl), tpl);

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
