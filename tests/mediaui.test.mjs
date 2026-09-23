import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true,
  deviceScaleFactor: 2, permissions: ['microphone'] });
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

await page.route('**/v1/chat/completions', async route => {
  const body = JSON.parse(route.request().postData() || '{}');
  const parts = body.messages?.at(-1)?.content;
  const hasImage = Array.isArray(parts) && parts.some(p => p.type === 'image_url');
  const hasAudio = Array.isArray(parts) && parts.some(p => p.type === 'input_audio');
  const content = hasImage ? '一只橘猫趴在窗台上，外面在下雨。'
    : hasAudio ? JSON.stringify({ text: '我到家了', tone: '压着嗓子', emotion: '疲惫', pace: '语速偏慢' })
    : 'x';
  await route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content } }] }) });
});

await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const R = [];
const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const svc = await import('/src/system/ai/services.js');
  const nav = await import('/src/system/nav.js');
  const me = acc.roots()[0] || acc.createRoot({ name: '小明' });
  const char = db.characters.create({ name: '阿岚', persona: 'x' });
  const chat = db.chats.create({ characterIds: [char.id], personaId: me.id, lastMessageAt: Date.now() });
  db.messages.create({ chatId: chat.id, role: 'user', authorId: 'me', kind: 'text', content: '你看', status: 'done' });
  svc.setVision({ mode: 'api', baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'gpt-4o-mini' });
  svc.setAsr({ baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'gpt-4o-audio-preview', mode: 'tone' });
  nav.goHome(); nav.openApp('chat', `/chat/${chat.id}`);
  return { chat: chat.id, char: char.id };
});
await page.waitForTimeout(600);

// --- 发图片 ---
await page.locator('.composer-side').first().click();
await page.waitForTimeout(350);
ok('小菜单打开了', await page.locator('.panel-grid').count() === 1);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAABlklEQVR4nBXR4RiFMQiG4Q9hCEMIYQghhDCEEIbwIIQQQgghDOHs9Lu7662+72N8zA/5WB/6YR/7wz/OBx/xkR/10R/34/sGYzAHMlgDHdhgD3xwBgxikIMa9OCOByZjMicyWROd2GRPfHImTGKSk5r05M4HhCFMQYQlqGDCFlw4AkIIKZTQwpUHFmMxF7JYC13YYi98cRYsYpGLWvTirgeUoUxFlKWoYspWXDkKSiiplNLK1QeMYUxDjGWoYcY23DgGRhhplNHGtQc2YzM3slkb3dhmb3xzNmxik5va9ObuB5zhTEec5ahjznbcOQ5OOOmU0871Bw7jMA9yWAc92GEf/HAOHOKQhzr04Z4H/s95534HfCd5S77YL8gb/Zr/FZBQ0HDf679gBDOQYAUaWLADD0782yPIoIIObjyQjGQmkqxEE0t24snJ//BIMqmkk5sPFKOYhRSr0MKKXXhx6h8liiyq6OLWA81oZiPNarSxZjfenP4Hjyabarq5/cBlXOZFLuuiF7vsi1/O/a8Zl7zUpS/38gNq4ZAQG74ASAAAAABJRU5ErkJggg==', 'base64');
await page.locator('input[type=file][accept="image/*"]').setInputFiles({ name: 'cat.png', mimeType: 'image/png', buffer: png });
await page.waitForTimeout(1200);
ok('气泡里出现了图片', await page.locator('.bubble-image img').count() === 1);
let msg = await page.evaluate(async id => {
  const db = await import('/src/system/db/index.js');
  const l = db.messagesOf(id); return l[l.length - 1];
}, ids.chat);
ok('存成了用户发的图片消息', msg.kind === 'image' && msg.role === 'user' && !!msg.imageId, JSON.stringify(msg).slice(0,120));
ok('识图结果写回 content', msg.content === '[图片：一只橘猫趴在窗台上，外面在下雨。]', msg.content);
ok('vision 标记为 done', msg.vision === 'done', msg.vision);

// --- 未配置识图时的提示 ---
await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  svc.setVision({ apiKey: '', model: '' });
});
await page.locator('.composer-side').first().click();
await page.waitForTimeout(300);
await page.locator('input[type=file][accept="image/*"]').setInputFiles({ name: 'b.png', mimeType: 'image/png', buffer: png });
await page.waitForTimeout(800);
const offMsg = await page.evaluate(async id => {
  const db = await import('/src/system/db/index.js');
  const l = db.messagesOf(id); return l[l.length - 1];
}, ids.chat);
ok('没配识图仍然能发出去', offMsg.kind === 'image' && offMsg.vision === 'off', offMsg.vision);
ok('界面上说明了角色看不到', (await page.locator('.media-note').innerText()).includes('看不到'),
  await page.locator('.media-note').innerText().catch(() => '(无)'));

// --- 录语音 ---
await page.locator('.composer-side').first().click();
await page.waitForTimeout(300);
await page.getByText('语音', { exact: true }).click();
await page.waitForTimeout(1600);
ok('出现录音条', await page.locator('.rec-live').count() === 1);
ok('计时在走', /00:0[1-9]/.test(await page.locator('.rec-live').innerText()), await page.locator('.rec-live').innerText());
await page.locator('.select-bar').getByText('发送').click();
await page.waitForTimeout(2500);
ok('气泡里出现了语音', await page.locator('.bubble-voice').count() === 1);
const vmsg = await page.evaluate(async id => {
  const db = await import('/src/system/db/index.js');
  const l = db.messagesOf(id); return l[l.length - 1];
}, ids.chat);
ok('存成了用户发的语音消息', vmsg.kind === 'voice' && vmsg.role === 'user' && !!vmsg.audioId, JSON.stringify(vmsg).slice(0,140));
ok('转写与语气写回 content',
  vmsg.content === '[语音：我到家了]（听起来压着嗓子、疲惫、语速偏慢）', vmsg.content);
ok('记下了真实时长', vmsg.seconds >= 1, vmsg.seconds);
await page.screenshot({ path: `${OUT}/m1-chat.png` });

// --- 取消录音不留痕 ---
const beforeN = await page.locator('.msg').count();
await page.locator('.composer-side').first().click();
await page.waitForTimeout(300);
await page.getByText('语音', { exact: true }).click();
await page.waitForTimeout(900);
await page.locator('.select-bar').getByText('取消').click();
await page.waitForTimeout(500);
ok('取消后回到输入框', await page.locator('.composer-bar').count() === 1 && await page.locator('.rec-live').count() === 0);
ok('取消不产生消息', await page.locator('.msg').count() === beforeN, await page.locator('.msg').count());

// --- 进上下文 ---
const hist = await page.evaluate(async id => {
  const db = await import('/src/system/db/index.js');
  const engine = await import('/src/system/ai/engine.js');
  const chat = db.chats.get(id);
  const char = db.characters.get(chat.characterIds[0]);
  return engine.buildHistory(chat, char, db.messagesOf(id)).map(h => h.content).join(' || ');
}, ids.chat);
ok('图片描述进了上下文', hist.includes('橘猫'), hist);
ok('语音转写与语气进了上下文', hist.includes('我到家了') && hist.includes('压着嗓子'), hist);

// --- 编辑用户语音只改文字，不重新合成 ---
const edited = await page.evaluate(async id => {
  const db = await import('/src/system/db/index.js');
  const l = db.messagesOf(id);
  const v = l.filter(m => m.kind === 'voice')[0];
  const before = v.audioId;
  db.messages.update(v.id, { voiceText: '我刚到家', content: '[语音：我刚到家]（听起来压着嗓子、疲惫、语速偏慢）' });
  return { same: db.messages.get(v.id).audioId === before, content: db.messages.get(v.id).content };
}, ids.chat);
ok('改转写不动音频本身', edited.same, JSON.stringify(edited));

await browser.close();
const bad = R.filter(r => !r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e => console.log('  ' + e)); }
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad || errs.length ? 1 : 0);
