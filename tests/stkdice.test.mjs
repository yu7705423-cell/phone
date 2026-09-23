// 两桩：表情分组会被挤没；[骰子] 掉格式之后会去抢译文
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1600);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

// ---- 一、表情分组 ----
const stk = await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  const caps=(await import('/src/system/ai/capabilities.js'));
  // A 组十二个，都用过；B 组三个，一次没用过；C 组两个，也没用过
  const mk = (g, n, used) => {
    for (let i=0;i<n;i++) db.stickers.create({ name:`${g}${i}`, group:g, url:'x', useCount: used });
  };
  mk('A', 12, 50); mk('B', 3, 0); mk('C', 2, 0);
  db.settings.set({ stickerCold: 12, stickerHot: 60 });
  const ch = db.characters.create({ name:'桐生' });
  const row = caps.CAPS.find(c => c.id === 'sticker');
  const cold = row.detail({ char: ch, hot: false, settings: db.settings.get() });
  const hot  = row.detail({ char: ch, hot: true,  settings: db.settings.get() });
  const has = (t, g) => new RegExp(`${g}\\d`).test(t);
  return {
    coldA: has(cold,'A'), coldB: has(cold,'B'), coldC: has(cold,'C'),
    hotA: has(hot,'A'), hotB: has(hot,'B'), hotC: has(hot,'C'),
    coldCount: (cold.match(/[ABC]\d+/g)||[]).length,
    cold: cold.slice(0, 200),
  };
});
ok('名额少的时候，每个分组都还看得见（不然那一组永远发不出来）',
  stk.coldA && stk.coldB && stk.coldC, JSON.stringify(stk));
ok('名额没少给：还是列满了 12 个', stk.coldCount === 12, JSON.stringify(stk));
ok('名额够的时候三组当然都在', stk.hotA && stk.hotB && stk.hotC, JSON.stringify(stk));

// ---- 二、骰子掉格式 ----
const dice = await page.evaluate(async () => {
  const r=(await import('/src/system/ai/reply.js'));
  const shapes = {
    plain:   '[骰子]',
    body:    '[骰子：谁先说]',
    number:  '1. [骰子]',
    dot:     '[骰子]。',
    full:    '【掷骰子】',
  };
  const out = {};
  for (const [k, line] of Object.entries(shapes)) {
    const parts = r.splitReply(`来定一下\n${line}`);
    out[k] = parts.map(p => p.type);
  }
  // 掉格式的骰子会不会去抢译文
  // 掉格式那一行排在正文**前面**时才看得出它在抢：它会吃掉第一句译文
  const mixed = r.splitReply(
    '[某个没人认识的标记]\n第一句\n第二句\n[译文：first line]\n[译文：second line]');
  out.mixed = mixed.map(p => ({ t:p.type, x:(p.text||'').slice(0,6), tr:p.translation||'' }));
  return out;
});
ok('[骰子] 认得出', dice.plain.includes('dice'), JSON.stringify(dice.plain));
ok('【掷骰子】也认得出', dice.full.includes('dice'), JSON.stringify(dice.full));
ok('[骰子：谁先说] 带了正文也认得出', dice.body.includes('dice'), JSON.stringify(dice.body));
ok('前面带序号也认得出', dice.number.includes('dice'), JSON.stringify(dice.number));
ok('后面跟个句号也认得出', dice.dot.includes('dice'), JSON.stringify(dice.dot));
ok('掉格式的骰子不会变成一个气泡',
  !dice.body.includes('text') || dice.body.filter(t=>t==='text').length === 1,
  JSON.stringify(dice.body));

// 认不出的标记照旧落成一条（丢掉的话真想说的话也会跟着没），
// 但它不该占掉一句译文
const marked = dice.mixed.find(p => /^\[/.test(p.x));
const said = dice.mixed.filter(p => p.t === 'text' && !/^\[/.test(p.x));
ok('译文按顺序配在两句正文上，没被那个认不出的标记抢走',
  said.length === 2 && said[0].tr === 'first line' && said[1].tr === 'second line',
  JSON.stringify(dice.mixed));
ok('那个认不出的标记自己不占译文', marked && marked.tr === '', JSON.stringify(marked));

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
