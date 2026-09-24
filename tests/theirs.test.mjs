// 角色手机：进去先是锁屏、解开是一块仿真的桌面、各视图只读不改。
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--no-first-run'] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);

const ids = await page.evaluate(async () => {
  const db = await import('/src/system/db/index.js');
  const acc = await import('/src/system/accounts.js');
  const h = await import('/src/system/health.js');
  const shelf = await import('/src/system/shelf.js');
  const day = await import('/src/system/day.js');
  acc.roots()[0] || acc.createRoot({ name: '我' });

  // 甲：有生日，三样都有，还有一张真头像
  const a = db.characters.create({ name: '甲', birthday: '1999-03-14',
    persona: '一段很长的人设正文，绝不该出现在列表里', healthOn: true, dayOn: true });
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const g2 = cv.getContext('2d');
  g2.fillStyle = '#4477cc'; g2.fillRect(0, 0, 64, 64);
  const ablob = await new Promise(r => cv.toBlob(r, 'image/png'));
  const aid = await db.images.put(new File([ablob], 'a.png', { type: 'image/png' }), 256);
  db.characters.update(a.id, { avatar: aid });
  shelf.add(a.id, { title: '雨城旧事', author: '某人' });
  shelf.add(a.id, { title: '另一本', author: '别人' });
  h.set(a.id, h.dateKey(), { energy: 'low', mood: 'flat', sleepMin: 300,
    symptoms: ['headache'], poops: [{ at: '06:30', form: 'b3' }], note: '设定的一句' });
  day.save(a.id, { date: day.dateKey(db.characters.get(a.id)), items: [
    { slot: day.SLOTS[0].id, text: '去了趟邮局' },
    { slot: day.SLOTS[1].id, text: '在家看书', state: day.DONE },
  ] });

  // 乙：没有生日，人设里有一串四位数
  const b = db.characters.create({ name: '乙', persona: '乙的人设，住在 8823 号那栋楼里。' });
  // 丙：没有生日也没有数字，只有书架
  const c = db.characters.create({ name: '丙', persona: '丙的人设，一个数字都没有写。' });
  shelf.add(c.id, { title: '只有一本' });
  // 小号与 NPC 不该出现在挑人那一页
  db.characters.create({ name: '甲的小号', parentId: a.id });
  db.characters.create({ name: '某个路人', isNpc: true });
  return { a: a.id, b: b.id, c: c.id };
});

const go = async route => {
  await page.evaluate(([r]) => import('/src/system/nav.js').then(n => n.openApp('theirs', r)), [route]);
  await page.waitForTimeout(700);
};
const txt = () => page.evaluate(() => document.body.innerText);
const fail = [], ok = [];
const check = (c, m) => (c ? ok : fail).push(m);
const names = () => page.evaluate(() =>
  [...document.querySelectorAll('.tp-name')].map(e => e.innerText.trim()));
// 真的去按那块数字键盘
const typeCode = async code => {
  for (const d of String(code)) {
    await page.evaluate(k => {
      const b = [...document.querySelectorAll('.tp-key')].find(e => e.innerText.trim() === k);
      if (!b) throw new Error('键盘上没有这个键：' + k);
      b.click();
    }, d);
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(500);
};
const unlock = id => page.evaluate(i =>
  import('/src/system/theirs.js').then(t => t.open(i)), id);
// 密码的依据是按角色 id 随机挑的（生日 / 出生年份 / 设定里的数字），
// 不再固定是生日，所以测试不能写死一串数 —— 现问现输。
// 依据分布是否真的散开由 lockpick.mjs 单独验
const codeOf = id => page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const t = await import('/src/system/theirs.js');
  return t.localLock(db.characters.get(i)).code;
}, id);
const srcOf = id => page.evaluate(async i => {
  const db = await import('/src/system/db/index.js');
  const t = await import('/src/system/theirs.js');
  return t.localLock(db.characters.get(i)).src;
}, id);
const relock = id => page.evaluate(i =>
  import('/src/system/theirs.js').then(t => t.relock(i)), id);

// ---- 1 挑人那一页 ----
await go('/');
let body = await txt();
check(/甲/.test(body) && /乙/.test(body) && /丙/.test(body), '三个角色都列出来了');
check(!/小号/.test(body), '小号不列（它不是一台独立的手机）');
check(!/路人/.test(body), 'NPC 不列');
check(!/人设/.test(body), '列表里一个字的人设都没露（第 6 条）');
check(/锁屏已启用/.test(body), '每一台都锁着，列表里如实写');
const pickAv = await page.evaluate(() =>
  [...document.querySelectorAll('.list-item .avatar')].map(e => e.tagName));
check(pickAv[0] === 'IMG',
  `挑人那一页的头像也是真的图（${JSON.stringify(pickAv)}）`);

// ---- 2 点进去看见的第一屏就是锁屏，不是一页「要不要设定密码」 ----
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.list-item')].find(e => e.innerText.includes('甲'));
  el.click();
});
await page.waitForTimeout(800);
body = await txt();
const keys = await page.evaluate(() => document.querySelectorAll('.tp-key').length);
check(keys === 11, `进去直接是数字键盘（${keys} 个键）`);
check(/4 位密码/.test(body), '写着几位');
check(!/设定密码/.test(body) && !/密码位数/.test(body), '没有那一页「先设定一个密码」');
check(await page.evaluate(() => !document.querySelector('.navbar')),
  '锁屏没有导航栏，整屏就是一块锁屏');
// 只看 app 那一层：外壳自己的状态栏（全屏时会画）上本来就有时刻
check(!/\d\d:\d\d/.test(await page.evaluate(() => document.querySelector('.app-layer').innerText)),
  '锁屏上没有时刻与星期，只剩一张头像');
const lockAv = await page.evaluate(() => {
  const el = document.querySelector('.tp-lock-top .avatar');
  return { tag: el?.tagName, src: el?.getAttribute('src') || '' };
});
check(lockAv.tag === 'IMG' && /^blob:/.test(lockAv.src),
  `锁屏上那张头像是真的图，不是姓名首字（${JSON.stringify(lockAv)}）`);
await page.screenshot({ path: `${OUT}/tp-lock.png` });

// ---- 3 推出来的那个就是密码，输对了进桌面 ----
const codeA = await codeOf(ids.a);
check(/^\d{4}$/.test(codeA), `推出来的是四位数（${codeA}，依据 ${await srcOf(ids.a)}）`);
await typeCode(String((Number(codeA) + 1) % 10000).padStart(4, '0'));
check(/密码错误，已尝试 1 次/.test(await txt()), '输错了如实说，且不记进库里');
await typeCode(codeA);
body = await txt();
check(await page.evaluate(() => !!document.querySelector('.tp-desk')), '输对了就进桌面了');
check(!/密码/.test(body), '桌面上不再提密码');

// ---- 4 桌面是一块桌面，不是一页设置 ----
let t = await names();
check(JSON.stringify(t) === JSON.stringify(['聊天', '相册', '备忘录', '浏览器', '书架', '身体状态', '今天']),
  `自带的四个空着也画，另外三个跟着各自的开关：${JSON.stringify(t)}`);
check(await page.evaluate(() => !document.querySelector('.navbar')), '桌面没有导航栏');
check(await page.evaluate(() => document.querySelectorAll('.tp-cell .tp-sub').length === 0),
  '图标底下没有副标题，只有名字');
check(await page.evaluate(() => {
  const g = document.querySelector('.tp-apps');
  return g && getComputedStyle(g).gridTemplateColumns.split(' ').length === 4;
}), '四列');
check(await page.evaluate(() => document.querySelectorAll('.tp-dock-btn').length === 4),
  '底下那一条有生成、外观、锁上、退出');
check(await page.evaluate(() => !document.querySelector('.tp-hi')), '不另画一道 Home Indicator（外壳底下已经有一道）');
check(/\d\d:\d\d/.test(body), '桌面上有角色那边的时刻');
check(!/人设/.test(body), '桌面上没有人设');
await page.screenshot({ path: `${OUT}/tp-desk.png` });

// ---- 5 自带的四个空着也点得进去，里面是空状态不是白屏 ----
for (const [label, want] of [['聊天', '还没有会话'], ['相册', '还没有照片'],
  ['备忘录', '还没有备忘录'], ['浏览器', '还没有搜索记录']]) {
  await go(`/home/${ids.a}`);
  await page.evaluate(l => {
    const b = [...document.querySelectorAll('.tp-cell')].find(e => e.innerText.includes(l));
    b.click();
  }, label);
  await page.waitForTimeout(700);
  const s = await txt();
  check(new RegExp(want).test(s) && /去生成/.test(s), `${label}空着是空状态，并给了去生成`);
}

// ---- 6 底下那一条：锁上就真的锁上了 ----
await go(`/home/${ids.a}`);
await page.evaluate(() => {
  [...document.querySelectorAll('.tp-dock-btn')].find(e => e.innerText.includes('锁上')).click();
});
await page.waitForTimeout(700);
check(await page.evaluate(() => document.querySelectorAll('.tp-key').length === 11), '锁上之后回到锁屏');
await typeCode(codeA);
check(await page.evaluate(() => !!document.querySelector('.tp-desk')), '再输一次又进去了');

// ---- 7 每一页都挡：直接跳内页也要过锁屏 ----
await relock(ids.a);
await go(`/notes/${ids.a}`);
check(await page.evaluate(() => document.querySelectorAll('.tp-key').length === 11),
  '直接跳备忘录也先过锁屏，绕不过去');
await unlock(ids.a);

// ---- 8 没有生日：取人设里那一串四位数 ----
await relock(ids.b);
await go(`/home/${ids.b}`);
const codeB = await codeOf(ids.b);
await typeCode(codeB);
check(await page.evaluate(() => !!document.querySelector('.tp-desk')),
  `没有生日时，取的是人设里那串四位数（${codeB}，依据 ${await srcOf(ids.b)}）`);

// ---- 9 两样都没有：一条线索就说明推不出来，当场可以直接查看 ----
await relock(ids.c);
await go(`/home/${ids.c}`);
body = await txt();
check(/询问线索（还有 1 条）/.test(body), '丙只有一条线索');
await page.evaluate(() => {
  [...document.querySelectorAll('.tp-lock-acts button')].find(e => e.innerText.includes('询问线索')).click();
});
await page.waitForTimeout(600);
check(/无从推测/.test(await txt()), '那一条线索直说推不出来');
check(/直接查看密码/.test(await txt()), '问完了就给「直接查看密码」');

// ---- 10 线索问过之后记住问到第几条 ----
await go('/');
await go(`/home/${ids.c}`);
check(!/询问线索/.test(await txt()), '问过的那一条不再重复给');
await unlock(ids.c);

// ---- 11 三个视图读的是既有数据 ----
await go(`/shelf/${ids.a}`);
body = await txt();
check(/雨城旧事/.test(body) && /另一本/.test(body), '书架列出了那两本');
check(/没有接上正文/.test(body), '没接上真书的那本如实写');
check(/只作查看/.test(body), '写明了只作查看');

await go(`/body/${ids.a}`);
body = await txt();
check(/疲惫/.test(body) && /一般/.test(body) && /头痛/.test(body)
  && /5 小时/.test(body) && /设定的一句/.test(body), '身体状态五项都在');
check(/排便/.test(body) && /06:30 表面有裂痕/.test(body), '排便那一条带着时间与形态');

await go(`/day/${ids.a}`);
body = await txt();
check(/去了趟邮局/.test(body) && /在家看书/.test(body), '今天两项都在');
check(/已完成/.test(body), '完成状态写出来了');

// ---- 12 只读：这几页上没有任何能改数据的控件 ----
await go(`/body/${ids.a}`);
const editable = await page.evaluate(() =>
  document.querySelectorAll('.page input, .page textarea, .page .switch, .page .chip').length);
check(editable === 0, `身体状态页上没有可编辑控件（${editable} 个）`);

// ---- 13 跳出去改：走 Intent，跳到真正的设定页 ----
const jump = async label => {
  await page.evaluate(l => {
    const el = [...document.querySelectorAll('.list-item')].find(e => e.innerText.includes(l));
    if (!el) throw new Error('找不到：' + l);
    el.click();
  }, label);
  await page.waitForTimeout(800);
  return page.evaluate(async () => {
    const { nav } = await import('/src/system/nav.js');
    const s = nav.get();
    return { app: s.appId, route: (s.stacks[s.appId] || []).slice(-1)[0] };
  });
};
await go(`/body/${ids.a}`);
let at = await jump('前往「健康」设定');
check(at.app === 'health' && at.route === `/char/${ids.a}`, `身体状态跳到了健康的设定页（${JSON.stringify(at)}）`);
await go(`/day/${ids.a}`);
at = await jump('前往「一天」');
check(at.app === 'daily' && at.route === `/today/${ids.a}`, `今天跳到了一天（${JSON.stringify(at)}）`);
await go(`/shelf/${ids.a}`);
at = await jump('前往「一起看」的书架');
check(at.app === 'theater' && at.route === `/shelf/${ids.a}`, `书架跳到了一起看（${JSON.stringify(at)}）`);

// ---- 14 生成那一页：锁屏密码在里面，但「全部生成」不带它 ----
await go(`/make/${ids.a}`);
body = await txt();
check(/锁屏密码/.test(body), '生成那一页里有「锁屏密码」这一项');
check(/未调用接口/.test(body), '并且写着当前这个是本地推出来的');
check(/其中不包含锁屏密码/.test(body), '说明了「全部生成」不带它');
check(await page.evaluate(() =>
  [...document.querySelectorAll('.segmented button, .seg button')].some(e => /四位/.test(e.innerText))),
  '位数是四位六位两选一，不是一个数字输入框');

// ---- 15 角色没了不炸 ----
await go('/home/nope');
check(/这个角色已经不在了/.test(await txt()), '角色不在时说清楚，不是白屏');

// 截图
await unlock(ids.a);
await go(`/home/${ids.a}`);
await page.screenshot({ path: `${OUT}/theirs-home.png` });
await go(`/body/${ids.a}`);
await page.screenshot({ path: `${OUT}/theirs-body.png`, fullPage: true });
await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
await go(`/home/${ids.a}`);
await page.screenshot({ path: `${OUT}/theirs-dark.png` });

console.log(ok.map(s => '  ok   ' + s).join('\n'));
if (fail.length) console.log(fail.map(s => '  FAIL ' + s).join('\n'));
if (errors.length) console.log('\n' + errors.slice(0, 6).join('\n'));
console.log(`\n合计 ${ok.length} 过，${fail.length} 挂`);
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
