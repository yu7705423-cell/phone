// 掉翻译的另一半：历史里角色旧消息要带回 [译文：…]，末尾要有一句提醒，
// 设定区那段规则要有配对格式与结构示例。
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
let sent = null;
await page.route('**/*', async route => {
  const u = route.request().url();
  if (u.startsWith(BASE)) return route.continue();
  if (!u.includes('/v1/messages')) return route.abort();
  sent = JSON.parse(route.request().postData() || '{}');
  await route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ content: [{ type: 'text', text: '好\n[译文：ok]' }] }) });
});
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ok = [], fail = [];
const check = (c, m) => (c ? ok : fail).push(m);

const r = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const svc = await import('/src/system/ai/services.js');
  const eng = await import('/src/system/ai/engine.js');
  svc.newChatPreset({ name: 'T', provider: 'anthropic', apiKey: 'k', model: 'm' });
  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const c = db.characters.create({ name: '结衣', persona: '人设' });
  const chat = db.chats.create({ characterIds: [c.id], personaId: me.id, translateTo: '中文' });
  db.messages.create({ chatId: chat.id, role: 'user', kind: 'text', content: 'おはよう', status: 'done' });
  db.messages.create({ chatId: chat.id, role: 'char', authorId: c.id, kind: 'text',
    content: '起きた？', translation: '起来了吗', status: 'done' });
  db.messages.create({ chatId: chat.id, role: 'char', authorId: c.id, kind: 'text',
    content: '朝ごはん食べた', status: 'done' });
  db.messages.create({ chatId: chat.id, role: 'user', kind: 'text', content: 'まだ', status: 'done' });
  const msgs = db.messagesOf(chat.id);
  const sys = eng.buildChatSystem(chat, c, msgs, {}).system;
  const hist = eng.buildHistory(chat, c, msgs, { volatile: '' });
  const asst = hist.filter(m => m.role === 'assistant').map(m => m.content).join('\n---\n');
  const tail = hist.filter(m => m.role === 'system').map(m => m.content).join('\n');
  // 单独接口配上之后走 api 模式，历史里就不该再拼译文行
  svc.setTranslate({ mode: 'api', provider: 'openai', apiKey: 'k', model: 'm', baseUrl: 'https://x' });
  const mode2 = svc.translateMode();
  const hist2 = eng.buildHistory(chat, c, msgs, { volatile: '' });
  const asst2 = hist2.filter(m => m.role === 'assistant').map(m => m.content).join('\n');
  return { sys, asst, tail, mode2, asst2, order: hist.map(m => m.role).join(',') };
});

check(/\[顺带给出译文\]/.test(r.sys) && /pair of lines/.test(r.sys), '设定区里是配对格式的规则');
check(/<first message>\n\[译文：<first message in 中文>\]/.test(r.sys), '带结构示例，示例用占位符不定语言');
check(/count as one message/.test(r.sys), '写明一对算一条，不和三到五条那条打架');
check(/起きた？\n\[译文：起来了吗\]/.test(r.asst), `角色旧消息带回了译文行（${JSON.stringify(r.asst)}）`);
check(/朝ごはん食べた(?!\n\[译文)/.test(r.asst), '没译文的那条不硬造一行');
check(/\[译文提醒\]/.test(r.tail) && /in 中文/.test(r.tail), `末尾有一句提醒（${JSON.stringify(r.tail).slice(0, 80)}）`);
check(/system,user$/.test(r.order) || /system,user/.test(r.order), `提醒插在最后一条消息之前（${r.order}）`);
if (r.mode2 === 'api') {
  check(!/\[译文：/.test(r.asst2), '配了单独翻译接口就不拼译文行');
} else {
  ok.push(`（未能切到 api 模式：${r.mode2}，跳过那条）`);
}

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 5).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
