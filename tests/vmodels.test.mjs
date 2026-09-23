// 「选择语音模型」不能去拉文本模型的那份列表
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// 假的 MiniMax：/v1/models 回的是它的文本模型，和真的一样
const hits = [];
await page.route('**/api.minimaxi.com/**', async route => {
  hits.push(route.request().url());
  return route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({
    data:[{id:'MiniMax-Text-01'},{id:'abab6.5s-chat'},{id:'MiniMax-M1'},{id:'abab5.5-chat'}] })});
});
await page.route('**/api.elevenlabs.io/**', async route => {
  hits.push(route.request().url());
  return route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify([
    { model_id:'eleven_multilingual_v2', name:'Eleven Multilingual v2', can_do_text_to_speech:true },
    { model_id:'eleven_flash_v2_5', name:'Eleven Flash v2.5', can_do_text_to_speech:true },
    { model_id:'scribe_v1', name:'Scribe v1', can_do_text_to_speech:false } ])});
});
await page.route('**/relay.example.com/**', async route => {
  hits.push(route.request().url());
  return route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ data:[
    {id:'gpt-4o'},{id:'tts-1'},{id:'tts-1-hd'},{id:'gpt-4o-mini-tts'},
    {id:'claude-opus-4'},{id:'text-embedding-3-small'},{id:'speech-02-hd'} ] })});
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1600);

// ---- 取列表这一层 ----
const got = await page.evaluate(async () => {
  const v = await import('/src/system/ai/voice.js');
  const out = {};
  out.mm = await v.fetchVoiceModels({ kind:'minimax', apiKey:'sk-x', baseUrl:'https://api.minimaxi.com' });
  out.el = await v.fetchVoiceModels({ kind:'eleven', apiKey:'xi-x', baseUrl:'https://api.elevenlabs.io' });
  out.oa = await v.fetchVoiceModels({ kind:'openai', apiKey:'sk-x', baseUrl:'https://relay.example.com/v1' });
  return out;
});
ok('MiniMax：给的是语音模型，不是文本模型',
  got.mm.list.every(m => /^speech-/.test(m)) && got.mm.list.length >= 6, JSON.stringify(got.mm.list));
ok('MiniMax：一个文本模型都没混进来',
  !got.mm.list.some(m => /text|abab|chat|M1/i.test(m)), JSON.stringify(got.mm.list));
ok('MiniMax：根本不发那次请求（它没有语音模型列表这个接口）',
  !hits.some(u => /minimaxi\.com/.test(u)), hits.join(' | '));
ok('MiniMax：界面要说清这份列表是内置的', got.mm.from === 'builtin', got.mm.from);

// 从前这一页用的是聊天那一套。留着这一条，说明「为什么不能用它」：
// 同一个地址问过去，回来的确实全是文本模型
const old = await page.evaluate(async () => {
  const m = await import('/src/system/ai/models.js');
  return m.fetchModels({ provider:'openai', baseUrl:'https://api.minimaxi.com', apiKey:'sk-x' });
});
ok('聊天那一套（fetchModels）问 MiniMax，回来的全是文本模型',
  old.length === 4 && !old.some(x => /^speech-/.test(x)), JSON.stringify(old));

ok('ElevenLabs：取的是 model_id，不是显示名',
  got.el.list.includes('eleven_multilingual_v2') && !got.el.list.some(m => /\s/.test(m)),
  JSON.stringify(got.el.list));
ok('ElevenLabs：不会说话的那个滤掉了',
  !got.el.list.includes('scribe_v1') && got.el.list.length === 2, JSON.stringify(got.el.list));

ok('OpenAI 兼容：只留像语音的那几条',
  got.oa.list.join(',') === 'tts-1,tts-1-hd,gpt-4o-mini-tts,speech-02-hd', got.oa.list.join(','));
ok('OpenAI 兼容：挑剩下的没丢，还留着全部', got.oa.all.length === 7, String(got.oa.all.length));

// ---- 界面这一层 ----
await page.evaluate(async () => {
  const svc = await import('/src/system/ai/services.js');
  svc.setVoice({ enabled:true, kind:'minimax', apiKey:'sk-x',
    baseUrl:'https://api.minimaxi.com', model:'' });
  const n = await import('/src/system/nav.js');
  n.unlock(); n.openApp('settings','/'); n.popToRoot(); n.push('/voice');
});
await page.waitForTimeout(900);
await page.locator('button').filter({hasText:'拉取并选择'}).first().click();
await page.waitForTimeout(700);
const sheet = await page.locator('.sheet').textContent().catch(()=>'');
ok('打开就有列表，不用先点一下「拉取列表」', /speech-02-hd/.test(sheet), sheet.slice(0,200));
ok('明确写出这份列表是内置的', /内置/.test(sheet), sheet.slice(0,200));
ok('列表里没有文本模型', !/MiniMax-Text|abab/.test(sheet), sheet.slice(0,300));
await page.screenshot({path:`${OUT}/vmodels.png`});

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
