// 内置生图预设：默认关着；开了之后两头都有 —— 要求角色写什么、成片像什么。
// 以及「从人设中提取外貌」那个按钮
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});
let reply = '及肩黑发，眼角有痣，常穿宽大的深色毛衣。';
await ctx.route('**/relay.example.com/**', r => r.fulfill({status:200,contentType:'application/json',
  body: JSON.stringify({ choices:[{ message:{ content: reply } }] })}));
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1600);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// ---- 默认关着 ----
const off = await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  const d=(await import('/src/system/db/defaults.js'));
  const ip=(await import('/src/system/ai/imageprompt.js'));
  const caps=(await import('/src/system/ai/capabilities.js'));
  const ch = db.characters.create({ name:'乃木绿实', persona:'美院三年级，及肩黑发，眼角有痣。' });
  return {
    dflt: JSON.stringify(d.DEFAULT_SETTINGS.imageStyles),
    on: ip.stylesOn().length, ask: ip.styleAsk(),
    prompt: ip.compose({ prompt:'在窗边', char: ch }),
    detail: caps.CAPS.find(c => c.id === 'image').detail(),
    chId: ch.id,
  };
});
ok('默认一个预设都不开', off.dflt === '[]' && off.on === 0, JSON.stringify(off.dflt));
ok('关着时提示词里没有预设那一段', !/everyday photo/.test(off.prompt), off.prompt);
ok('关着时也不往角色那份说明里塞东西',
  !/state what they are wearing/i.test(off.detail), off.detail.slice(-90));

// ---- 开了之后 ----
const on = await page.evaluate(async (chId) => {
  const db=(await import('/src/system/db/index.js'));
  const ip=(await import('/src/system/ai/imageprompt.js'));
  const caps=(await import('/src/system/ai/capabilities.js'));
  db.settings.set({ imageStyles: ['daily'] });
  const ch = db.characters.get(chId);
  return {
    list: ip.STYLES.map(x => x.id),
    prompt: ip.compose({ prompt:'在窗边', char: ch }),
    explain: ip.explain({ prompt:'在窗边', char: ch }),
    detail: caps.CAPS.find(c => c.id === 'image').detail(),
  };
}, off.chId);
ok('预设表里有「日常拍照分享」', on.list.includes('daily'), JSON.stringify(on.list));
ok('开了之后，成片那一段拼进了提示词',
  /everyday photo/.test(on.prompt) && /no studio setup/.test(on.prompt), on.prompt.slice(-140));
ok('抓包里标得出是哪个预设加的', /生图预设「日常拍照分享」/.test(on.explain), on.explain.slice(-160));
ok('角色写描述时也收到要求：场景、环境、构图、光线',
  /setting and the surroundings/.test(on.detail) && /framing/.test(on.detail)
  && /light/.test(on.detail), on.detail.slice(-160));
ok('以及画面里有人时要写穿着，并与场景相称',
  /what they are wearing/.test(on.detail) && /fit the\n?setting/.test(on.detail), on.detail.slice(-120));
ok('用户自己的全局提示词仍然排在最后（它有最后一句）', await page.evaluate(async (chId) => {
  const db=(await import('/src/system/db/index.js'));
  const ip=(await import('/src/system/ai/imageprompt.js'));
  db.settings.set({ imagePrompt: '我自己写的那一句' });
  const t = ip.compose({ prompt:'在窗边', char: db.characters.get(chId) });
  return t.trimEnd().endsWith('我自己写的那一句');
}, off.chId));

// ---- 改写那一步也照着同一份要求写 ----
const rw = await page.evaluate(async () => {
  const t=(await import('/src/system/ai/templates.js'));
  return t.template('task.image-prompt').includes('{{ask}}');
});
ok('改写那一步的规格里留了位置接这几句', rw === true);

// ---- 界面上的开关 ----
await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  db.settings.set({ imageStyles: [] });
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('settings','/'); n.popToRoot(); n.push('/image');
});
await page.waitForTimeout(900);
ok('生图那一页列出了内置预设',
  /日常拍照分享/.test(await page.locator('.page-body').innerText()));
ok('并且说明了开预设不会多花一次调用',
  /不会增加接口调用次数/.test(await page.locator('.page-body').innerText()));
await page.locator('.list-item', { hasText:'日常拍照分享' }).locator('.switch, input').first().click();
await page.waitForTimeout(500);
ok('点开关之后存了下来', await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  return (db.settings.get().imageStyles || []).includes('daily');
}));
await page.screenshot({path:`${OUT}/imgstyle.png`});

// ---- 从人设中提取外貌 ----
await page.evaluate(async (chId) => {
  const svc=(await import('/src/system/ai/services.js'));
  const p = svc.newChatPreset({ name:'主用' });
  svc.updateChatPreset(p.id, { baseUrl:'https://relay.example.com/v1', apiKey:'k',
    model:'m', provider:'openai' });
  svc.setActiveChat(p.id);
  const n=await import('/src/system/nav.js');
  n.openApp('contact','/'); n.popToRoot(); n.push(`/edit/${chId}`);
}, off.chId);
await page.waitForTimeout(900);
ok('编辑资料页上有「外貌」这一栏与提取按钮',
  /外貌/.test(await page.locator('.page-body').innerText())
  && await page.locator('button', { hasText:'从人设中提取' }).count() === 1);
await page.locator('button', { hasText:'从人设中提取' }).click();
await page.waitForTimeout(1500);
const got = await page.evaluate(async (chId) => {
  const db=(await import('/src/system/db/index.js'));
  return db.characters.get(chId).appearance;
}, off.chId);
ok('点一下就把外貌填进去了', got === '及肩黑发，眼角有痣，常穿宽大的深色毛衣。', JSON.stringify(got));

// 人设为空时不发请求
const empty = await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  const card=(await import('/src/system/ai/tasks/card.js'));
  return await card.makeAppearance('');
});
ok('人设为空时不发请求', empty === '', JSON.stringify(empty));

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
