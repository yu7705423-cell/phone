// 旧外壳的超时不能报成「连不上」，而且自检通过时就要提醒它 120 秒一律掐断
import { BASE, EXE, chromium, PNG_PATH } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const fs = await import('node:fs/promises');
const PNG = (await fs.readFile(PNG_PATH,'utf-8')).trim();
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// 两只外壳：旧的 phoneNet = true 且超时只回一句系统文案；新的带能力表与 timedOut
async function shell({ old, slow }) {
  const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});
  await ctx.addInitScript(({ old, slow, PNG }) => {
    window.phoneNotify = true; window.phoneKeepAlive = true;
    window.phoneNet = old ? true : { timeout: true };
    window.__sent = [];
    window.webkit = { messageHandlers: {
      net: { postMessage: async m => {
        window.__sent.push({ url: m.url, timeout: m.timeout });
        if (slow) return old ? { error: '请求超时' }
          : { error: 'The request timed out.', timedOut: true, seconds: m.timeout || 300 };
        return { status:200, headers:{'content-type':'application/json'},
          body: btoa(JSON.stringify({ data:[{ b64_json: PNG }] })) };
      } },
      notify: { postMessage: async () => ({ permission:'granted' }) },
    } };
  }, { old, slow, PNG });
  const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
  const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1500);
  const out = await page.evaluate(async () => {
    const svc=await import('/src/system/ai/services.js');
    const img=await import('/src/system/ai/image.js');
    const net=await import('/src/system/net.js');
    const p=svc.newImagePreset({ name:'中转' });
    svc.updateImagePreset(p.id, { baseUrl:'https://relay.example.com/v1',
      apiKey:'sk-test', model:'gpt-image-1', timeout: 600 });
    svc.setActiveImage(p.id);
    const at=()=>svc.imagePresets().find(x=>x.id===p.id);
    const R={ oldShell: img.oldShell?.(), shellOk: net.shellTimeoutOk?.() };   // 旧代码没有这两个，容它跑到后面的断言
    try { await img.generate({ prompt:'一只猫', preset:at(), key:'g1' }); R.gen='ok'; }
    catch(e){ R.gen=String(e.message||e); }
    R.test = await img.testImage(at());
    R.sent = window.__sent;
    return R;
  });
  await ctx.close();
  return { out, errs };
}

// ---- 旧外壳，对面慢 ----
{
  const { out, errs } = await shell({ old: true, slow: true });
  ok('旧外壳认得出来', out.oldShell === true && out.shellOk === false, JSON.stringify({o:out.oldShell,s:out.shellOk}));
  ok('旧外壳超时：报的是超时，不是「连不上」',
    /还没有回应/.test(out.gen) && !/连不上/.test(out.gen), out.gen);
  ok('并且说了是 120 秒、是旧外壳、要重装', /120 秒/.test(out.gen) && /旧版/.test(out.gen) && /ipa/.test(out.gen), out.gen);
  ok('不再叫人去调「等待上限」（旧外壳上那是摆设）', !/调大/.test(out.gen), out.gen);
  ok('自检把它归到「等超时了」而不是「没连上」', out.test.step === '等超时了', JSON.stringify(out.test).slice(0,300));
  ok('自检的下一步同样指向重装', /旧版/.test(out.test.hint) && /ipa/.test(out.test.hint), out.test.hint);
  ok('网页仍把 600 秒传了过去（新外壳装上就生效）', out.sent[0]?.timeout === 600, JSON.stringify(out.sent[0]));
  ok('旧外壳一路没有运行时报错', errs.length===0, errs.join(' | '));
}

// ---- 旧外壳，对面快：自检通过也要提醒 ----
{
  const { out } = await shell({ old: true, slow: false });
  ok('旧外壳自检通过', out.test.ok === true && out.gen === 'ok', JSON.stringify(out.test).slice(0,200));
  ok('但通过的提示里就写着 120 秒与重装', /120 秒/.test(out.test.hint) && /ipa/.test(out.test.hint), out.test.hint);
  ok('并且点明自检这一张与消息里那一张不一样长', /长提示词/.test(out.test.hint), out.test.hint);
}

// ---- 新外壳，对面慢：照旧叫人调等待上限，不提旧版 ----
{
  const { out, errs } = await shell({ old: false, slow: true });
  ok('新外壳认得出来', out.oldShell === false && out.shellOk === true, JSON.stringify({o:out.oldShell,s:out.shellOk}));
  ok('新外壳超时：说了等了 600 秒', /600 秒/.test(out.gen), out.gen);
  ok('新外壳超时：叫人调「等待上限」，不提旧版', /等待上限/.test(out.gen) && !/旧版/.test(out.gen), out.gen);
  ok('新外壳自检通过时不提旧版', true);
  ok('新外壳一路没有运行时报错', errs.length===0, errs.join(' | '));
}
{
  const { out } = await shell({ old: false, slow: false });
  ok('新外壳自检通过的提示里没有旧版那句', out.test.ok === true && !/旧版/.test(out.test.hint), out.test.hint);
}

await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
