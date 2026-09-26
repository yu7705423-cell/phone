// 长篇向导与分层大纲（ARCHITECTURE 4.263）
//
//   一、向导：选标签、篇幅、写灵感，「生成简介」一次请求填上标题与简介
//   二、大纲设为隐藏：「生成大纲」一次请求（短篇连章纲一起）；建立后作品上有总纲、卷、章纲，界面上不显示内容
//   三、作品页：隐藏大纲只写「几卷、写到哪」；揭晓到目前为止（还没写就没有）；全部揭晓后看得到章纲
//   四、新的一章：题目从章纲带上；写章的提示词里有大纲、本章那一行与进度
//   五、可见大纲的作品页直接列出；无大纲的作品页可以生成
//   六、章末分支（4.264）：新的一章先问怎么开；「给我几个走向」一次请求，候选数可填；选了偏离大纲的，
//       章上记着走向、作品上记着偏离；作品页多一条「重排后续大纲」，点了一次请求，偏离标记清掉
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
const calls = [];
await ctx.route('**/relay.example.com/**', async route => {
  const body = JSON.parse(route.request().postData() || '{}');
  const sys = (body.messages || []).map(m => (typeof m.content === 'string' ? m.content : '')).join('\n');
  let out;
  if (/planning a novel\. Write a title/.test(sys)) {
    calls.push('synopsis');
    out = { title: '雨落之前', synopsis: '两个人在一座常年下雨的城市重新认识。', secret: '真正的凶手是旧书店的老板。' };
  } else if (/planning the whole structure/.test(sys)) {
    calls.push('outline');
    out = { master: { mainline: '林一追查一桩旧案', subline: '沈砚隐瞒的身份', ending: '真相揭晓，两人分别', twists: ['书店地下室'], arcs: ['林一：从旁观到卷入'] },
      volumes: [{ no: 1, title: '到站', goal: '认识与试探', from: 1, to: 4, reveal: '旧案存在', chapters: [
        { no: 1, title: '到站', line: '林一在雨夜到站，投宿旧书店楼上。' }, { no: 2, title: '书店', line: '发现一本被撕页的旧书。' },
        { no: 3, title: '雨停', line: '沈砚说起十年前。' }, { no: 4, title: '地下室', line: '林一找到地下室的门。' }] },
      { no: 2, title: '真相', goal: '揭晓', from: 5, to: 8, reveal: '凶手', chapters: [
        { no: 5, title: '钥匙', line: '钥匙在沈砚手里。' }, { no: 6, title: '对峙', line: '两人对峙。' }, { no: 7, title: '告白', line: '沈砚说出全部。' }, { no: 8, title: '离开', line: '林一离开这座城。' }] }] };
  } else if (/planning one volume/.test(sys)) {
    calls.push('volume');
    out = { chapters: [{ no: 1, title: '到站', line: '林一到站。' }] };
  } else if (/proposing what the next chapter/.test(sys)) {
    calls.push('branch');
    const n = (sys.match(/Give (\d+)\s+distinct/) || [])[1];
    out = { options: [{ title: '书店', line: '照大纲：发现被撕页的旧书。', follows: true },
      { title: '离城', line: '林一决定当晚离开这座城。', follows: false }, { title: '雨夜', line: '第三个走向。', follows: true }].slice(0, Number(n) || 3) };
  } else if (/departed from its outline/.test(sys)) {
    calls.push('replan');
    const from = Number((sys.match(/from\s+chapter (\d+) to chapter/) || [])[1]) || 2;
    out = { master: { mainline: '林一离城后被旧案追上', ending: '在另一座城重逢' }, volumes: [{ no: 1, title: '离城之后', goal: '追上', from, to: 8, reveal: '凶手', chapters: [{ no: from, title: '车站', line: '林一在车站被拦下。' }] }] };
  } else { calls.push('other'); out = { text: '嗯' }; }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(out) } }] }) });
});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const ev = (fn, arg) => page.evaluate(fn, arg);
const text = () => ev(() => document.body.innerText);

const ids = await ev(async () => {
  const { db } = await import('/src/system/db/index.js');
  const svc = await import('/src/system/ai/services.js');
  const p = svc.newChatPreset({ name: '甲', provider: 'openai' });
  svc.updateChatPreset(p.id, { baseUrl: 'https://relay.example.com/v1', apiKey: 'k', model: 'm1' });
  svc.setActiveChat(p.id);
  const a = db.characters.create({ name: '沈砚', persona: '旧书店的老板，话少。' });
  const n = await import('/src/system/nav.js'); n.unlock(); n.openApp('us', '/new');
  return { a: a.id };
});
await page.waitForTimeout(800);

// 一
await page.locator('.seg-item', { hasText: '直接选人物' }).click();
await page.locator('.list-item', { hasText: '沈砚' }).click();
await page.locator('.chip', { hasText: /^悬疑$/ }).click();
await page.locator('.chip', { hasText: /^HE$/ }).click();
await page.locator('.seg-item', { hasText: /^短篇$/ }).click();
await page.locator('textarea').nth(0).fill('一座常年下雨的城市');
await page.locator('.seg-item', { hasText: /^隐藏$/ }).click();
await page.locator('button', { hasText: '生成简介' }).click();
await page.waitForTimeout(1500);
// 输入框里的字不在 innerText 里，单独读
const t1 = await ev(() => [...document.querySelectorAll('input, textarea')].map(e => e.value).join('\n') + '\n' + document.body.innerText);
ok('一、生成简介：标题与简介填上了', /雨落之前/.test(t1) && /重新认识/.test(t1) && calls.filter(x => x === 'synopsis').length === 1, `${calls} ${t1.slice(0, 120)}`);
ok('一、隐藏大纲那一档：作者私纲不显示', !/真正的凶手/.test(t1));

// 二
await page.locator('button', { hasText: '生成大纲' }).click();
await page.waitForTimeout(1500);
const t2 = await text();
ok('二、生成大纲（短篇一次连章纲）：界面只说几卷，不露内容', calls.filter(x => x === 'outline').length === 1 && /大纲已生成：2 卷/.test(t2) && !/林一追查/.test(t2) && !/地下室/.test(t2), `${calls} ${t2.slice(0, 200)}`);
await page.locator('button', { hasText: /^建立$/ }).click();
await page.waitForTimeout(800);
const w = await ev(async () => (await import('/src/system/work.js')).all()[0]);
const o = await ev(async id => { const n = await import('/src/system/novel.js'); const w = (await import('/src/system/work.js')).get(id); return { o: n.outlineOf(w), line3: n.lineOf(w, 3), vol6: n.volumeOf(w, 6)?.no }; }, w?.id);
ok('二、建出来的作品：标签、篇幅、简介、私纲、隐藏大纲都在', w && w.genres.includes('悬疑') && w.length.chapters === 8 && /重新认识/.test(w.premise) && /凶手/.test(w.secret) && o.o.mode === 'hidden' && o.o.volumes.length === 2 && o.line3?.title === '雨停' && o.vol6 === 2, JSON.stringify({ g: w?.genres, len: w?.length, mode: o?.o?.mode, line3: o?.line3 }));

// 三
const t3 = await text();
ok('三、作品页：隐藏大纲只写几卷写到哪，不露章纲', /大纲已隐藏/.test(t3) && /2 卷 · 已写 0 章 \/ 预计 8 章/.test(t3) && !/地下室/.test(t3), t3.slice(0, 400));
await page.locator('.list-item', { hasText: '揭晓到目前为止' }).click();
await page.waitForTimeout(300);
ok('三、还没写到任何一章：揭晓不出东西', /没有可揭晓的内容/.test(await text()) && !/地下室/.test(await text()));
await page.locator('.list-item', { hasText: '全部揭晓' }).click();
await page.waitForTimeout(300);
const t3b = await text();
ok('三、全部揭晓：总纲与章纲都看得到', /林一追查/.test(t3b) && /地下室/.test(t3b) && /第 1 卷的章纲/.test(t3b), t3b.slice(0, 200));
await page.locator('.list-item', { hasText: '重新隐藏' }).click();
await page.waitForTimeout(200);

// 四
await page.locator('.navbar [aria-label="新的一章"]').click();
await page.waitForTimeout(400);
await page.locator('.list-item', { hasText: '自己写下一章' }).click();
await page.waitForTimeout(800);
const ch = await ev(async id => (await import('/src/system/work.js')).chaptersOf(id)[0], w.id);
ok('四、新的一章：题目从章纲带上', ch && ch.no === 1 && ch.title === '到站', JSON.stringify(ch));
const sys = await ev(async ({ id, cid }) => {
  const work = await import('/src/system/work.js');
  const engine = await import('/src/system/ai/engine.js');
  const { db } = await import('/src/system/db/index.js');
  const w = work.get(id);
  return engine.buildWorkSystem(w, work.getChapter(cid), db.characters.get(w.castIds[0]), []).system;
}, { id: w.id, cid: ch?.id });
ok('四、写章的提示词：带着总纲、当前卷、本章那一行与进度', /\[大纲\]/.test(sys) && /林一追查/.test(sys) && /当前卷：第 1 卷/.test(sys) && /本章：到站　林一在雨夜到站/.test(sys) && /chapter 1 of 8/.test(sys), sys.slice(sys.indexOf('[大纲]'), sys.indexOf('[大纲]') + 400));

// 五
const w2 = await ev(async o => {
  const work = await import('/src/system/work.js');
  const row = work.create({ kind: work.SAGA, castIds: [o.a], title: '无纲', premise: '一段简介。', length: { chapters: 30, perChapter: 3000 } });
  const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('us', `/work/${row.id}`);
  return row.id;
}, ids);
await page.waitForTimeout(800);
const t5 = await text();
ok('五、无大纲的作品页：可以生成（可见 / 隐藏各一条）', /无大纲，自由创作/.test(t5) && /生成大纲（可见）/.test(t5) && /生成大纲（隐藏）/.test(t5), t5.slice(0, 300));
await page.locator('.list-item', { hasText: '生成大纲（可见）' }).click();
await page.waitForTimeout(1500);
const t5b = await text();
ok('五、生成后直接列出总纲与卷', /林一追查/.test(t5b) && /第 1 卷/.test(t5b), t5b.slice(0, 300));

// 六
await ev(async id => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('us', `/work/${id}`); }, w.id);
await page.waitForTimeout(800);
await page.locator('.navbar [aria-label="新的一章"]').click();
await page.waitForTimeout(400);
const t6 = await text();
ok('六、新的一章先问怎么开：三条路都在，大纲里这一章那一行带着', /自己写下一章/.test(t6) && /让它接着写/.test(t6) && /给我几个走向/.test(t6), t6.slice(0, 300));
await ev(async () => { const { db } = await import('/src/system/db/index.js'); db.settings.set({ novelBranchCount: 2 }); });
await page.locator('.list-item', { hasText: '给我几个走向' }).click();
await page.locator('.list-item', { hasText: '离城' }).waitFor({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(200);
const t6b = await text();
ok('六、给我几个走向：一次请求，候选数按填的来', calls.filter(x => x === 'branch').length === 1 && /照大纲/.test(t6b) && /离城/.test(t6b) && !/第三个走向/.test(t6b) && /偏离大纲/.test(t6b),
  JSON.stringify({ calls, a: /照大纲/.test(t6b), b: /离城/.test(t6b), c: /第三个走向/.test(t6b), d: /偏离大纲/.test(t6b), sheet: t6b.slice(t6b.indexOf('选一个走向'), t6b.indexOf('选一个走向') + 200) }));
await page.locator('.list-item', { hasText: '离城' }).click();
await page.waitForTimeout(800);
const after = await ev(async id => {
  const work = await import('/src/system/work.js'); const novel = await import('/src/system/novel.js');
  const w = work.get(id); const ch = work.chaptersOf(id).slice(-1)[0];
  return { no: ch.no, title: ch.title, plan: ch.plan, drift: novel.outlineOf(w).drift };
}, w.id);
ok('六、选了偏离大纲的走向：章上记着走向，作品上记着偏离', after.no === 2 && after.title === '离城' && /离开这座城/.test(after.plan) && after.drift === true, JSON.stringify(after));
const sys2 = await ev(async id => {
  const work = await import('/src/system/work.js'); const engine = await import('/src/system/ai/engine.js'); const { db } = await import('/src/system/db/index.js');
  const w = work.get(id); const ch = work.chaptersOf(id).slice(-1)[0];
  return engine.buildWorkSystem(w, ch, db.characters.get(w.castIds[0]), []).system;
}, w.id);
ok('六、写这一章：提示词里带着选定的走向与「已偏离」', /本章走向（已选定）：林一决定当晚离开/.test(sys2) && /left the outline/.test(sys2), sys2.slice(sys2.indexOf('[大纲]'), sys2.indexOf('[大纲]') + 500));
await ev(async id => { const n = await import('/src/system/nav.js'); n.goHome(); n.openApp('us', `/work/${id}`); }, w.id);
await page.waitForTimeout(800);
ok('六、作品页写着剧情已偏离，多一条重排', /剧情已偏离大纲/.test(await text()) && /按现在的走向重排后续大纲/.test(await text()));
await page.locator('.list-item', { hasText: '按现在的走向重排后续大纲' }).click();
await page.waitForTimeout(1500);
const re = await ev(async id => { const work = await import('/src/system/work.js'); const novel = await import('/src/system/novel.js'); return novel.outlineOf(work.get(id)); }, w.id);
ok('六、重排：一次请求，从第 3 章起换成新的卷，偏离标记清掉', calls.filter(x => x === 'replan').length === 1 && re.drift === false && re.volumes.length === 1 && re.volumes[0].from === 3 && /离城后/.test(re.master.mainline), JSON.stringify({ calls, vols: re.volumes, m: re.master.mainline }));

ok('没有页面错误', !errs.length, errs.join('\n'));
await browser.close();
const fail = R.filter(x => !x.pass).length;
console.log(`\n${R.length - fail}/${R.length} 项通过`);
process.exit(fail ? 1 : 0);
