// 气泡版式：顶上一张方形封面与署名，下面一段一个长气泡，气泡里按句断行
import { BASE, OUT, EXE, chromium } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2});
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const cons=[]; page.on('console',m=>{ if (m.type()==='error') cons.push(m.text()); });
await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
if (await page.locator('.lock-unlock').count()) { await page.locator('.lock-unlock').click(); await page.waitForTimeout(300); }
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};
const shot = n => page.screenshot({ path:`${OUT}/bb-${n}.png`, fullPage:false });
const text = () => page.evaluate(()=>document.body.innerText);

// ---- 按句断行 ----
const lines = await page.evaluate(async () => {
  const m = await import('/src/ui/prose.js');
  return {
    two: m.linesOf('雨还没停。他没有抬头。'),
    keep: m.linesOf('「你来得比我想的早。」他说。'),
    para: m.linesOf('第一段。\n第二段？第三段！'),
    empty: m.linesOf(''),
  };
});
ok('一句一行', lines.two.length===2 && lines.two[0]==='雨还没停。', JSON.stringify(lines.two));
ok('收口的引号算在前一句里', lines.keep[0]==='「你来得比我想的早。」', JSON.stringify(lines.keep));
ok('换行与句号都断', lines.para.length===3, JSON.stringify(lines.para));
ok('空正文不产生空行', lines.empty.length===0, JSON.stringify(lines.empty));

const ids = await page.evaluate(async () => {
  const db=await import('/src/system/db/index.js');
  const work=await import('/src/system/work.js');
  const scene=await import('/src/system/scene.js');
  const png=async()=>new File([await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')).blob()],'a.png',{type:'image/png'});
  const c=db.characters.create({name:'阿岚',persona:'x'});
  const chat=db.chats.create({characterIds:[c.id],lastMessageAt:Date.now()});
  const w=work.create({ chatId: chat.id, kind: work.SAGA, title:'雨落之前',
    charAs:{ name:'沈砚' }, meAs:{ name:'林一' }, opening:'me' });
  const cp=work.addChapter(w.id, { title:'到站', place:'车站' });
  scene.addBeat({ sceneId: cp.id, role:'char', authorId:c.id, at:'19:40',
    text:'雨还没停。他站在檐下，手里捏着一张票根。\n「你来得比我想的早。」他没有抬头。' });
  scene.addBeat({ sceneId: cp.id, role:'me', text:'我把伞收起来，靠在门边。没有说话。' });
  const cover=await db.images.put(await png());
  work.update(w.id, { cover });
  // 线下那边也建一场，同一档版式要一起生效
  const sc=scene.create({ chatId: chat.id, title:'旧书店', place:'旧书店', castIds:[c.id] });
  scene.addBeat({ sceneId: sc.id, role:'char', authorId:c.id, text:'门上的铃响了一声。他抬起头。' });
  return { charId:c.id, chatId:chat.id, workId:w.id, chapterId:cp.id, sceneId:sc.id, cover };
});

const go = async (app, r) => {
  await page.evaluate(async ([app, r]) => {
    const nav=await import('/src/system/nav.js');
    nav.goHome(); nav.openApp(app, '/'); nav.popToRoot();
    if (r !== '/') nav.push(r);
  }, [app, r]);
  await page.waitForTimeout(500);
};
const setLayout = v => page.evaluate(async v => {
  const stage=await import('/src/system/stage.js'); stage.set({ layout: v });
}, v);

// ---- 我们：气泡档 ----
await setLayout('bubble');
await go('us', `/read/${ids.chapterId}`);
await page.waitForTimeout(500);
await shot('us');
const n = await page.evaluate(() => ({
  bubs: document.querySelectorAll('.sg-bub').length,
  mine: document.querySelectorAll('.sg-bub.is-mine').length,
  cover: document.querySelectorAll('.sg-cover, .wk-hero').length,
  who: [...document.querySelectorAll('.sg-bub-who')].map(e=>e.textContent),
  lyricLines: document.querySelectorAll('.sg-bub .sg-lyric p').length,
  said: document.querySelectorAll('.sg-lyric p.is-said').length,
  foot: document.querySelectorAll('.sg-foot').length,
}));
ok('两段各一个长气泡', n.bubs===2, JSON.stringify(n));
ok('自己写的那一段不填底', n.mine===1, n.mine);
ok('正文页上面没有封面', n.cover===0, n.cover);
ok('气泡上写了是谁写的，用的是作品里的名字', n.who.includes('沈砚') && n.who.includes('林一'), JSON.stringify(n.who));
ok('按句断行，不是整段一块', n.lyricLines>=5, n.lyricLines);
ok('对白那一行重一点', n.said>=1, n.said);
ok('这一档没有页码', n.foot===0, n.foot);

// ---- 扉页：点进一部作品先看到封面与目录 ----
await go('us', `/work/${ids.workId}`);
await page.waitForTimeout(500);
await shot('hero');
const h = await page.evaluate(() => {
  const b = document.querySelector('.wk-hero-art')?.getBoundingClientRect();
  return {
    hero: document.querySelectorAll('.wk-hero').length,
    art: !!document.querySelector('.wk-hero-art img'),
    square: b ? Math.abs(b.width - b.height) < 2 : false,
    big: b ? b.width > 140 : false,
    title: document.querySelector('.wk-hero-title')?.textContent || '',
    names: document.querySelector('.wk-hero-names')?.textContent || '',
    meta: document.querySelector('.wk-hero-meta')?.textContent || '',
    paper: getComputedStyle(document.querySelector('.wk-hero')).backgroundColor,
    toc: document.body.innerText,
  };
});
ok('扉页上有一张大的方形封面', h.hero===1 && h.square && h.big, JSON.stringify(h));
ok('封面用的是作品自己那张图', h.art);
ok('封面下面是标题、参与的人、体裁与进度',
  h.title==='雨落之前' && /沈砚/.test(h.names) && /林一/.test(h.names)
  && /长篇/.test(h.meta) && /章/.test(h.meta), JSON.stringify(h));
ok('扉页用的是作品自己的纸色', h.paper==='rgb(252, 251, 248)', h.paper);
ok('封面下面就是目录', /目录/.test(h.toc) && /第 1 章/.test(h.toc), h.toc.replace(/\n+/g,' / ').slice(0,200));

// 没有图时不摆一个灰方块，用标题的头一个字排一张
await page.evaluate(async ({workId}) => {
  const work=await import('/src/system/work.js'); work.update(workId, { cover: null });
}, ids);
await page.waitForTimeout(400);
const g = await page.evaluate(() => ({
  img: !!document.querySelector('.wk-hero-art img'),
  glyph: document.querySelector('.wk-hero-glyph')?.textContent || '',
}));
ok('没有图时用标题的头一个字排一张', !g.img && g.glyph==='雨', JSON.stringify(g));
await page.evaluate(async ({workId, cover}) => {
  const work=await import('/src/system/work.js'); work.update(workId, { cover });
}, ids);

await go('us', `/read/${ids.chapterId}`);
await page.waitForTimeout(400);

// 长按一段还是出菜单
// 长按那个计时器是 520 毫秒，等够再看
await page.locator('.sg-bub').first().dispatchEvent('contextmenu');
await page.waitForTimeout(900);
ok('长按气泡出这一段的菜单', /重写/.test(await text()) && /删除这一段/.test(await text()), (await text()).slice(-200));
await page.keyboard.press('Escape'); await page.waitForTimeout(300);

// ---- 线下：同一档版式 ----
await go('chat', `/scene/${ids.sceneId}`);
await page.waitForTimeout(600);
await shot('scene');
const s2 = await page.evaluate(() => ({
  bubs: document.querySelectorAll('.sg-bub').length,
  cover: document.querySelectorAll('.sg-cover, .wk-hero').length,
  lines: document.querySelectorAll('.sg-bub .sg-lyric p').length,
}));
ok('线下也吃这一档', s2.bubs===1 && s2.lines>=2, JSON.stringify(s2));
ok('线下正文页上面同样没有封面', s2.cover===0, JSON.stringify(s2));

// ---- 换回阅读那两档，原样还在 ----
await setLayout('page');
await go('us', `/read/${ids.chapterId}`);
await page.waitForTimeout(500);
await shot('us-page');
ok('换回翻页还是翻页', await page.locator('.sg-bub').count()===0
  && await page.locator('.sg-foot').count()===1);
await setLayout('cards');
await page.waitForTimeout(500);
await shot('us-cards');
ok('换成明信片还是明信片', await page.locator('.sg-card').count()>=1
  && await page.locator('.sg-bub').count()===0);

// 深色主题下也看一眼
await setLayout('bubble');
await page.evaluate(async()=>{ const stage=await import('/src/system/stage.js'); stage.set({ theme:'night' }); });
await page.waitForTimeout(500);
await shot('us-night');
await page.evaluate(async()=>{ const stage=await import('/src/system/stage.js'); stage.set({ theme:'body' }); });

ok('没有页面错误', errs.length===0, errs[0]);
ok('没有 console.error', cons.length===0, cons[0]);
const bad=R.filter(r=>!r.pass).length;
console.log(bad? `\n${bad} 项挂` : `\n全部通过（${R.length} 项）`);
await browser.close();
process.exit(bad?1:0);
