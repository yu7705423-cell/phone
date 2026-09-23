// 语音的风格与语种：各家收的写法不一样，角色卡盖过全局。
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
const sent = [];
await page.route('**/*', async route => {
  const u = route.request().url();
  if (u.startsWith(BASE)) return route.continue();
  sent.push({ url: u, body: route.request().postData() });
  if (/t2a_v2/.test(u)) {
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ base_resp: { status_code: 0 }, data: { audio: '4944330300' } }) });
  }
  return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.from([0xff, 0xfb]) });
});
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ok = [], fail = [];
const check = (c, m) => (c ? ok : fail).push(m);
const last = re => [...sent].reverse().find(x => re.test(x.url));

const tbl = await page.evaluate(async () => {
  const voice = await import('/src/system/ai/voice.js');
  return {
    langs: voice.LANGS.length,
    zh: voice.langOf('zh'),
    byLabel: voice.langOf('粤语')?.mm,
    moodCn: (await import('/src/system/ai/voicescript.js')).mmEmotion('平静'),
    moodEn: (await import('/src/system/ai/voicescript.js')).mmEmotion('Happy'),
    moodNo: (await import('/src/system/ai/voicescript.js')).mmEmotion('语速偏慢，语气温和'),
  };
});
check(tbl.zh.mm === 'Chinese' && tbl.zh.iso === 'zh', `一个语种翻成各家的写法（${JSON.stringify(tbl.zh)}）`);
check(tbl.byLabel === 'Chinese,Yue', `按中文名也查得到（${tbl.byLabel}）`);
check(tbl.moodCn === 'calm' && tbl.moodEn === 'happy', `中英文的情绪词都认（${tbl.moodCn}/${tbl.moodEn}）`);
check(tbl.moodNo === '', '一段自由文本不是它认的情绪值，就不当情绪用');

// ---- MiniMax：语种走 language_boost，风格只收固定值 ----
await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  const voice = await import('/src/system/ai/voice.js');
  svc.setVoice({ enabled: true, kind: 'minimax', apiKey: 'k', model: 'm',
    lang: 'ja', prompt: '平静' });
  await voice.speak({ text: '喂', voiceId: 'v', key: 'a' });
});
let b = JSON.parse(last(/t2a_v2/).body);
check(b.language_boost === 'Japanese', `语种翻成了它认的名字（${b.language_boost}）`);
check(b.voice_setting.emotion === 'calm', `情绪送过去了（${b.voice_setting.emotion}）`);

await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  const voice = await import('/src/system/ai/voice.js');
  svc.setVoice({ prompt: '语速偏慢，语气温和', lang: 'Filipino' });
  await voice.speak({ text: '喂', voiceId: 'v', key: 'b' });
});
b = JSON.parse(last(/t2a_v2/).body);
check(!b.voice_setting.emotion, '它不认的风格文本就不发，免得整个请求被退回');
check(b.language_boost === 'Filipino', `表里没有的语种原样送（${b.language_boost}）`);

// ---- OpenAI：风格是自由文本，语种并进同一句 ----
await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  const voice = await import('/src/system/ai/voice.js');
  svc.setVoice({ kind: 'openai', apiKey: 'k', model: 'tts-1', baseUrl: '',
    prompt: '语速偏慢，语气温和', lang: 'ja' });
  await voice.speak({ text: '喂', voiceId: 'nova', key: 'c' });
});
b = JSON.parse(last(/audio\/speech/).body);
check(/语速偏慢/.test(b.instructions || ''), `自由文本进了 instructions（${b.instructions}）`);
check(/日语/.test(b.instructions || ''), '语种并进了同一句');

// ---- ElevenLabs：语种是 ISO 码，风格不支持 ----
await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  const voice = await import('/src/system/ai/voice.js');
  svc.setVoice({ kind: 'eleven', apiKey: 'k', model: '', baseUrl: '',
    prompt: '温柔一点', lang: 'ja' });
  await voice.speak({ text: '喂', voiceId: 'VID', key: 'd' });
});
b = JSON.parse(last(/text-to-speech/).body);
check(b.language_code === 'ja', `语种用 ISO 码（${b.language_code}）`);
check(!b.instructions, '这一家不支持风格，就不塞一个它不认的字段');

// ---- 角色卡盖过全局 ----
const merged = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const voice = await import('/src/system/ai/voice.js');
  svc.setVoice({ prompt: '全局的', lang: 'zh' });
  const a = db.characters.create({ name: '甲' });
  const b2 = db.characters.create({ name: '乙', voicePrompt: '自己的', voiceLang: 'en' });
  return { follow: voice.styleFor(db.characters.get(a.id)),
    own: voice.styleFor(db.characters.get(b2.id)) };
});
check(merged.follow.prompt === '全局的' && merged.follow.lang === 'zh',
  `角色卡没填就跟着全局（${JSON.stringify(merged.follow)}）`);
check(merged.own.prompt === '自己的' && merged.own.lang === 'en',
  `角色卡填了就盖过全局（${JSON.stringify(merged.own)}）`);

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 3).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
