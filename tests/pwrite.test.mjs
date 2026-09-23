// 生成之前先写一遍提示词：默认关着、开了才多调一次、写不出来退回原话
import { BASE, EXE, chromium, PNG_PATH } from './_env.mjs';
const fs = await import('node:fs/promises');
const PNG = (await fs.readFile(PNG_PATH,'utf-8')).trim();
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const ctx = await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true});
const page = await ctx.newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const chat=[], img=[];
let chatReply = '一只橘猫走过红色屋顶，午后逆光，中景，胶片颗粒。';
let chatFail = false;
await ctx.route('**/relay.example.com/**', async route => {
  const u = route.request().url(); const body = route.request().postData() || '';
  if (u.includes('/chat/completions')) {
    chat.push(body);
    if (chatFail) return route.fulfill({ status:500, contentType:'application/json', body:'{"error":{"message":"炸了"}}' });
    return route.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ choices:[{ message:{ content: chatReply } }] }) });
  }
  if (u.includes('/images/generations')) {
    img.push(JSON.parse(body || '{}'));
    return route.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ data:[{ b64_json: PNG }] }) });
  }
  return route.fulfill({ status:404, body:'' });
});
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1600);

const ids = await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  const svc=(await import('/src/system/ai/services.js'));
  const p = svc.newImagePreset({ name:'图' });
  svc.updateImagePreset(p.id, { baseUrl:'https://relay.example.com/v1', apiKey:'sk-x', model:'gpt-image-1' });
  svc.setActiveImage(p.id);
  const ch = db.characters.create({ name:'桐生', persona:'乃木喵是桐生养的一只橘猫，左耳有缺口。' });
  const chat = db.chats.create({ characterIds:[ch.id], personaId:'me', title:'桐生' });
  db.messages.create({ chatId: chat.id, role:'user', authorId:'me', kind:'text', content:'乃木喵今天怎么样', status:'done' });
  return { ch: ch.id, chat: chat.id };
});
// 聊天预设。写提示词那一步走副用，没配副用就退回主用（第 15 条那张表）
await page.evaluate(async () => {
  const svc=(await import('/src/system/ai/services.js'));
  const p = svc.newChatPreset({ name:'主用' });
  svc.updateChatPreset(p.id, { baseUrl:'https://relay.example.com/v1', apiKey:'sk-x',
    model:'m', provider:'openai' });
  svc.setActiveChat(p.id);
});

// ---- 默认关着 ----
const def = await page.evaluate(async () => {
  const d=(await import('/src/system/db/defaults.js'));
  const c=(await import('/src/system/ai/cost.js'));
  const pw=(await import('/src/system/ai/promptwrite.js'));
  const ids = ['writeImagePrompt','writeVideoPrompt','writeVoicePrompt'];
  return {
    dflt: ids.map(k => d.DEFAULT_SETTINGS[k]),
    listed: ids.every(k => c.EXTRA_CALLS.some(x => x.id === k && x.off === false)),
    on: [pw.imageOn(), pw.videoOn(), pw.voiceOn()],
  };
});
ok('三项默认都是关的', def.dflt.join(',') === 'false,false,false', JSON.stringify(def.dflt));
ok('三项都登记在 EXTRA_CALLS 里、登记的「关」是 false', def.listed === true);
ok('关着的时候 on() 都是 false', def.on.join(',') === 'false,false,false', JSON.stringify(def.on));

// ---- 关着：原话直接送出去，一次改写都不调 ----
const off = await page.evaluate(async (o) => {
  const pw=(await import('/src/system/ai/promptwrite.js'));
  return {
    img: await pw.forImage('乃木喵和调色盘', { chatId:o.chat }),
    vid: await pw.forVideo('乃木喵走过', { chatId:o.chat }),
    voi: await pw.scriptFor('你回来啦', { chatId:o.chat }),
  };
}, ids);
ok('关着时生图那句原样返回', off.img === '乃木喵和调色盘', off.img);
ok('关着时视频那句原样返回', off.vid === '乃木喵走过', off.vid);
ok('关着时语音原句原样返回', off.voi === '你回来啦', JSON.stringify(off.voi));
ok('关着时一次接口都没调', chat.length === 0, `调了 ${chat.length} 次`);

// ---- 开了：真的改写，并且带上了对话里的上下文 ----
await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  db.settings.set({ writeImagePrompt:true, writeVideoPrompt:true, writeVoicePrompt:true });
});
const on = await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const pw=(await import('/src/system/ai/promptwrite.js'));
  return await pw.forImage('乃木喵和调色盘', { chatId:o.chat, char: db.characters.get(o.ch), key:'t1' });
}, ids);
ok('开了之后那一句被改写了', on !== '乃木喵和调色盘' && /橘猫/.test(on), on);
ok('改写确实多调了一次接口', chat.length === 1, `调了 ${chat.length} 次`);
const sent = chat[0] || '';
ok('改写时把角色设定带过去了（「乃木喵」是什么就在里面）',
  /左耳有缺口/.test(sent), sent.slice(0,200));
ok('改写时把最近的对话也带过去了', /乃木喵今天怎么样/.test(sent), sent.slice(0,200));
ok('那份指令本身是英文的（第 14 条）', /does not receive the conversation/.test(sent), sent.slice(0,200));

// ---- 模型加了引号、加了代码围栏，要剥掉 ----
chatReply = '```\n"一只橘猫站在窗台上。"\n```';
const cleaned = await page.evaluate(async (o) => {
  const pw=(await import('/src/system/ai/promptwrite.js'));
  return await pw.forImage('猫', { chatId:o.chat, key:'t2' });
}, ids);
ok('围栏与引号被剥掉', cleaned === '一只橘猫站在窗台上。', JSON.stringify(cleaned));

// ---- 写不出来就退回原话，不能把整张图断掉 ----
chatFail = true;
const fell = await page.evaluate(async (o) => {
  const pw=(await import('/src/system/ai/promptwrite.js'));
  return {
    img: await pw.forImage('乃木喵和调色盘', { chatId:o.chat, key:'t3' }),
    voi: await pw.scriptFor('你回来啦', { chatId:o.chat, key:'t4' }),
  };
}, ids);
ok('改写失败时退回角色原来那句', fell.img === '乃木喵和调色盘', fell.img);
ok('写台本失败时退回原句', fell.voi === '你回来啦', JSON.stringify(fell.voi));
chatFail = false;

// ---- 真发一张图：改写后的那句才是送出去的 ----
chatReply = '一只左耳有缺口的橘猫蹲在木质调色盘旁边，窗光柔和，近景。';
const before = chat.length;
await page.evaluate(async (o) => {
  const db=(await import('/src/system/db/index.js'));
  const r=(await import('/src/system/ai/reply.js'));
  r.materialize({ type:'image', prompt:'乃木喵和调色盘' },
    { chatId:o.chat, role:'char', authorId:o.ch, status:'done' }, db.characters.get(o.ch));
}, ids);
await page.waitForTimeout(2500);
ok('发图这条路也走了改写', chat.length === before + 1, `改写调用 ${chat.length - before} 次`);
ok('送给生图接口的是改写之后那一句',
  /左耳有缺口/.test(img[0]?.prompt || ''), (img[0]?.prompt || '').slice(0,120));

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
