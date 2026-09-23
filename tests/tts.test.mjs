// 语音三家、生图加 NovelAI。看的是「发出去的请求长什么样」。
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
const seen = [];
await page.route('**/*', async route => {
  const u = route.request().url();
  if (u.startsWith(BASE)) return route.continue();
  // 这一条专门用来演「根本连不上」
  if (/unreachable/.test(u)) return route.abort('connectionrefused');
  const req = route.request();
  seen.push({ url: u, headers: req.headers(), body: req.postData() });
  if (/t2a_v2/.test(u)) {
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ base_resp: { status_code: 0 }, data: { audio: '4944330300' } }) });
  }
  if (/generate-image/.test(u)) {
    // 一个最小的 zip，里面一张 a.png
    return route.fulfill({ status: 200, contentType: 'application/x-zip-compressed',
      body: Buffer.from(globalThis.__zip, 'base64') });
  }
  return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.from([0xff, 0xfb, 0x90]) });
});

// 现造一个 zip（store 方式，无压缩）
globalThis.__zip = await (async () => {
  const name = Buffer.from('a.png');
  const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
  const crcTable = [...Array(256)].map((_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let crc = 0xffffffff; for (const b of data) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8); crc = (crc ^ 0xffffffff) >>> 0;
  const u16 = n => Buffer.from([n & 255, (n >> 8) & 255]);
  const u32 = n => Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);
  const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]);
  const cen = Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(0), name]);
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(1), u16(1), u32(cen.length), u32(local.length), u16(0)]);
  return Buffer.concat([local, cen, end]).toString('base64');
})();

await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const ok = [], fail = [];
const check = (c, m) => (c ? ok : fail).push(m);

const r = await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  const voice = await import('/src/system/ai/voice.js');
  const out = {};

  // 新版 key、不填 GroupId，也该算配好了 —— 从前这里是 false
  svc.setVoice({ enabled: true, kind: 'minimax', apiKey: 'sk-cp-x', model: 'speech-01', groupId: '' });
  out.readyNoGroup = voice.isVoiceReady();
  out.base = voice.kindOf('minimax').base;
  await voice.speak({ text: '喂', voiceId: 'v1', key: 'a' });

  svc.setVoice({ kind: 'openai', apiKey: 'sk-o', model: 'tts-1', baseUrl: '' });
  out.readyOpenai = voice.isVoiceReady();
  await voice.speak({ text: '喂', voiceId: 'nova', key: 'b' });

  svc.setVoice({ kind: 'eleven', apiKey: 'el-1', model: '', baseUrl: '' });
  out.readyEleven = voice.isVoiceReady();   // 这一家模型可以空
  await voice.speak({ text: '喂', voiceId: 'VOICEID', key: 'c' });

  // 连不上要说得清楚
  svc.setVoice({ kind: 'openai', baseUrl: 'https://unreachable.example/v1' });
  let msg = '';
  try { await voice.speak({ text: '喂', key: 'd' }); } catch (e) { msg = e.message; }
  out.netMsg = msg;
  return out;
});

check(r.readyNoGroup, '不填 GroupId 也算配好了（从前这里卡死）');
check(r.base === 'https://api.minimaxi.com', `默认地址换成现在这个（${r.base}）`);
check(r.readyOpenai && r.readyEleven, 'OpenAI 兼容与 ElevenLabs 也判得出配好没有');
check(/连不上语音接口/.test(r.netMsg) && /跨域/.test(r.netMsg),
  `连不上时说得清楚（${(r.netMsg || '').slice(0, 40)}）`);

const mm = seen.find(x => /t2a_v2/.test(x.url));
check(mm && !/GroupId/.test(mm.url), `没填 GroupId 就不带那个参数（${mm && mm.url}）`);
check(mm && /api\.minimaxi\.com/.test(mm.url), 'MiniMax 打到新域名');
check(mm && /Bearer sk-cp-x/.test(mm.headers.authorization || ''), 'MiniMax 用 Bearer');

const oa = seen.find(x => /audio\/speech/.test(x.url));
check(oa && JSON.parse(oa.body).input === '喂' && JSON.parse(oa.body).voice === 'nova',
  `OpenAI 兼容走 /v1/audio/speech（${oa && oa.url}）`);

const el = seen.find(x => /text-to-speech/.test(x.url));
check(el && /VOICEID$/.test(el.url), `ElevenLabs 把音色放在路径里（${el && el.url}）`);
check(el && el.headers['xi-api-key'] === 'el-1', 'ElevenLabs 用 xi-api-key 而不是 Bearer');
check(el && !JSON.parse(el.body).model_id, '模型留空就不带 model_id');

// ---- NovelAI 生图 ----
const nai = await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  const img = await import('/src/system/ai/image.js');
  const p = svc.newImagePreset({ kind: 'nai', name: 'NAI' });
  svc.updateImagePreset(p.id, { apiKey: 'pst-token', model: 'nai-diffusion-3',
    size: '832x1216', negative: 'lowres' });
  svc.setActiveImage(p.id);
  const blob = await img.generate({ prompt: '1girl', key: 'n1' });
  return { size: blob.size, type: blob.type, ready: img.isImageReady() };
});
const ni = seen.find(x => /generate-image/.test(x.url));
check(!!ni && /image\.novelai\.net/.test(ni.url), `NovelAI 打到它自己的地址（${ni && ni.url}）`);
const nb = ni && JSON.parse(ni.body);
check(nb && nb.input === '1girl' && nb.action === 'generate' && nb.model === 'nai-diffusion-3',
  `body 是 input/model/action 那一套（${JSON.stringify(nb && { i: nb.input, a: nb.action })}）`);
check(nb && nb.parameters.width === 832 && nb.parameters.height === 1216,
  `尺寸拆成了宽高（${JSON.stringify(nb && nb.parameters && [nb.parameters.width, nb.parameters.height])}）`);
check(nb && nb.parameters.negative_prompt === 'lowres', '负面提示词带上了');
check(ni && /Bearer pst-token/.test(ni.headers.authorization || ''), '用持久 token 做 Bearer');
check(nai.size > 0 && nai.type === 'image/png', `从 zip 里把 png 取出来了（${nai.size}B ${nai.type}）`);

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errs.length) console.log('\n' + errs.slice(0, 3).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
