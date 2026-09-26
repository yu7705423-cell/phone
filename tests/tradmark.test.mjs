// 标记名写成繁体（或日文汉字）也认（ARCHITECTURE 4.254）
//
// 用户报的：[事項完成：去画材店购买新的油画颜料] 原样显示在气泡里。说日语、繁体的角色，
// 模型会顺手把标记名也写成「事項」「圖片」「轉賬」，解析只认简体，认不出就当正文。
//
//   一、方括号标记名里的繁体字转成简体再认：事項完成、圖片、語音、轉賬、禮物、約定、換頭像、改備註、撤回動態
//   二、只转标记名：冒号后面的正文一个字不动（仍是繁体）
//   三、括号里不是标记名的一律不动：「（當然）」「[記得帶傘]」原样
//   四、HTML 卡片的 [卡片：…] 与 [/卡片] 同样认
//   五、线下的衣帽间标记（換上、歸還）也认
import { BASE, EXE, chromium } from './_env.mjs';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await (await browser.newContext()).newPage();
const R = []; const ok = (n, c, e) => { R.push({ n, pass: !!c }); console.log(`${c ? '  ok  ' : '  FAIL'} ${n}${c ? '' : '   << ' + (e ?? '')}`); };
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

const out = await page.evaluate(async () => {
  const r = await import('/src/system/ai/reply.js');
  const kinds = t => r.splitReply(t).map(p => p.type);
  return {
    agenda: r.splitReply('[事項完成：去画材店购买新的油画颜料]'),
    many: kinds('[圖片：窗外的雨]\n[語音：到了]\n[轉賬：52｜奶茶]\n[禮物：一束花]\n[約定：週末去看展]\n[撤回動態]'),
    avatar: r.splitReply('[換頭像：海邊那張]'),
    remark: r.splitReply('[改備註：小笨蛋]'),
    body: r.splitReply('[約定：週末一起去美術館]')[0],
    prose: r.splitReply('（當然）\n[記得帶傘]\n今天很冷'),
    card: r.splitReply('[卡片：電影票]\n片名：夜行\n[/卡片]'),
  };
});
ok('一、[事項完成：…] 认成事项完成，不再原样显示',
  out.agenda.length === 1 && out.agenda[0].type === 'agenda' && out.agenda[0].title === '去画材店购买新的油画颜料', JSON.stringify(out.agenda));
ok('一、圖片、語音、轉賬、禮物、約定、撤回動態都认', JSON.stringify(out.many) === '["image","voice","transfer","gift","pact","recall-post"]', JSON.stringify(out.many));
ok('一、換頭像、改備註也认', out.avatar[0]?.type === 'wear' && out.remark[0]?.type === 'remark', JSON.stringify([out.avatar, out.remark]));
ok('二、冒号后面的正文不动（仍是繁体）', out.body?.type === 'pact' && out.body.title === '週末一起去美術館', JSON.stringify(out.body));
ok('三、不是标记名的括号原样', JSON.stringify(out.prose.map(p => p.text)) === '["（當然）","[記得帶傘]","今天很冷"]', JSON.stringify(out.prose));
ok('四、[卡片：…] 也认', out.card.length === 1 && out.card[0].type === 'card' && out.card[0].name === '電影票', JSON.stringify(out.card));

const scene = await page.evaluate(async () => {
  const cs = await import('/src/system/closet-story.js');
  return cs.takeMarks('他换了件衣服。\n[換上：白色襯衫]\n[歸還：圍巾]', { sceneId: 'none', charId: 'none' }).text;
}).catch(e => String(e));
ok('五、线下的衣帽间标记（換上、歸還）也认：从正文里摘掉', scene === '他换了件衣服。', JSON.stringify(scene));

ok('没有页面错误', !errs.length, errs.join('\n'));
await browser.close();
const fail = R.filter(x => !x.pass).length;
console.log(`\n${R.length - fail}/${R.length} 项通过`);
process.exit(fail ? 1 : 0);
