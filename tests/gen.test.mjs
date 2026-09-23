// 生成器：旋钮真的改得动样板间，生成的 CSS 是干净的，导出导入带得走
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

// ---- 纯逻辑：emit ----
const lg = await page.evaluate(async (b64) => {
  const g = await import('/src/system/skin-gen.js');
  const url = `data:image/png;base64,${b64}`;
  const out = {};
  out.blankCss = g.emit({});
  out.blankTouched = g.touched({});
  const v = {
    bubble: { side:'theirs', bg:'#ffeedd', fg:'#332211', r:20, px:16, py:10, fs:15 },
    border: { w:2, c:'#cc8844', shadow:12, shColor:'#000000', shOp:30, shY:3 },
    deco1:  { img:url, size:36, pos:'br', x:4, y:-2, rot:15, op:80 },
    avatar: { size:48, round:50, gap:10, frameTheirs:url, frameScale:180 },
    nav:    { bg:'#ffeedd', fg:'#332211', h:56, line:true },
    composer:{ bg:'#fff8f0', btn:44, inBg:'#ffffff', inR:22, sendBg:'#cc8844' },
    msg:    { bg:'#fdf7f0', gap:22, align:'center' },
    meta:   { color:'#998877' },
  };
  out.css = g.emit(v);
  out.touched = g.touched(v);
  out.weigh = g.weigh(v);
  // 渐变边框与角落贴图二互斥
  // 渐变边框默认占前一个位置，贴图二也默认前一个 —— 这是一次撞车，
  // 现在的做法是照常生成、把撞车报出来，而不是静静吃掉一个
  const both = { border:{ w:3, c:'#111111', grad:true, g2:'#eeeeee' }, deco2:{ img:url, size:30 } };
  out.bothCss = g.emit(both);
  out.bothClash = g.conflictsOf(both);
  // 只填一项也要出东西
  out.oneCss = g.emit({ bubble: { bg:'#123456' } });
  // 认不出的图一律不写进去
  out.evilCss = g.emit({ deco1: { img:'https://x/y.png', size:20 } });
  out.evilCss2 = g.emit({ bubble: { bg:'javascript:alert(1)' } });
  return out;
}, PNG);

ok('什么都没调时不生成任何东西', lg.blankCss === '' && lg.blankTouched === false,
  JSON.stringify([lg.blankCss.slice(0,40), lg.blankTouched]));
ok('调了就认得出来', lg.touched === true);
ok('只填一项也出得来', /#123456/.test(lg.oneCss), lg.oneCss.slice(0,120));
ok('气泡那一组落在选中的那一边',
  /\.ph-bubble-theirs \{/.test(lg.css) && !/\.ph-bubble-mine \{/.test(lg.css),
  lg.css.slice(0,200));
ok('圆角内距字号都写出来了',
  /border-radius: 20px/.test(lg.css) && /padding-left: 16px/.test(lg.css)
  && /font-size: 15px/.test(lg.css), '');
ok('边框与投影写出来了',
  /border: 2px solid #cc8844/.test(lg.css) && /box-shadow: 0 3px 12px rgba\(0,0,0,0\.3\)/.test(lg.css),
  (lg.css.match(/box-shadow[^;]*/) || [''])[0]);
ok('角落贴图挂在 ::after 上并且不吃点击',
  /\.ph-bubble-theirs::after/.test(lg.css) && /pointer-events: none/.test(lg.css), '');
ok('贴图的位移与旋转都在',
  /translate\(4px, -2px\) rotate\(15deg\)/.test(lg.css),
  (lg.css.match(/transform:[^;]*/) || [''])[0]);
ok('有伪元素时父级补上了 position',
  /position: relative/.test(lg.css), '');
ok('头像大小、圆角、间距都写出来了',
  /\.ph-face \.ph-avatar \{/.test(lg.css) && /border-radius: 50%/.test(lg.css)
  && /\.ph-msg-theirs \.ph-face \{[\s\S]*margin-right: 10px/.test(lg.css), '');
ok('头像框只挂在角色那一边',
  /\.ph-msg-theirs \.ph-face::after/.test(lg.css) && !/\.ph-msg-mine \.ph-face::after/.test(lg.css), '');
ok('顶栏、底栏、发送键、背景各有一段',
  /\.ph-navbar \{/.test(lg.css) && /\.ph-composer \{/.test(lg.css)
  && /\.ph-send \{/.test(lg.css) && /\.ph-chat-body \{/.test(lg.css),
  lg.css.slice(0, 200));
ok('每一条都带 !important（应用自己的复合选择器特异度更高）',
  lg.css.split('\n').filter(l => /: /.test(l) && !/^\/\*/.test(l))
    .every(l => /!important;/.test(l)),
  lg.css.split('\n').filter(l => /: /.test(l) && !/!important/.test(l)).slice(0,3).join(' | '));
ok('渐变边框和贴图二抢同一个位置时报出来，而不是静静吃掉一个',
  /mask-composite/.test(lg.bothCss) && lg.bothClash.length === 1
  && lg.bothClash[0].who.length === 2, JSON.stringify(lg.bothClash));
ok('网络地址的图一律不写进去', lg.evilCss === '', lg.evilCss);
ok('不是颜色的值一律不写进去', lg.evilCss2 === '', lg.evilCss2);
ok('数得出内嵌了几张图、多少字节', lg.weigh.n === 2 && lg.weigh.bytes > 0, JSON.stringify(lg.weigh));

// ---- 界面：旋钮改得动预览 ----
const ids = await page.evaluate(async () => {
  const skin=await import('/src/system/skin.js');
  const s=skin.create({ name:'生成测试' });
  return { skinId:s.id };
});
await page.evaluate(async ({skinId}) => {
  const n=await import('/src/system/nav.js');
  n.unlock(); n.openApp('skin','/'); n.popToRoot(); n.push(`/gen/${skinId}`);
}, ids);
await page.waitForSelector('.gen-rail'); await page.waitForTimeout(1000);
ok('生成器是美化 app 里单独的一页，不必先挂到会话上',
  (await page.locator('.gen-rail-btn').count()) === 12,
  String(await page.locator('.gen-rail-btn').count()));

const bubbleStyle = () => page.evaluate(() => {
  const root = document.querySelector('.gen-stage')?.shadowRoot;
  const b = root?.querySelector('.ph-bubble-theirs');
  const nav = root?.querySelector('.ph-navbar');
  const cs = el => el ? getComputedStyle(el) : null;
  return { bg: cs(b)?.backgroundColor, r: cs(b)?.borderTopLeftRadius,
    fs: cs(b)?.fontSize, navBg: cs(nav)?.backgroundColor };
});
const was = await bubbleStyle();
await page.evaluate(async ({skinId}) => {
  const skin=await import('/src/system/skin.js');
  skin.update(skinId, { gen: { bubble:{ side:'theirs', bg:'#ff0000', r:26, fs:19 },
    nav:{ bg:'#00ff00' } } });
}, ids);
await page.waitForTimeout(1000);
const now = await bubbleStyle();
ok('调底色，预览里的气泡当场变色',
  now.bg === 'rgb(255, 0, 0)' && was.bg !== now.bg, JSON.stringify([was.bg, now.bg]));
ok('调圆角与字号也当场生效',
  now.r === '26px' && now.fs === '19px', JSON.stringify(now));
ok('顶栏那一组改的是真顶栏', now.navBg === 'rgb(0, 255, 0)', JSON.stringify([was.navBg, now.navBg]));
ok('只改了角色那一边，我的气泡不动', await page.evaluate(() => {
  const m = document.querySelector('.gen-stage')?.shadowRoot?.querySelector('.ph-bubble-mine');
  return m ? getComputedStyle(m).backgroundColor !== 'rgb(255, 0, 0)' : false;
}));

// 生成的那一段进了这一份美化，导出导入都带得走
const trip = await page.evaluate(async (skinId) => {
  const skin=await import('/src/system/skin.js');
  const row = skin.get(skinId);
  const packed = JSON.parse(skin.pack(row));
  const back = skin.unpack(JSON.stringify(packed));
  const dup = skin.duplicate(skinId);
  return { inCss: /ff0000/i.test(skin.compile(row)),
    packedGen: packed.gen?.bubble?.bg, backGen: back.gen?.bubble?.bg,
    dupGen: dup?.gen?.bubble?.bg,
    evilGen: skin.unpack(JSON.stringify({ kind:'phone-skin', version:1, name:'x', gen:[1,2] })).gen };
}, ids.skinId);
ok('生成的那一段真的进了这份美化', trip.inCss, JSON.stringify(trip));
ok('导出带着旋钮的值，导进去还能接着调',
  trip.packedGen === '#ff0000' && trip.backGen === '#ff0000', JSON.stringify(trip));
ok('复制一份也带着', trip.dupGen === '#ff0000', JSON.stringify(trip));
ok('包里 gen 写成数组之类的，一律丢掉',
  JSON.stringify(trip.evilGen) === '{}', JSON.stringify(trip.evilGen));

await page.screenshot({path:`${OUT}/gen.png`, fullPage:true});
ok('全程没有运行时报错', errs.length===0, errs.join(' | '));
await browser.close();
const bad=R.filter(r=>!r.pass).length;
console.log(`\n${R.length-bad}/${R.length} 通过`);
process.exit(bad?1:0);
