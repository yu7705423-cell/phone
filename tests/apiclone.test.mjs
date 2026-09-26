// 接口：同一个地址与密钥换个模型另存（ARCHITECTURE 4.255）
//
// 用户要求：同一个接口、同一个 key，想要不同模型，直接保存新的预设，不用重新填一遍。
//
//   一、编辑页有「复制为新预设」；点了之后多出一套，地址、密钥、类型、站点与充值链接、temperature、插入身份照抄
//   二、复制出来的直接弹出模型列表；选好模型后名字变成「原名 · 模型」，原来那套的模型不变
//   三、主用与副用不变；原来那套的模型记进新那套的「最近用过」
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
await ctx.route('**/relay.example.com/**', route => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }, { id: 'model-c' }] }) }));
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);

const src = await ev(async () => {
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newChatPreset({ name: '中转站 A', provider: 'openai' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'sk-secret', model: 'model-a',
    siteUrl: 'https://relay.example.com', topupUrl: 'https://relay.example.com/pay', temperature: 0.7, midSystem: 'system' });
  svc.setActiveChat(p.id);
  const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('settings', '/api');
  return p.id;
});
await page.waitForTimeout(800);
await page.locator('.list-item, [class*="list-item"]', { hasText: '兼容接口 · model-a' }).first().click();
await page.waitForTimeout(500);
await page.locator('button', { hasText: '复制为新预设' }).click();
await page.waitForTimeout(1200);

const picker = await page.locator('.sheet', { hasText: '选择模型' }).count();
ok('二、复制出来的直接弹出模型列表', picker > 0, String(picker));
await page.locator('.model-row', { hasText: 'model-b' }).click();
await page.waitForTimeout(600);

const st = await ev(async id => {
  const svc = await import('/src/system/ai/services.js');
  const all = svc.chatPresets();
  const old = all.find(p => p.id === id);
  const neu = all.find(p => p.id !== id);
  return { n: all.length, old, neu, active: svc.services().chat.activeId };
}, src);
const same = ['provider', 'baseUrl', 'apiKey', 'siteUrl', 'topupUrl', 'temperature', 'midSystem'].every(k => st.neu?.[k] === st.old?.[k]);
ok('一、多出一套，地址、密钥、类型、站点与充值链接、temperature、插入身份照抄', st.n === 2 && same, JSON.stringify(st));
ok('二、选好模型后名字是「原名 · 模型」，原来那套的模型不变',
  st.neu?.model === 'model-b' && st.neu?.name === '中转站 A · model-b' && st.old?.model === 'model-a', JSON.stringify(st.neu));
ok('三、主用不变；原来的模型记进新那套的「最近用过」', st.active === src && (st.neu?.recentModels || []).includes('model-a'), JSON.stringify(st));

ok('没有页面错误', !errs.length, errs.join('\n'));
await browser.close();
const fail = R.filter(x => !x.pass).length;
console.log(`\n${R.length - fail}/${R.length} 项通过`);
process.exit(fail ? 1 : 0);
