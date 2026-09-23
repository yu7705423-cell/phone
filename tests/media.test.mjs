import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, permissions: ['microphone'] });
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

// 假接口：识图 / 转写 / 带语气的转写
await page.route('**/v1/chat/completions', async route => {
  const body = JSON.parse(route.request().postData() || '{}');
  const parts = body.messages?.at(-1)?.content;
  const hasImage = Array.isArray(parts) && parts.some(p => p.type === 'image_url');
  const hasAudio = Array.isArray(parts) && parts.some(p => p.type === 'input_audio');
  const audio = Array.isArray(parts) && parts.find(p => p.type === 'input_audio');
  const content = hasImage ? '一只橘猫趴在窗台上，外面在下雨。'
    : hasAudio ? JSON.stringify({ text: '我到家了', tone: '压着嗓子', emotion: '疲惫', pace: '语速偏慢', notes: '' })
    : '（意外的请求）';
  await route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content } }],
      _echo: { hasImage, hasAudio, fmt: audio?.input_audio?.format, b64len: (audio?.input_audio?.data || '').length } }) });
});
await page.route('**/v1/audio/transcriptions', async route => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: '我到家了' }) });
});

await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const R = [];
const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };

// --- wav 编码 ---
const wav = await page.evaluate(async () => {
  const audio = await import('/src/system/audio.js');
  // 造一段 0.5 秒 440Hz 的 wav 当输入，走一遍解码 + 重采样 + 再编码
  const rate = 44100, n = rate / 2;
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / rate * 440 * 2 * Math.PI) * 0x6000, true);
  const src = new Blob([buf], { type: 'audio/wav' });
  const out = await audio.toWav(src, 16000);
  const head = new DataView(await out.slice(0, 44).arrayBuffer());
  const tag = String.fromCharCode(...new Uint8Array(await out.slice(0, 4).arrayBuffer()));
  return { tag, channels: head.getUint16(22, true), rate: head.getUint32(24, true),
    bits: head.getUint16(34, true), bytes: out.size, type: out.type };
});
ok('转出来的是 wav', wav.tag === 'RIFF' && wav.type === 'audio/wav', JSON.stringify(wav));
ok('单声道 16 位', wav.channels === 1 && wav.bits === 16, JSON.stringify(wav));
ok('重采样到 16k', wav.rate === 16000, JSON.stringify(wav));
ok('长度合理（0.5 秒 ≈ 16KB）', wav.bytes > 14000 && wav.bytes < 20000, wav.bytes);

// --- 识图 ---
const vision = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const vision = await import('/src/system/ai/vision.js');
  const before = vision.isVisionReady();
  svc.setVision({ baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'gpt-4o-mini' });
  const after = vision.isVisionReady();
  // 造一张小图存进 images
  const c = document.createElement('canvas'); c.width = c.height = 8;
  c.getContext('2d').fillRect(0, 0, 8, 8);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const id = await db.images.put(new File([blob], 'x.png', { type: 'image/png' }));
  const got = await db.images.blob(id);
  const desc = await vision.describeImage(id, 'test');
  return { before, after, hasBlob: !!got, desc };
});
ok('没配时 isVisionReady 为假', vision.before === false);
ok('配好之后为真', vision.after === true);
ok('能从 images 取回原始 Blob', vision.hasBlob);
ok('识图返回描述', vision.desc === '一只橘猫趴在窗台上，外面在下雨。', vision.desc);

// --- 语音识别两档 ---
const asr = await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  const asr = await import('/src/system/ai/asr.js');
  const audio = await import('/src/system/audio.js');
  const rate = 16000, n = rate / 4;
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  const blob = new Blob([buf], { type: 'audio/wav' });

  const out = {};
  out.before = asr.isAsrReady();
  svc.setAsr({ baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'whisper-1', mode: 'text' });
  out.after = asr.isAsrReady();
  out.mode1 = asr.asrMode();
  out.text = await asr.listen({ blob, key: 't1' });

  svc.setAsr({ mode: 'tone', model: 'gpt-4o-audio-preview' });
  out.mode2 = asr.asrMode();
  out.tone = await asr.listen({ blob, key: 't2' });
  return out;
});
ok('没配时 isAsrReady 为假', asr.before === false);
ok('配好之后为真', asr.after === true);
ok('只转文字档', asr.mode1 === 'text' && asr.text.text === '我到家了' && asr.text.tone === '', JSON.stringify(asr.text));
ok('进阶档拿到文字', asr.mode2 === 'tone' && asr.tone.text === '我到家了', JSON.stringify(asr.tone));
ok('进阶档把语气合成一句', asr.tone.tone === '压着嗓子、疲惫、语速偏慢', asr.tone.tone);

await browser.close();
const bad = R.filter(r => !r.pass).length;
if (errs.length) { console.log('\n运行时报错:'); errs.forEach(e => console.log('  ' + e)); }
console.log(`\n${R.length - bad}/${R.length} 通过`);
process.exit(bad || errs.length ? 1 : 0);
