// 两个分组里有重名时，后加的那一组角色一个都发不出来
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1600);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const out = await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  const stk=(await import('/src/system/stickers.js'));
  const caps=(await import('/src/system/ai/capabilities.js'));
  // 两套包都有「开心/生气/难过」，这在现实里很常见
  const A = ['开心','生气','难过','无语','点赞','摸摸'];
  const B = ['开心','生气','难过','摸鱼','下班','加油'];
  A.forEach(n => db.stickers.create({ name:n, group:'日常', url:'x', useCount:30, keywords:[] }));
  B.forEach(n => db.stickers.create({ name:n, group:'猫猫', url:'x', useCount:0, keywords:[] }));
  const ch = db.characters.create({ name:'桐生' });
  const listed = caps.CAPS.find(c => c.id === 'sticker')
    .detail({ char: ch, hot: true, settings: db.settings.get() });

  const rows = db.stickers.all().map(s => ({
    name: s.name, group: stk.groupOf(s), label: stk.labelOf(s),
    listed: listed.includes(`- ${stk.labelOf(s)}`),
    byLabel: stk.byName(stk.labelOf(s))?.id === s.id,
    byBare: stk.byName(s.name)?.id === s.id,
  }));
  return { rows, dupes: [...stk.dupeNames()], bad: stk.unreachable(), listed };
});

const dup = out.rows.filter(r => ['开心','生气','难过'].includes(r.name));
const uniq = out.rows.filter(r => !['开心','生气','难过'].includes(r.name));

ok('重名的在名单里带上了分组',
  dup.every(r => r.label === `${r.name}（${r.group}）`), JSON.stringify(dup.map(r=>r.label)));
ok('不重名的照旧只写名字（名单要占 token，不必个个都缀）',
  uniq.every(r => r.label === r.name), JSON.stringify(uniq.map(r=>r.label)));
ok('两个组的表情都列了出来', out.rows.every(r => r.listed),
  JSON.stringify(out.rows.filter(r=>!r.listed)));
ok('照名单上的写法，每一个都找得回它自己',
  out.rows.every(r => r.byLabel), JSON.stringify(out.rows.filter(r=>!r.byLabel)));
ok('后加那一组里重名的那几个，从前正是发不出来的（只写名字仍然指向先建的）',
  dup.filter(r => r.group === '猫猫').every(r => !r.byBare), JSON.stringify(dup));
ok('认出重名之后，管理页上一条都不报（名单已经不含糊了）',
  out.bad.length === 0, JSON.stringify(out.bad));

// 没名字的那种要报出来
const noName = await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  const stk=(await import('/src/system/stickers.js'));
  const s = db.stickers.create({ name:'', group:'猫猫', url:'x', useCount:0 });
  const bad = stk.unreachable();
  db.stickers.remove(s.id);
  return bad;
});
ok('没有名称的表情报得出来', noName.some(b => b.why === '没有名称'), JSON.stringify(noName));

// 界面上摆出来
await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  db.stickers.create({ name:'', group:'猫猫', url:'x', useCount:0 });
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('chat','/'); n.popToRoot(); n.push('/stickers');
});
await page.waitForTimeout(1200);
const txt = await page.locator('.page-body').innerText();
ok('管理页上把「角色发不出来」摆了出来', /角色发不出来/.test(txt), txt.slice(0,200));
await page.screenshot({path:`${OUT}/stkgroup.png`});

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
