// 负面那一段要真的从正向里摘出来；以及「对面在要一张输入图」要认得出来
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
let mode = 'ok';
await page.route('**/images/generations', async route => {
  sent.push(JSON.parse(route.request().postData() || '{}'));
  if (mode === 'wants') {
    return route.fulfill({ status:400, contentType:'application/json', body: JSON.stringify({
      error: { message: 'upstream generation failed: HTTP 400: 我这边需要先确认可用的图像目标才能继续处理。请上传你希望参考或编辑的图片后，我可以根据你的描述生成对应效果。' } }) });
  }
  return route.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ data:[{ b64_json: PNG }] }) });
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1800);

const GLOBAL = `Positive

real smartphone snapshot,
authentic camera roll photo,

Negative

selfie,
portrait,
Ghibli style`;

const setup = await page.evaluate(async ([g]) => {
  const svc = await import('/src/system/ai/services.js');
  const db = await import('/src/system/db/index.js');
  db.settings.set({ imagePrompt: g });
  const c = db.characters.create({ name:'阿岚', imagePrompt: 'warm light\n\nNegative\nlowres' });
  const p = svc.newImagePreset({ name:'中转' });
  svc.updateImagePreset(p.id, { baseUrl:'https://relay.example.com/v1',
    apiKey:'sk-x', model:'gpt-image-1', negative: 'watermark' });
  return { cid: c.id, pid: p.id };
}, [GLOBAL]);

// ---- 切分 ----
const split = await page.evaluate(async ({cid}) => {
  const ip = await import('/src/system/ai/imageprompt.js');
  const db = await import('/src/system/db/index.js');
  const char = db.characters.get(cid);
  const args = { prompt: '卧室，床头灯亮着', char };
  return { pos: ip.compose(args), neg: ip.negativeOf(args), why: ip.explain(args),
    one: ip.cut('a, b\n\nNegative\n\nc, d'),
    none: ip.cut('just a prompt') };
}, setup);

ok('正向里不再有 Negative 那几行',
  !/selfie/.test(split.pos) && !/Ghibli/.test(split.pos) && !/lowres/.test(split.pos),
  split.pos);
ok('正向里也不留「Negative」「Positive」那两行本身',
  !/\bNegative\b/.test(split.pos), split.pos);
ok('该留的都留着',
  /卧室，床头灯亮着/.test(split.pos) && /real smartphone snapshot/.test(split.pos)
  && /warm light/.test(split.pos), split.pos);
ok('摘出来的负面收在一起',
  /selfie/.test(split.neg) && /Ghibli style/.test(split.neg) && /lowres/.test(split.neg),
  split.neg);
ok('抓包里标明这几段是从正向里摘出来的',
  /已从正向里摘出来/.test(split.why), split.why.slice(0, 400));
ok('单段切分：前后各归各位',
  split.one.pos === 'a, b' && split.one.neg === 'c, d', JSON.stringify(split.one));
ok('没有负面段落时原样不动',
  split.none.pos === 'just a prompt' && split.none.neg === '', JSON.stringify(split.none));

// ---- 真的发出去时的样子 ----
const bodies = await page.evaluate(async ({cid, pid}) => {
  const svc = await import('/src/system/ai/services.js');
  const img = await import('/src/system/ai/image.js');
  const ip = await import('/src/system/ai/imageprompt.js');
  const db = await import('/src/system/db/index.js');
  const char = db.characters.get(cid);
  const args = { prompt: '卧室', char };
  await img.generate({ prompt: ip.compose(args), negative: ip.negativeOf(args), key: 'a' });
  svc.updateImagePreset(pid, { negOn: true });
  await img.generate({ prompt: ip.compose(args), negative: ip.negativeOf(args), key: 'b' });
  return true;
}, setup);
const off = sent[sent.length - 2];
const on = sent[sent.length - 1];
ok('开关关着时：负面一个字都不发，正向里也没有它们',
  !('negative_prompt' in off) && !/selfie/.test(off.prompt), JSON.stringify(off).slice(0,200));
ok('开关打开时：负面单独成一个字段',
  /selfie/.test(on.negative_prompt || '') && !/selfie/.test(on.prompt),
  JSON.stringify(on).slice(0,240));
ok('接口自己那一栏也并进去了', /watermark/.test(on.negative_prompt || ''), on.negative_prompt);

// ---- 对面在要一张输入图 ----
mode = 'wants';
const wants = await page.evaluate(async () => {
  const img = await import('/src/system/ai/image.js');
  try { await img.generate({ prompt: 'x', key: 'w' }); return { okk: true }; }
  catch (e) { return { okk: false, err: String(e.message || e) }; }
});
ok('原话照样带出来',
  /请上传你希望参考或编辑的图片/.test(wants.err), wants.err.slice(0,200));
ok('并且点破这是那个模型不做纯文生图',
  /只做图像编辑/.test(wants.err) && /换一个真正的生图模型/.test(wants.err), wants.err);

const rep = await page.evaluate(async () => {
  const img = await import('/src/system/ai/image.js');
  return img.testImage();
});
ok('自检把它单独列成一档', rep.step === '这个模型不做纯文生图', JSON.stringify(rep).slice(0,240));
ok('自检也给出下一步', /gpt-image-1|dall-e-3/.test(rep.hint || ''), rep.hint);

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
