// 生成器新加的那几组：换图标、位移、连着的第一条/最后一条、小尾巴、时刻改名、位置撞车
import { BASE, OUT, EXE, chromium, PNG_PATH } from './_env.mjs';
const browser = await chromium.launch({ executablePath:EXE, args:['--no-sandbox'] });
const page = await (await browser.newContext({viewport:{width:430,height:932},isMobile:true,hasTouch:true,deviceScaleFactor:2})).newPage();
// 页面里的代码也用得到 BASE（假接口就挂在同一个地址下）
await page.addInitScript(b => { window.BASE = b; }, BASE);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const fs = await import('node:fs/promises');
const PNG = (await fs.readFile(PNG_PATH,'utf-8')).trim();
await page.goto(`${BASE}/index.html`,{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1800);
const R=[]; const ok=(n,c,e)=>{R.push({n,pass:!!c});console.log(`${c?'  ok  ':'  FAIL'} ${n}${c?'':'   << '+(e??'')}`);};

const lg = await page.evaluate(async (b64) => {
  const g = await import('/src/system/skin-gen.js');
  const url = `data:image/png;base64,${b64}`;
  const o = {};
  // 换图标
  o.icon = g.emit({ nav: { backImg:url, backSize:26, backX:8, backY:-2 } });
  // 只藏不换
  o.hide = g.emit({ nav: { actHide:true } });
  // 底栏三个图标
  o.bar = g.emit({ composer: { plusImg:url, stkHide:true, sendImg:url, sendSize:30 } });
  // 顶栏标题位移与改色
  o.title = g.emit({ nav: { titleColor:'#334455', titleSize:19, titleX:-20, titleY:3 } });
  // 顶栏挂图
  o.navDeco = g.emit({ navDeco: { img:url, pos:'tr', size:60, over:true } });
  // 消息区
  o.msg = g.emit({ msg: { top:90, bottom:20, sideP:18, gap:26, gapIn:3, align:'center', width:70 } });
  // 头像：连着的第一条 / 最后一条
  o.first = g.emit({ avatar: { run:'first' } });
  o.last = g.emit({ avatar: { run:'last' } });
  // 小尾巴
  o.tail = g.emit({ tail: { on:true, size:9, y:12, which:'first', run:'all', slot:'before' } });
  o.tailLast = g.emit({ tail: { on:true, which:'last', run:'last' } });
  // 时刻：居中、改名、隐藏
  o.meta = g.emit({ meta: { pos:'center', color:'#99aabb', size:12, readText:'看过了' } });
  o.metaHide = g.emit({ meta: { hideStamp:true, hideRead:true } });
  o.metaEvil = g.emit({ meta: { readText:'a"}body{display:none}.x{content:"' } });
  // 贴图挂到别的元素上
  o.decoCol = g.emit({ deco1: { img:url, host:'col', slot:'after', size:30 } });
  o.decoRow = g.emit({ deco2: { img:url, host:'row', slot:'before', size:30 } });
  o.decoFirst = g.emit({ deco1: { img:url, host:'bubble', which:'first', size:30 } });
  // 撞车
  o.clash = g.conflictsOf({
    border:{ w:3, c:'#111111', grad:true, g2:'#eeeeee', gSlot:'before' },
    tail:{ on:true, slot:'before' },
  });
  o.clash2 = g.conflictsOf({
    deco1:{ img:url, host:'bubble', slot:'after' },
    deco2:{ img:url, host:'bubble', slot:'after' },
  });
  o.noClash = g.conflictsOf({
    deco1:{ img:url, host:'bubble', slot:'after' },
    deco2:{ img:url, host:'col', slot:'after' },
  });
  o.groups = g.GROUPS.map(x => x.id);
  return o;
}, PNG);

ok('分组顺序是页面从上到下',
  JSON.stringify(lg.groups) === JSON.stringify(['nav','navDeco','msg','avatar','tail','meta',
    'bubble','border','deco1','deco2','composer']), JSON.stringify(lg.groups));

ok('换图标：把 svg 藏起来再给按钮铺图',
  /\.ph-back svg \{[\s\S]*opacity: 0/.test(lg.icon)
  && /\.ph-back \{[\s\S]*background-image: url\("data:image/.test(lg.icon), lg.icon.slice(0,300));
ok('换图标时按钮跟着位移', /translate\(8px, -2px\)/.test(lg.icon),
  (lg.icon.match(/transform:[^;]*/)||[''])[0]);
ok('设为透明只藏 svg，按钮本身不动',
  /\.ph-nav-action svg \{[\s\S]*opacity: 0/.test(lg.hide)
  && !/background-image/.test(lg.hide), lg.hide);
ok('底栏三个图标各走各的',
  /\.ph-plus svg/.test(lg.bar) && /\.ph-sticker-btn svg/.test(lg.bar)
  && /\.ph-send svg/.test(lg.bar), lg.bar.slice(0,200));
ok('顶栏标题能改色改字号并移动',
  /\.ph-nav-title \{/.test(lg.title) && /#334455/.test(lg.title)
  && /font-size: 19px/.test(lg.title) && /translate\(-20px, 3px\)/.test(lg.title), lg.title);
ok('顶栏能挂一张图，还能让它露出顶栏',
  /\.ph-navbar::after/.test(lg.navDeco) && /overflow: visible/.test(lg.navDeco), lg.navDeco.slice(0,240));

ok('第一条与顶部的距离写成了上内距',
  /\.ph-chat-body \{[\s\S]*padding-top: 90px/.test(lg.msg), lg.msg.slice(0,300));
// 间距一律走 margin：flex 的 gap 不接受负值，而「两条叠起来」正需要负值
ok('消息间距、同轮内间距、最大宽度各落各处',
  /\.ph-msg \{[\s\S]*margin-bottom: 26px/.test(lg.msg)
  && /\.ph-col > \.ph-bubble \+ \.ph-bubble \{[\s\S]*margin-top: 3px/.test(lg.msg)
  && /max-width: 70%/.test(lg.msg), lg.msg.slice(0,500));

ok('「只有第一条有头像」用相邻兄弟，不用 :has',
  /\.ph-msg-theirs \+ \.ph-msg-theirs \.ph-face/.test(lg.first) && !/:has/.test(lg.first), lg.first);
ok('「只有最后一条」用 :has', /\.ph-msg-theirs:has\(\+ \.ph-msg-theirs\)/.test(lg.last), lg.last);
ok('藏头像用 opacity，不抽掉盒子（不然气泡会错位）',
  /opacity: 0/.test(lg.first) && !/display: none/.test(lg.first), lg.first);

ok('小尾巴两边各画一个三角',
  /\.ph-bubble-theirs::before/.test(lg.tail) && /\.ph-bubble-mine::before/.test(lg.tail)
  && /border-right: 9px solid/.test(lg.tail), lg.tail.slice(0,400));
ok('小尾巴「只有第一个气泡有」',
  /\.ph-col > \.ph-bubble:not\(:first-child\)::before \{[\s\S]*display: none/.test(lg.tail), lg.tail.slice(-300));
ok('小尾巴也能只在连着的最后一条', /:has\(\+ \.ph-msg-theirs\)/.test(lg.tailLast), lg.tailLast.slice(-300));

ok('时刻整行居中', /\.ph-meta \{[\s\S]*justify-content: center/.test(lg.meta), lg.meta.slice(0,300));
ok('「已读」改名：原字压成 0 号，用 ::after 放新的',
  /\.ph-read \{[\s\S]*font-size: 0/.test(lg.meta)
  && /\.ph-read::after \{[\s\S]*content: "看过了"/.test(lg.meta), lg.meta.slice(-400));
ok('能各自隐藏时刻与已读',
  /\.ph-stamp \{[\s\S]*display: none/.test(lg.metaHide)
  && /\.ph-read \{[\s\S]*display: none/.test(lg.metaHide), lg.metaHide);
ok('改名那一句里的引号被转义，逃不出 content',
  /content: "a\\"\}body/.test(lg.metaEvil) && !/content: "a"\}/.test(lg.metaEvil),
  (lg.metaEvil.match(/content:[^\n]*/)||[''])[0]);

ok('贴图能挂到「这一轮」上', /\.ph-col::after/.test(lg.decoCol), lg.decoCol.slice(0,200));
ok('贴图能挂到「整行」上', /\.ph-msg::before/.test(lg.decoRow), lg.decoRow.slice(0,200));
ok('贴图能只贴一轮里的第一个气泡',
  /:not\(:first-child\)::after \{[\s\S]*display: none/.test(lg.decoFirst), lg.decoFirst.slice(-240));

ok('渐变边框和小尾巴抢同一个位置时报出来',
  lg.clash.length === 1 && lg.clash[0].who.length === 2, JSON.stringify(lg.clash));
ok('两张贴图抢同一个位置也报出来', lg.clash2.length === 1, JSON.stringify(lg.clash2));
ok('挂在不同元素上就不算撞车', lg.noClash.length === 0, JSON.stringify(lg.noClash));

// ---- 界面：撞车要显示出来 ----
const sid = await page.evaluate(async (b64) => {
  const skin=await import('/src/system/skin.js');
  const url = `data:image/png;base64,${b64}`;
  const s=skin.create({ name:'撞车', gen: {
    deco1:{ img:url, host:'bubble', slot:'after' },
    deco2:{ img:url, host:'bubble', slot:'after' } } });
  return s.id;
}, PNG);
await page.evaluate(async (id) => {
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('skin','/'); n.popToRoot(); n.push(`/gen/${id}`);
}, sid);
await page.waitForSelector('.gen-rail'); await page.waitForTimeout(1000);
// 竖栏上点一组，旋钮才展开
await page.locator('.gen-rail-btn').filter({hasText:'贴图一'}).first().click();
await page.waitForTimeout(700);
const t = await page.locator('.gen-panel').innerText();
const railText = await page.locator('.gen-rail').innerText();
ok('撞车在界面上说出来了', /都挂在同一个位置/.test(t), t.slice(0,300));
ok('十一组都在竖栏上，一下点得到',
  ['顶栏','挂图','消息','头像','尾巴','时刻','气泡','边框','贴图一','贴图二','底栏']
    .every(x => railText.includes(x)), railText.replace(/\n/g,' '));
ok('总样式也在竖栏上', /总样式/.test(railText), railText.replace(/\n/g,' '));

await page.screenshot({path:`${OUT}/gen2.png`, fullPage:true});
ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
