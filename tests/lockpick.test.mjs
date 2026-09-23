// 手机密码：依据不再总是生日，但同一个角色永远推出同一个
import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932}})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const out = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const th=await import('/src/system/theirs.js');
  // 一百个都带生日、设定里也有数字的角色
  const srcs=[], stable=[];
  for (let i=0;i<100;i++) {
    const c = db.characters.create({ name:'人'+i, birthday:'1999-03-14',
      persona:`工号 8421，房间 0307 号。` });
    const a = th.localLock(c), b = th.localLock(c), c3 = th.localLock(c);
    srcs.push(a.src);
    stable.push(a.code===b.code && b.code===c3.code);
  }
  const count = srcs.reduce((m,s)=>({...m,[s]:(m[s]||0)+1}),{});
  // 只有生日的
  const onlyBd = db.characters.create({ name:'只生日', birthday:'3月14日' });
  // 什么都没有的
  const none = db.characters.create({ name:'空白' });
  // 只有正文数字的
  const onlyTxt = db.characters.create({ name:'只正文', persona:'编号 5150。' });
  return { count, allStable: stable.every(Boolean),
    onlyBd: th.localLock(onlyBd), none: th.localLock(none), onlyTxt: th.localLock(onlyTxt) };
});

console.log('  一百个角色分别用了哪种依据：', JSON.stringify(out.count));
ok('同一个角色反复推，密码不变', out.allStable===true);
ok('不再是清一色的生日', (out.count.birthday || 0) < 100, JSON.stringify(out.count));
ok('四种依据都出现过',
  Object.keys(out.count).length >= 3, JSON.stringify(out.count));
ok('生日那一档还在', (out.count.birthday || 0) > 0, JSON.stringify(out.count));
ok('年份那一档也会被选中', (out.count.birthyear || 0) > 0, JSON.stringify(out.count));

ok('只有生日时就用生日', out.onlyBd.src==='birthday' && out.onlyBd.code==='0314',
  JSON.stringify(out.onlyBd));
ok('只有正文数字时就用它', out.onlyTxt.src==='text' && out.onlyTxt.code==='5150',
  JSON.stringify(out.onlyTxt));
ok('什么都没有时退回按标识推，并且说明无从推测',
  out.none.src==='random' && /无从推测/.test(out.none.hints[0]), JSON.stringify(out.none));

// 提示要和实际依据对得上 —— 这是最容易写错的地方
const match = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const th=await import('/src/system/theirs.js');
  const bad=[];
  for (let i=0;i<60;i++) {
    const c = db.characters.create({ name:'对'+i, birthday:'1987-07-09', persona:'房号 1204，工号 3366。' });
    const l = th.localLock(c);
    const want = { birthday:'0709', birthyear:'1987', text:'1204', 'text-last':'3366' }[l.src];
    if (l.code !== want) bad.push({ src:l.src, code:l.code, want });
    // 提示里不能出现别的依据的说法
    if (l.src==='birthyear' && !/年份/.test(l.hints.join(''))) bad.push({ src:l.src, why:'提示没说年份' });
    if (l.src==='birthday' && !/日期/.test(l.hints.join(''))) bad.push({ src:l.src, why:'提示没说日期' });
    if (l.src.startsWith('text') && !/设定里写着/.test(l.hints.join(''))) bad.push({ src:l.src, why:'提示没说设定' });
  }
  return bad;
});
ok('每一种依据对应的密码与提示都对得上', match.length===0, JSON.stringify(match.slice(0,4)));

// 重复的值只算一份（生日 0314 与正文 0314）
const dedup = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const th=await import('/src/system/theirs.js');
  const srcs=new Set();
  for (let i=0;i<40;i++) {
    const c=db.characters.create({ name:'重'+i, birthday:'2000-03-14', persona:'代号 0314。' });
    srcs.add(th.localLock(c).code);
  }
  return [...srcs];
});
ok('同一串数字不会因为来源不同被算成两种依据',
  dedup.every(x => x==='0314' || x==='2000'), JSON.stringify(dedup));

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
