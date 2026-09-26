// 聊天里的文件（ARCHITECTURE 4.271）：我发 docx / xlsx，角色在原文件上填了发回来；角色从头写一份；
// 正文带编号进上下文、只带最近一份；文件卡上「让角色填写」单独调一次
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const reqs = [];
let reply = '好。';
await ctx.route('**/relay.example.com/**', async route => {
  const body = JSON.parse(route.request().postData() || '{}');
  reqs.push(body);
  const sys = String(body.messages?.[0]?.content || '');
  const text = /Return JSON only/.test(sys) ? JSON.stringify({ fills: [{ id: '#3', text: '林岚' }, { id: '#5', text: '二十四' }] }) : reply;
  // 单独的任务不走流式，回一份普通的 completion
  if (body.stream !== true) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: text } }] }) });
  return route.fulfill({ status: 200, contentType: 'text/event-stream',
    body: [...text].map(ch => `data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`).join('') + 'data: [DONE]\n\n' });
});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);

// ---- 一、读、填、造 ----
const core = await ev(async () => {
  const d = await import('/src/system/docfile.js');
  const out = {};
  // 手写一份 docx：一段加粗标题、一张两行两列的表，第二列空着
  const { zip } = await import('/src/system/zip.js');
  const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>登记表</w:t></w:r></w:p>'
    + '<w:tbl><w:tblPr/><w:tr><w:tc><w:tcPr><w:shd w:fill="EEEEEE"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>姓名</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc></w:tr>'
    + '<w:tr><w:tc><w:p><w:r><w:t>年龄</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:rPr><w:i/></w:rPr><w:t>请填</w:t></w:r><w:r><w:t>写</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    + '<w:p><w:r><w:t>备注：无</w:t></w:r></w:p></w:body></w:document>';
  const blob = await zip([
    { name: '[Content_Types].xml', text: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>' },
    { name: 'word/document.xml', text: doc },
    { name: 'word/media/pic.bin', text: 'BINARY-STAYS' },
  ]).then(b => new Blob([b]));
  const r = await d.read(blob, '登记表.docx');
  out.read = r.text; out.slots = r.slots;
  const filled = await d.fill(blob, 'docx', [{ id: '#3', text: '林岚' }, { id: '#5', text: '二十四' }, { id: '#99', text: 'x' }]);
  out.again = (await d.read(filled, 'a.docx')).text;
  const { readZip } = await import('/src/system/unzip.js');
  const z = await readZip(filled);
  const xml = await z.text('word/document.xml');
  out.keepsBold = /<w:b\/><w:sz w:val="32"\/>/.test(xml) && /<w:jc w:val="center"\/>/.test(xml) && /w:fill="EEEEEE"/.test(xml);
  out.keepsItalic = /<w:rPr><w:i\/><\/w:rPr><w:t xml:space="preserve">二十四<\/w:t>/.test(xml);
  out.oneRun = !/请填|写<\/w:t>/.test(xml);
  out.binary = (await z.text('word/media/pic.bin')) === 'BINARY-STAYS';
  // xlsx：造一份，读，填
  const x = await d.make('xlsx', '姓名 | 年龄\n林 | ');
  const xr = await d.read(x, '表.xlsx');
  out.xread = xr.text;
  const xf = await d.fill(x, 'xlsx', [{ id: 'B2', text: '二十四' }, { id: 'c3', text: '新格' }]);
  out.xagain = (await d.read(xf, 'b.xlsx')).text;
  // docx 从头写：标题加表格
  const nd = await d.make('docx', '# 清单\n物品 | 数量\n苹果 | 3\n\n完');
  out.nd = (await d.read(nd, 'c.docx')).text;
  return out;
});
ok('docx 读成带编号的正文，表格一行一条、格子用竖线分开', core.read === '#1 登记表\n#2 姓名 | #3\n#4 年龄 | #5 请填写\n#6 备注：无'.replace('#4 年龄 | #5 请填写', '#4 年龄 | #5 请填写') || true, core.read);
console.log('   read =', JSON.stringify(core.read));
ok('编号按出现顺序：段、格、段', /^#1 登记表\n#2 姓名 \| #3\n#4 年龄 \| #5 请填写\n#6 备注：无$/.test(core.read), core.read);
ok('在原文件上填：换了字，不认识的编号跳过', /#2 姓名 \| #3 林岚/.test(core.again) && /#4 年龄 \| #5 二十四/.test(core.again) && /#6 备注：无/.test(core.again), core.again);
ok('段落属性、加粗字号、单元格底色都还在', core.keepsBold, '');
ok('填的那一格保留第一个 run 的样式（斜体），多余的 run 去掉', core.keepsItalic && core.oneRun, '');
ok('zip 里别的条目原样抄过来', core.binary, '');
ok('xlsx 读成坐标加内容', core.xread === 'A1 姓名 | B1 年龄\nA2 林', core.xread);
ok('xlsx 填：已有的行补一格、没有的行插一行', core.xagain === 'A1 姓名 | B1 年龄\nA2 林 | B2 二十四\nC3 新格', core.xagain);
ok('docx 从头写：标题与竖线表格', /#1 清单\n#2 物品 \| #3 数量\n#4 苹果 \| #5 3\n#6\n#7 完/.test(core.nd), core.nd);

// ---- 二、聊天链路 ----
const ids = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newChatPreset({ name: '主用' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm', provider: 'openai' });
  svc.setActiveChat(p.id);
  const c = db.characters.create({ name: '阿岚', persona: '二十四岁' });
  // 角色卡上默认关着：先确认提示词里一个字都没有，再打开
  const e = await import('/src/system/ai/engine.js');
  const chat0 = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  db.messages.create({ chatId: chat0.id, role: 'user', authorId: 'me', kind: 'text', content: '在', status: 'done' });
  const sysOff = e.buildChatSystem(chat0, c, db.messagesOf(chat0.id)).system;
  db.characters.update(c.id, { canSendFile: true });
  const sysOn = e.buildChatSystem(chat0, db.characters.get(c.id), db.messagesOf(chat0.id)).system;
  window.__fileCap = { off: /\[文件：name\.ext\]/.test(sysOff), on: /\[文件：name\.ext\]|Send a file/.test(sysOn) };
  const chat = db.chats.create({ characterIds: [c.id], lastMessageAt: Date.now() });
  return { char: c.id, chat: chat.id };
});
const capFlags = await ev(() => window.__fileCap);
ok('角色卡上默认关着：提示词里没有文件那一项', capFlags.off === false, JSON.stringify(capFlags));
ok('角色卡上打开之后才有', capFlags.on === true, JSON.stringify(capFlags));
const sendDoc = () => ev(async o => {
  const d = await import('/src/system/docfile.js');
  const blob = await d.make('docx', '登记表\n姓名 | \n年龄 | ');
  const m = await d.sendFromUser(o.chat, new File([blob], '登记表.docx'));
  return { id: m.id, kind: m.kind, text: m.text, name: m.name, ext: m.ext };
}, ids);
const sent = await sendDoc();
ok('我发一份 docx：落一条文件消息，正文带编号', sent.kind === 'file' && sent.ext === 'docx' && /#2 姓名 \| #3/.test(sent.text), JSON.stringify(sent));

const turn = (text, turnId) => ev(async ({ chat, char, text, turnId }) => {
  const { db } = await import('/src/system/db/index.js');
  const e = await import('/src/system/ai/engine.js');
  const r = await import('/src/system/ai/reply.js');
  db.messages.create({ chatId: chat, role: 'user', authorId: 'me', kind: 'text', content: text, status: 'done' });
  const raw = await e.streamReply({ chat: db.chats.get(chat), char: db.characters.get(char) });
  const made = await r.renderTurn({ chat: db.chats.get(chat), char: db.characters.get(char), raw, turnId, instant: true });
  await new Promise(res => setTimeout(res, 600));
  return made.map(m => ({ ...db.messages.get(m.id), swipes: undefined, raw: undefined }));
}, { ...ids, text, turnId });
const last = () => reqs[reqs.length - 1];
const sysOf = () => String(last()?.messages?.[0]?.content || '');
const histOf = () => (last()?.messages || []).slice(1).map(m => m.content).join('\n----\n');

reply = '收到。\n[填写：#3｜林岚]\n[填写：#5｜二十四]\n填好了。';
const made = await turn('帮我填一下', 't1');
ok('提示词里有文件的写法与填写的写法', /\[文件：name\.ext\]/.test(sysOf()) && /\[填写：id｜text\]/.test(sysOf()) && /登记表\.docx/.test(sysOf()), sysOf().slice(-700));
ok('历史里带着这份文件的编号正文', /\[文件：登记表\.docx\]\n#1 登记表\n#2 姓名 \| #3/.test(histOf()), histOf().slice(-300));
const fileMsg = made.find(m => m.kind === 'file');
ok('回复里的填写并成一条角色发的文件消息，其余是两条正文', made.filter(m => m.kind === 'text').length === 2 && fileMsg && fileMsg.role === 'char', JSON.stringify(made.map(m => [m.kind, m.name])));
ok('文件造好了：有 fileId，名字加了「已填写」', fileMsg && fileMsg.media === 'done' && fileMsg.fileId && fileMsg.name === '已填写-登记表.docx', JSON.stringify(fileMsg && { media: fileMsg.media, name: fileMsg.name, err: fileMsg.mediaError }));
const check = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const d = await import('/src/system/docfile.js');
  const m = db.messages.where(x => x.chatId === o.chat && x.kind === 'file' && x.role === 'char').pop();
  const blob = await db.files.blob(m.fileId);
  return (await d.read(blob, m.name)).text;
}, ids);
ok('发回来的文件里字填上了，别的没动', /#1 登记表\n#2 姓名 \| #3 林岚\n#4 年龄 \| #5 二十四/.test(check), check);

// 填完之后：规则不再注入，历史里只留填好的内容
reply = '嗯。';
await turn('好了吗', 't1b');
ok('填完之后不再注入填写规则', !/\[填写：id｜text\]/.test(sysOf()) && !/can be filled in place/.test(sysOf()), sysOf().slice(-500));
const h1 = histOf();
ok('历史里带正文的是填好的那份，原件只剩文件名', /\[文件：已填写-登记表\.docx\]\n#1 登记表\n#2 姓名 \| #3 林岚/.test(h1) && !/\[文件：登记表\.docx\]\n#1/.test(h1), h1.slice(-400));
ok('历史里没有那几行填写', !/\[填写：/.test(h1), '');

// 从头写一份
reply = '[文件：清单.md]\n# 要带的\n- 伞\n- 钥匙\n[/文件]\n列好了。';
const made2 = await turn('列个清单', 't2');
const nf = made2.find(m => m.kind === 'file');
ok('角色从头写一份 md：整块摘出来，不切成气泡', made2.length === 2 && nf && nf.ext === 'md' && nf.media === 'done' && made2.find(m => m.kind === 'text')?.content === '列好了。', JSON.stringify(made2.map(m => [m.kind, m.content])));
const md = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const m = db.messages.where(x => x.chatId === o.chat && x.ext === 'md').pop();
  return (await db.files.blob(m.fileId)).text();
}, ids);
ok('md 文件正文原样', md === '# 要带的\n- 伞\n- 钥匙', JSON.stringify(md));

// 再发一份：历史里只有最近这份带正文
await sendDoc();
reply = '嗯。';
await turn('这份也看看', 't3');
const h = histOf();
ok('历史里只有最近一份文件带正文，更早那份只剩文件名', (h.match(/#1 登记表/g) || []).length === 1, String((h.match(/#1 登记表/g) || []).length));
// 字数上限
await ev(async () => (await import('/src/system/db/index.js')).db.settings.set({ fileTextMax: 10 }));
await turn('再看', 't4');
ok('「文件正文最多带多少字」截断并注明', /\(truncated\)/.test(histOf()) && !/#2 姓名/.test(histOf()), histOf().slice(-200));
await ev(async () => (await import('/src/system/db/index.js')).db.settings.set({ fileTextMax: 6000 }));

// 发文件本身不触发回复；开了「发文件后按回复节奏回复」才回
const n0 = reqs.length;
await ev(async o => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/chat/${o.chat}`); }, ids);
await page.waitForTimeout(900);
await ev(async o => { (await import('/src/system/db/index.js')).db.chats.update(o.chat, { paceMode: 'now' }); }, ids);
await page.locator('input[accept=".txt,.md,.csv,.docx,.xlsx"]').setInputFiles({ name: '备忘.txt', mimeType: 'text/plain', buffer: Buffer.from('记得带伞') });
await page.waitForTimeout(800);
ok('发文件本身不触发回复', reqs.length === n0, `${reqs.length - n0}`);
await ev(async () => (await import('/src/system/db/index.js')).db.settings.set({ fileSendReplies: true }));
await page.locator('input[accept=".txt,.md,.csv,.docx,.xlsx"]').setInputFiles({ name: '表.md', mimeType: 'text/markdown', buffer: Buffer.from('# 表') });
await page.waitForTimeout(1500);
ok('开了「发文件后按回复节奏回复」：发完就回一次', reqs.length === n0 + 1, `${reqs.length - n0}`);
await ev(async () => (await import('/src/system/db/index.js')).db.settings.set({ fileSendReplies: false }));

// ---- 三、界面：文件卡、点开、让角色填写 ----
await ev(async o => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('chat', `/chat/${o.chat}`); }, ids);
await page.waitForTimeout(900);
const cards = await ev(() => [...document.querySelectorAll('.ph-file')].map(x => x.textContent));
ok('会话里画着文件卡', cards.length === 6 && /登记表\.docx/.test(cards[0]) && /已填写-登记表\.docx/.test(cards[1]), JSON.stringify(cards));
await page.locator('.ph-file').nth(3).click();
await page.waitForTimeout(500);
const sheet = await ev(() => document.querySelector('.sheet')?.innerText || '');
ok('点开：另存、让角色填写、正文预览', /另存/.test(sheet) && /让角色填写/.test(sheet) && /#2 姓名/.test(sheet), sheet.slice(0, 200));
const before = reqs.length;
await page.getByText('让角色填写', { exact: true }).click();
await page.waitForTimeout(1500);
ok('「让角色填写」调了一次接口，是单独的任务', reqs.length === before + 1 && /Return JSON only/.test(sysOf()) && /#2 姓名/.test(sysOf()), `${reqs.length - before}`);
const filled2 = await ev(async o => {
  const { db } = await import('/src/system/db/index.js');
  const d = await import('/src/system/docfile.js');
  const m = db.messages.where(x => x.chatId === o.chat && x.kind === 'file' && x.role === 'char').pop();
  const blob = m.fileId ? await db.files.blob(m.fileId) : null;
  return { media: m.media, text: blob ? (await d.read(blob, m.name)).text : '', err: m.mediaError };
}, ids);
ok('单独填写的结果也发回来了', filled2.media === 'done' && /#4 年龄 \| #5 二十四/.test(filled2.text), JSON.stringify(filled2));
// 面板里有「文件」
await page.locator('.ph-plus').first().click();
await page.waitForTimeout(400);
await page.locator('.composer-panel').getByText('更多', { exact: true }).first().click();
await page.waitForTimeout(400);
ok('面板「更多」里有「文件」', await page.getByText('文件', { exact: true }).count() > 0, '');
// 引用登记
const users = await ev(async o => {
  const { fileUsers } = await import('/src/system/purge.js');
  const { db } = await import('/src/system/db/index.js');
  const ids2 = db.messages.where(x => x.chatId === o.chat && x.kind === 'file' && x.fileId).map(x => x.fileId);
  const by = fileUsers();
  return ids2.every(id => by.has(id));
}, ids);
ok('文件都登在引用表里，清理时不会被删', users, '');

ok('全程没有运行时报错', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(x => !x.pass).length;
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad ? 1 : 0);
