import { BASE, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const fail = []; const ck = (n, c) => { if (!c) fail.push(n); };

const r = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const hl = await import('/src/system/health.js');
  const remind = await import('/src/system/medremind.js');
  const ctx = await import('/src/system/ai/context/health.js');
  const acc = await import('/src/system/accounts.js');
  const out = {};

  const me = acc.roots()[0] || acc.createRoot({ name: '我' });
  const a = db.characters.create({ name: '甲', persona: '人设' });
  const today = hl.dateKey();

  // 基础四项
  hl.set(hl.ME, today, { sleepMin: 450, steps: 8200, weight: 58.2 });
  hl.addWater(); hl.addWater(); hl.addWater();
  const d = hl.today();
  out.basics = { sleep: hl.fmtSleep(d.sleepMin), steps: d.steps, water: d.water };

  // 不适：点一下加、再点取消
  hl.toggleSymptom(hl.ME, today, 'headache');
  hl.toggleSymptom(hl.ME, today, 'cold');
  hl.toggleSymptom(hl.ME, today, 'headache');
  out.symptoms = hl.today().symptoms;

  // 体重单位：按公斤存，换单位不动已记的数
  db.settings.set({ weightUnit: 'lb' });
  out.lb = hl.toDisplay(58.2);
  out.roundTrip = +hl.fromDisplay(hl.toDisplay(58.2)).toFixed(1);
  db.settings.set({ weightUnit: 'kg' });
  out.storedStill = hl.today().weight;

  // 经期推算：至少两次才给数
  out.noPredAtZero = hl.predictCycle();
  hl.startCycle(hl.shiftDate(today, -60));
  out.noPredAtOne = hl.predictCycle();
  hl.startCycle(hl.shiftDate(today, -30));
  const p = hl.predictCycle();
  out.pred = p && { avg: p.avg, samples: p.samples, next: p.next };
  out.predNextIsFuture = p && hl.daysBetween(today, p.next) === 0;

  // 用药：到点、没记、没提醒过 -> 提醒一次；再查不重复
  const med = hl.addMed({ name: '维生素 D', dose: '一粒', times: ['08:00', '20:00'] });
  const at = new Date(); at.setHours(9, 0, 0, 0);
  out.due1 = remind.check(at.getTime());
  out.due2 = remind.check(at.getTime());          // 同一时刻不该再响
  const later = new Date(); later.setHours(21, 0, 0, 0);
  out.due3 = remind.check(later.getTime());        // 到了第二个时刻该再响
  hl.takeMed(med.id);
  const next = new Date(); next.setHours(22, 0, 0, 0);
  out.due4 = remind.check(next.getTime());         // 记过之后不再响
  out.notifCount = (await import('/src/system/notify.js')).notifications.get().items.length;

  // 关掉提醒
  db.settings.set({ medRemind: false });
  hl.updateMed(med.id, { lastNotified: '' });
  hl.takeMed(med.id);                              // 取消勾选
  out.offNoFire = remind.check(later.getTime());
  db.settings.set({ medRemind: true });

  // 上下文：默认一个字都不写
  const chat = db.chats.create({ characterIds: [a.id], personaId: me.id });
  out.ctxDefault = ctx.build({ char: db.characters.get(a.id) });

  db.settings.set({ healthInject: true });
  const on = ctx.build({ char: db.characters.get(a.id) });
  out.ctxHasSleep = /Slept/.test(on);
  out.ctxHasSteps = /8,200 steps/.test(on);
  out.ctxNoCycle = !/period/.test(on);              // 经期那道门还没开
  out.ctxNoAdvice = !/should|try to|make sure|recommend/i.test(on);
  out.ctxSaysDontInvent = /Do not invent them/.test(on);

  db.settings.set({ healthCycleInject: true });
  out.ctxWithCycle = /period|Next period/.test(ctx.build({ char: db.characters.get(a.id) }));

  // 角色那一份跟着它自己的开关
  out.ctxNoCharBefore = !/Your own body/.test(ctx.build({ char: db.characters.get(a.id) }));
  hl.setCharOn(a.id, true);
  hl.set(a.id, today, { energy: 'low', symptoms: ['throat'] });
  const withChar = ctx.build({ char: db.characters.get(a.id) });
  out.ctxCharOn = /Your own body/.test(withChar) && /嗓子疼/.test(withChar);

  // 角色那份不受用户总开关影响
  db.settings.set({ healthInject: false, healthCycleInject: false });
  const onlyChar = ctx.build({ char: db.characters.get(a.id) });
  out.charIndependent = /Your own body/.test(onlyChar) && !/Slept/.test(onlyChar);
  return out;
});

ck('基础四项记得住 ' + JSON.stringify(r.basics),
  r.basics.sleep === '7 小时 30 分' && r.basics.steps === 8200 && r.basics.water === 3);
ck('不适能加能取消 ' + JSON.stringify(r.symptoms), JSON.stringify(r.symptoms) === '["cold"]');
ck('公斤换磅 (' + r.lb + ')', Math.abs(r.lb - 128.3) < 0.2);
ck('换回来不失真 (' + r.roundTrip + ')', Math.abs(r.roundTrip - 58.2) < 0.05);
ck('换单位没动库里的数 (' + r.storedStill + ')', r.storedStill === 58.2);
ck('一次都没记时不推算', r.noPredAtZero === null);
ck('只记一次时也不推算', r.noPredAtOne === null);
ck('两次之后能推算 ' + JSON.stringify(r.pred), r.pred && r.pred.avg === 30 && r.pred.samples === 1);
ck('推的是下一次（上次 +30 天 = 今天）', r.predNextIsFuture);
ck('到点提醒一次', r.due1 === 1);
ck('同一时刻不重复提醒', r.due2 === 0);
ck('第二个时间点再提醒', r.due3 === 1);
ck('记过之后不再提醒', r.due4 === 0);
ck('关掉提醒就不响', r.offNoFire === 0);
ck('上下文默认一个字都不写 (' + JSON.stringify(r.ctxDefault) + ')', r.ctxDefault === '');
ck('开了才写睡眠', r.ctxHasSleep);
ck('步数按本地数字写进去', r.ctxHasSteps);
ck('经期另有一道门，没开就不写', r.ctxNoCycle);
ck('不写任何建议', r.ctxNoAdvice);
ck('明说了不许编数字', r.ctxSaysDontInvent);
ck('经期门开了才写', r.ctxWithCycle);
ck('角色那份默认不写', r.ctxNoCharBefore);
ck('角色开关开了才写它自己的', r.ctxCharOn);
ck('角色那份不受用户总开关影响', r.charIndependent);

console.log(fail.length ? '失败：\n  ' + fail.join('\n  ') : '健康全部通过');
if (errs.length) console.log('PAGEERRORS', errs);
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
