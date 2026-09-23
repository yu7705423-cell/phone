// 主页（Instagram 式）：数字、网格、列表、精选、详情页、封面入口
import { BASE, OUT, EXE, chromium, PNG_PATH } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1500);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const seed = await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js'));
  const mk = async (color) => { const c=document.createElement('canvas'); c.width=300; c.height=300;
    const g=c.getContext('2d'); g.fillStyle=color; g.fillRect(0,0,300,300);
    const blob=await new Promise(r=>c.toBlob(r,'image/png')); return db.images.put(new File([blob],'x.png',{type:'image/png'}), 512); };
  const me = db.personas.all()[0] || db.personas.create({ name:'我' });
  db.personas.update(me.id, { name:'阿岚', signature:'签名一句' });
  // 头像换过：avatarBase 与 avatar 不同，「原本的」那一块才会出现。
  // 不设的话，按钮行那几条断言在旧版式上也照样过 —— 测了个寂寞
  const ch = db.characters.create({ name:'桐生', signature:'夜里才醒的人',
    avatar: await mk('#5c6b7a'), avatarBase: await mk('#2c3b4a') });
  const other = db.characters.create({ name:'配角' });
  (await import('/src/system/ai/tasks/card.js')).link(ch.id, other.id, '朋友', '朋友');
  // 我：两条带图（一条两张）、一条纯文字；角色：一条带图
  db.moments.create({ authorId:'me', text:'甲', images:[await mk('#c00')], likes:[], comments:[], createdAt: Date.now()-1000 });
  db.moments.create({ authorId:'me', text:'乙', images:[await mk('#0c0'), await mk('#00c')], likes:[], comments:[], createdAt: Date.now()-2000 });
  db.moments.create({ authorId:'me', text:'丙 纯文字', images:[], likes:[], comments:[], createdAt: Date.now()-3000 });
  db.moments.create({ authorId: ch.id, text:'角色的', images:[await mk('#cc0')], likes:[], comments:[], createdAt: Date.now()-4000 });
  return { me: me.id, ch: ch.id, chars: db.characters.all().filter(c=>!c.parentId).length };
});
await page.evaluate(async () => { const n=await import('/src/system/nav.js'); n.unlock(); n.openApp('chat','/'); });
await page.waitForTimeout(600);
await page.locator('.tabbar .tab').filter({hasText:'主页'}).first().click();
await page.waitForTimeout(700);

// ---- 头部 ----
const stats = await page.locator('.ig-stat b').allTextContents();
ok('三个数字：动态 3、照片 3、联系人 N', stats.join(',') === `3,3,${seed.chars}`, stats.join(','));
const labels = await page.locator('.ig-stat span').allTextContents();
ok('我的主页第三个数字叫「联系人」', labels[2] === '联系人', labels.join(','));
ok('名字与签名在，人设不在', await page.locator('.ig-name').textContent() === '阿岚'
  && await page.locator('.ig-sign').textContent() === '签名一句', '');
ok('页面上没有封面', await page.locator('.profile-cover, .ig .mo-header').count() === 0);

// ---- 网格 ----
ok('网格一格一条带图的动态（纯文字那条不占格）', await page.locator('.ig-cell').count() === 2, String(await page.locator('.ig-cell').count()));
ok('多图那条角上有标记', await page.locator('.ig-cell-multi').count() === 1);
await page.locator('.ig-cell').first().click(); await page.waitForTimeout(600);
ok('点一格进详情页', await page.locator('.ig-author').count() === 1 && /甲/.test(await page.locator('.ig-text').textContent()));
ok('详情页右上角能删（自己发的）', await page.locator('.navbar [aria-label="删除"]').count() === 1);
// 详情页里写评论
await page.locator('.ig-comments textarea').fill('好看');
await page.locator('.ig-comments .send-btn').click(); await page.waitForTimeout(400);
ok('详情页里评论直接追加', /好看/.test(await page.locator('.ig-comments').textContent()));
await page.locator('.navbar [aria-label="返回"]').click(); await page.waitForTimeout(500);

// ---- 列表 ----
await page.locator('.ig-tab').nth(1).click(); await page.waitForTimeout(400);
ok('列表分栏三条都在（含纯文字）', await page.locator('.ig .mo-card').count() === 3, String(await page.locator('.ig .mo-card').count()));
ok('列表里评论数跟着变', /1/.test(await page.locator('.ig .mo-card').first().locator('.mo-act').nth(1).textContent()));

// ---- 精选：传一张图、起名、改名、删 ----
page.once('dialog', d => d.dismiss());
const fs = await import('node:fs/promises');
await fs.writeFile(`${OUT}/hl.png`, Buffer.from((await fs.readFile(PNG_PATH,'utf-8')).trim(), 'base64'));
await page.locator('.ig-hl input[type=file]').setInputFiles(`${OUT}/hl.png`);
await page.waitForTimeout(500);
ok('传完图弹出起名', await page.locator('.modal input, .modal textarea').count() >= 1);
await page.locator('.modal input, .modal textarea').first().fill('夏天');
await page.locator('.modal-btn').filter({hasText:'保存'}).click(); await page.waitForTimeout(400);
ok('圆圈出现，名字在下面', await page.locator('.ig-hl-item span').filter({hasText:'夏天'}).count() === 1);
const stored = await page.evaluate(async () => {
  const db=(await import('/src/system/db/index.js')); const p=(await import('/src/system/purge.js'));
  const me = db.personas.all()[0]; const h = (me.highlights||[])[0];
  return { n: (me.highlights||[]).length, title: h?.title, used: h ? p.usedImageIds().has(h.imageId) : false };
});
ok('精选存在本人那一行上', stored.n === 1 && stored.title === '夏天', JSON.stringify(stored));
ok('精选的图登进了引用表（清理无引用时不会被删）', stored.used === true);
await page.locator('.ig-hl-item').first().click(); await page.waitForTimeout(400);
ok('点圆圈打开大图', await page.locator('.ig-hl-view').count() === 1);
await page.screenshot({path:`${OUT}/ig-hl.png`});
await page.locator('.sheet button').filter({hasText:'改名'}).click(); await page.waitForTimeout(300);
await page.locator('.modal input, .modal textarea').first().fill('冬天');
await page.locator('.modal-btn').filter({hasText:'保存'}).click(); await page.waitForTimeout(300);
ok('改名生效', await page.locator('.ig-hl-item span').filter({hasText:'冬天'}).count() === 1);
await page.locator('.sheet button').filter({hasText:'删除'}).click(); await page.waitForTimeout(300);
await page.locator('.modal-btn').filter({hasText:'确定'}).click(); await page.waitForTimeout(400);
ok('删了圆圈就没了', await page.locator('.ig-hl-item').count() === 1);   // 只剩「新建」

// ---- 角色主页 ----
await page.evaluate(async (id) => { const n=await import('/src/system/nav.js'); n.push(`/profile/${id}`); }, seed.ch);
await page.waitForTimeout(600);
const cs = await page.locator('.ig-stat b').allTextContents();
ok('角色：动态 1、照片 1、关系 1', cs.join(',') === '1,1,1', cs.join(','));
ok('换过头像，所以「原本的」那一块在', await page.locator('.ig-face .ig-face-base').count() === 1);
ok('角色页两个按钮：发消息、编辑资料', await page.locator('.ig-acts .btn').count() === 2
  && /发消息/.test(await page.locator('.ig-acts').textContent()) && /编辑资料/.test(await page.locator('.ig-acts').textContent()));
// 「原本的」从前挤在这一行里，比按钮高一截，把两个按钮挤得既不满宽也不居中
const row = await page.evaluate(() => {
  const w = el => (el ? Math.round(el.getBoundingClientRect().width) : 0);
  const b = [...document.querySelectorAll('.ig-acts .btn')];
  const acts = document.querySelector('.ig-acts');
  return { ws: b.map(w), h: Math.round(acts.getBoundingClientRect().height),
    pad: Math.round(acts.getBoundingClientRect().width) - (w(b[0]) + w(b[1])),
    chip: acts.querySelectorAll('.ig-face-base, .face-base').length };
});
ok('两个按钮一样宽', row.ws[0] === row.ws[1] && row.ws[0] > 150, JSON.stringify(row));
ok('按钮行里没有别的东西（原本的头像不在这儿）', row.chip === 0, JSON.stringify(row));
ok('两个按钮加起来铺满一行（只剩左右边距与中缝）', row.pad <= 48, JSON.stringify(row));
ok('删除角色不在主页上（入口只在编辑资料那一页）', !/删除该角色/.test(await page.locator('.page').last().textContent()));

// ---- 封面入口搬到朋友圈 ----
await page.evaluate(async () => { const n=await import('/src/system/nav.js'); n.popToRoot(); });
await page.waitForTimeout(400);
await page.locator('.tabbar .tab').filter({hasText:'朋友圈'}).first().click(); await page.waitForTimeout(500);
ok('朋友圈顶部有换封面的按钮', await page.locator('.mo-header [aria-label="更换封面"]').count() === 1);
await page.locator('.mo-header input[type=file]').setInputFiles(`${OUT}/hl.png`); await page.waitForTimeout(600);
const cov = await page.evaluate(async () => (await import('/src/system/db/index.js')).personas.all()[0].cover);
ok('换封面写进本人那一行', !!cov, String(cov));
ok('朋友圈里点动态的图进详情', (await page.locator('.mo-photos').first().click(), await page.waitForTimeout(500), await page.locator('.ig-author').count() === 1));

ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
