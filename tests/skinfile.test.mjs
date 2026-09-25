// 美化包导出成 TXT / DOCX、粘贴导入、作者署名（system/skinfile.js，ARCHITECTURE 4.239）
//
//   用户要求：「有的人是一键复制，json 的话会解析出问题」；导出时填作者名，填一次之后都自动后缀 by 作者名
//
//   一、导出页填作者、选 TXT：文件名与包里的名字带「by 作者」；库里那一份不改名；作者名记住，下次打开已填好
//   二、TXT 原样导回：尺寸、形状、生成器旋钮、自定义 CSS 一样不少
//   三、TXT 被聊天软件折行、加空格、前后多了字，粘贴导入照样读得出
//   四、DOCX 导出再导回，内容一样
//   五、JSON 被换成弯引号：粘贴导入照样读得出（从前直接报「不是有效的 JSON」）
//   六、同一个作者的后缀不叠加
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, OUT, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
await ctx.route('**/src/site.js*', async r => {
  const res = await r.fetch();
  r.fulfill({ response: res, body: (await res.text()).replace(/accounts:\s*'[^']*'/, "accounts: ''") });
});
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
await page.addInitScript(() => {
  window.__dl = [];
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { window.__dl.push(this.download); return orig.apply(this, arguments); };
});
await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(2000);

const CSS = '.ph-bubble { box-shadow: none; }\n.ph-msg-mine .ph-bubble::after { content: "喵"; }';
const id = await page.evaluate(async css => {
  const skin = await import('/src/system/skin.js');
  const row = skin.create({ name: '夜航', tokens: { bubbleR: 18 }, shape: 'soft', css, gen: { bubble: { mine: '#335577' } } });
  const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('skin', '/'); n.push(`/one/${row.id}`);
  return row.id;
}, CSS);
await page.waitForTimeout(700);

const openExport = async () => {
  await page.locator('.list-item').filter({ hasText: '导出美化包' }).first().click();
  await page.waitForTimeout(400);
};
const exportAs = async fmt => {
  await page.locator('.segmented .seg-item', { hasText: fmt }).click();
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
    page.locator('button:has-text("导出文件")').last().click(),
  ]);
  await page.waitForTimeout(300);
  return dl;
};

// ---- 一、填作者，导出 TXT ----
await openExport();
await page.locator('.field', { hasText: '作者' }).locator('input').fill('小雨');
await page.waitForTimeout(200);
ok('填了作者：页面上写明导出的名称', /夜航 by 小雨/.test(await page.locator('.sheet').innerText()));
const txtDl = await exportAs('TXT');
const names = await page.evaluate(() => window.__dl.slice());
ok('TXT：文件名带 by 作者', names[names.length - 1] === '美化-夜航 by 小雨.txt', JSON.stringify(names));
const txtPath = join(OUT, 'skinfile.txt');
await txtDl.saveAs(txtPath);
const txt = readFileSync(txtPath, 'utf8');
ok('TXT：开头写着名称与作者，正文是两行标记之间的编码', /Eira 美化包：夜航 by 小雨/.test(txt) && /作者：小雨/.test(txt)
  && /-----BEGIN EIRA SKIN-----\n[A-Za-z0-9+/=\n]+-----END EIRA SKIN-----/.test(txt) && !txt.includes('"kind"'), txt.slice(0, 300));
ok('库里那一份不改名', await page.evaluate(async id => (await import('/src/system/skin.js')).get(id).name, id) === '夜航');
ok('作者名记住了', await page.evaluate(async () => (await import('/src/system/db/index.js')).settings.get().skinAuthor) === '小雨');
await openExport();
ok('再次导出：作者已填好', await page.locator('.field', { hasText: '作者' }).locator('input').inputValue() === '小雨');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// ---- 二、TXT 导回 ----
const readBack = (text, via) => page.evaluate(async ([t, via]) => {
  const f = await import('/src/system/skinfile.js');
  const d = via === 'file' ? await f.readFile(new File([t], 'x.txt', { type: 'text/plain' })) : f.parse(t);
  return { name: d.name, author: d.author, r: d.tokens.bubbleR, shape: d.shape, css: d.css, mine: d.gen?.bubble?.mine };
}, [text, via]);
const back = await readBack(txt, 'file');
ok('TXT 原样导回：名字、作者、尺寸、形状、生成器、CSS 都在',
  back.name === '夜航 by 小雨' && back.author === '小雨' && back.r === 18 && back.shape === 'soft' && back.css === CSS && back.mine === '#335577',
  JSON.stringify(back));

// ---- 三、被转手改过的文字：粘贴导入 ----
const mangled = '朋友发来的：\n' + txt.split('\n').map(l => (/^[A-Za-z0-9+/=]{20,}$/.test(l) ? l.slice(0, 30) + '\n  ' + l.slice(30) + ' ' : l)).join('\r\n') + '\n以上';
const m = await readBack(mangled, 'paste');
ok('折行、加空格、前后多了字：照样读得出', m.css === CSS && m.r === 18, JSON.stringify(m));
// 界面：粘贴导入
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.popToRoot(); });
await page.waitForTimeout(500);
await page.locator('button:has-text("粘贴导入")').click();
await page.waitForTimeout(300);
await page.locator('textarea').last().fill(mangled);
await page.locator('button:has-text("导入")').last().click();
await page.waitForTimeout(500);
await page.locator('button:has-text("导入")').last().click();
await page.waitForTimeout(700);
const pasted = await page.evaluate(async () => (await import('/src/system/skin.js')).all().map(x => x.name));
ok('界面上粘贴导入：新建了一份', pasted.includes('夜航 by 小雨'), JSON.stringify(pasted));

// ---- 四、DOCX ----
await page.evaluate(async id => { const n = await import('/src/system/nav.js'); n.push(`/one/${id}`); }, id);
await page.waitForTimeout(600);
await openExport();
const docxDl = await exportAs('DOCX');
const n2 = await page.evaluate(() => window.__dl.slice());
ok('DOCX：文件名带 by 作者', n2[n2.length - 1] === '美化-夜航 by 小雨.docx', JSON.stringify(n2));
const docxPath = join(OUT, 'skinfile.docx');
await docxDl.saveAs(docxPath);
const b64 = readFileSync(docxPath).toString('base64');
const dx = await page.evaluate(async b64 => {
  const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const f = await import('/src/system/skinfile.js');
  const d = await f.readFile(new File([u], 'x.docx'));
  return { name: d.name, css: d.css, r: d.tokens.bubbleR };
}, b64);
ok('DOCX 导出再导回，内容一样', dx.name === '夜航 by 小雨' && dx.css === CSS && dx.r === 18, JSON.stringify(dx));
// 界面上选 docx 文件导入
await page.evaluate(async () => { const n = await import('/src/system/nav.js'); n.popToRoot(); });
await page.waitForTimeout(400);
await page.setInputFiles('input[type=file]', { name: 'a.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: readFileSync(docxPath) });
await page.waitForTimeout(700);
await page.locator('button:has-text("导入")').last().click();
await page.waitForTimeout(700);
const cnt = await page.evaluate(async () => (await import('/src/system/skin.js')).all().filter(x => x.name.startsWith('夜航 by 小雨')).length);
ok('界面上选 DOCX 文件导入：又新建一份（重名加后缀，不覆盖）', cnt === 2, cnt);

// ---- 五、弯引号 JSON ----
const curly = await page.evaluate(async css => {
  const skin = await import('/src/system/skin.js');
  const f = await import('/src/system/skinfile.js');
  const json = skin.pack({ name: '弯引号', tokens: { bubbleR: 7 }, shape: 'soft', css: '.ph-bubble{color:red}' });
  const bent = '看这个：' + json.replace(/"([^"]*)":/g, '“$1”:').replace(/: "([^"]*)"/g, ': “$1”');
  let strict = '';
  try { skin.unpack(bent); } catch (e) { strict = e.message; }
  const d = f.parse(bent);
  return { strict, name: d.name, r: d.tokens.bubbleR };
});
ok('JSON 被换成弯引号、前面多了字：照样读得出', curly.name === '弯引号' && curly.r === 7 && curly.strict, JSON.stringify(curly));

// ---- 六、后缀不叠加 ----
const sig = await page.evaluate(async () => {
  const f = await import('/src/system/skinfile.js');
  return [f.signed('夜航 by 小雨', '小雨'), f.signed('夜航', ''), f.signed('夜航 by 阿澈', '小雨')];
});
ok('同一个作者不叠加；没填作者不署名；改了别人的再导出，两位都署上', sig[0] === '夜航 by 小雨' && sig[1] === '夜航' && sig[2] === '夜航 by 阿澈 by 小雨', JSON.stringify(sig));

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const n = R.filter(x => !x.pass).length;
console.log(`\n${R.length - n}/${R.length} 通过`);
process.exit(n ? 1 : 0);
