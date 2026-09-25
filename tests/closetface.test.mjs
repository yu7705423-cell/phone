// 衣服照片上的模特，脸不能跑到角色身上（ARCHITECTURE 4.215）。
//
//   识图：提示词写明照片可能是模特穿着的，只记衣服；回来的描述里提到人的句子不存
//   生图：今天穿的只接衣物描述，提到人的句子去掉，末尾一句钉死「脸按各人的外貌」
//   给角色看的今天穿的：同样只留衣物
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
const visionReqs = [];
let visionReply = '{}';
await page.route('https://vision.example.com/**', r => {
  visionReqs.push(r.request().postData() || '');
  return r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: visionReply } }] }) });
});
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);

// ---- 只留衣物的那几句 ----
const g = await ev(async () => {
  const cl = await import('/src/system/closet.js');
  return {
    zh: cl.garmentOnly('宽松的米白色粗针毛衣。模特身高 175，穿 M 码。长发披肩。袖口有罗纹。'),
    en: cl.garmentOnly('A cream knit sweater. Worn by a model with long hair. Ribbed cuffs with a smooth surface.'),
    keep: cl.garmentOnly('磨砂皮短靴，鞋面有细微磨痕'),
  };
});
ok('中文：提到模特、发型的句子去掉，衣服的留着', g.zh === '宽松的米白色粗针毛衣。袖口有罗纹。', g.zh);
ok('英文同样去掉；surface 这种词不误伤', g.en === 'A cream knit sweater. Ribbed cuffs with a smooth surface.', g.en);
ok('只写衣服的描述原样不动', g.keep === '磨砂皮短靴，鞋面有细微磨痕', g.keep);

// ---- 识图 ----
const id = await ev(async () => {
  const svc = await import('/src/system/ai/services.js');
  svc.setVision({ mode: 'api', baseUrl: 'https://vision.example.com/v1', apiKey: 'k', model: 'v' });
  const cl = await import('/src/system/closet.js');
  const c = document.createElement('canvas'); c.width = 20; c.height = 20;
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const [row] = await cl.addPhotos([new File([blob], 'a.png', { type: 'image/png' })]);
  return row.id;
});
visionReply = JSON.stringify({ group: 'top', sub: '衬衫', name: '白衬衫', desc: '棉质白衬衫，小翻领。模特是一位短发女性，面带微笑。' });
const rec = await ev(async id => {
  const t = await import('/src/system/ai/tasks/closet.js');
  await t.recognize(id);
  return (await import('/src/system/db/index.js')).db.closet.get(id);
}, id);
const vreq = visionReqs.join('\n');
ok('识图的提示词写明：照片可能是模特穿着的，只记衣服、不描述人', /worn by a model or placed on a mannequin/.test(vreq)
  && /never describe a face, hair, skin, body, pose or expression/.test(vreq), vreq.slice(0, 600));
ok('识图回来的描述里提到模特的句子不存', rec.desc === '棉质白衬衫，小翻领。', rec.desc);

// ---- 生图与上下文 ----
const out = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const cl = await import('/src/system/closet.js');
  const ip = await import('/src/system/ai/imageprompt.js');
  const ctx = await import('/src/system/ai/context/closet.js');
  const acc = await import('/src/system/accounts.js');
  const char = db.characters.create({ name: '阿岚', appearance: '黑色短发，左眼下有一颗泪痣' });
  // 用户自己写的描述里也混进了模特
  const coat = cl.create({ owner: char.id, group: 'outer', sub: '大衣', name: '驼色大衣',
    desc: '双排扣羊绒大衣。模特是金发女性，身高 180。' });
  cl.wear(coat.id, true);
  db.settings.set({ closetInImage: true });
  const img = ip.compose({ prompt: '阿岚站在书店门口', char });
  const block = ctx.build({ char, persona: acc.current(), messages: [], settings: db.settings.get() });
  return { img, block };
});
ok('生图：今天穿的只接衣物那一句', /阿岚 is wearing: 驼色大衣, 双排扣羊绒大衣。/.test(out.img) && !/金发|模特/.test(out.img), out.img);
ok('生图：末尾钉死「脸按各人的外貌，不是拍衣服的模特」', /never a model the garments were photographed on/.test(out.img), out.img);
ok('生图：角色自己的外貌照常在前面', /阿岚: 黑色短发，左眼下有一颗泪痣/.test(out.img), out.img);
ok('给角色看的今天穿的也只留衣物', /驼色大衣[^\n]*双排扣羊绒大衣/.test(out.block) && !/金发|模特/.test(out.block), out.block);

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
