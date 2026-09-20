import { sources, read, rel } from './lib.mjs';

// 界面文案必须是书面语。见 CLAUDE.md 第 7 条。
//
// ---- 为什么要有这个文件 ----
//
// 第 7 条从一开始就写在那儿，可**没有任何东西拦得住它**：
// check-prompt-tone 只扫 src/system/ai/，界面那几百条文案全靠写的人自觉。
// 于是同一类错反复出现 —— 「已说好」「还差」「够了」「去哪儿」，
// 每一条单看都不算大事，攒起来整个界面就从「一台仪器」变成了「一个人在跟你搭话」。
//
// 这个文件拦的是**机械可查的那部分**：一份口语词表。它拦不住
// 「这件事让你不痛快」这种整句的语气，那仍然要自己把关。
// 但它拦得住反复犯的那几个词，而反复犯的正是那几个词。
//
// ---- 扫哪儿 ----
//
// 界面文案在 apps 与 ui 里。system 那一层归 check-prompt-tone 管，不重复扫。
//
// 只扫**字符串字面量**，注释不管（第 7 条：注释写给开发者看，可以口语）。

const FILES = /^src\/(apps|ui|shell)\//;

const RULES = [
  [/[呀嘛啦哦咯][。！？，、]|[呀嘛啦哦咯]$/u, '句末语气词'],
  [/[吧呢][。！？]|[吧呢]$/u, '句末语气词「吧」「呢」'],
  [/别(写|说|让|问|提|做|用|把|给|当|太|忘|急|去|再|管|挑|动)/u,
    '「别…」是口语，祈使否定写「不要…」'],
  [/而已|反正|干脆|顺手|省得|压根|甭|一上来|凭空/u, '口头连接词'],
  [/就(行|好|是了|完了)|行了|得了/u, '「就行」一类口语'],
  [/啥|咋|咱|瞎|呗|喽|干嘛|老是|成天|吐槽|使劲/u, '口语词'],
  // 反复犯的那几个。每一条后面写清楚该写什么，免得下次只知道错、不知道改成什么
  [/说好了|已说好|说好的/u, '「说好」是口语，写「已同意」「已确定」'],
  [/哪儿|那儿|这儿|一会儿|待会儿|这会儿|点儿|事儿/u, '儿化是口语，写「哪里」「稍后」一类'],
  [/够了|不够了/u, '「够了」是口语，写「已满足」「已达到」'],
  [/还差/u, '「还差」是口语，写「尚缺」'],
  [/差不多|好多了|没事/u, '口语的程度词，写确切的数或者「无异常」'],
  [/——/u, '破折号插入语'],
];

// 明知违反但必须留着的，一行一个理由。
//
// **不要拿它当省事的出口。** 写进来的必须是「这个词就是内容本身」那种：
// 被演示的原话、协议里的标记、用户自己起的名字。
const ALLOW = new Map([
  // 第 7 条自己举的反例，写在示例里就是要给人看错的那一版
  ['src/apps/settings/AboutPage.js', '关于页里引的是项目规约原文'],
]);

// 去掉注释，只留代码。字符串里的 // 不算注释，所以要边走边认引号
function stripComments(src) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
      if (c === quote) quote = null;
      out += c; i += 1; continue;
    }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    out += c; i += 1;
  }
  return out;
}

// 「」引起来的是被举例、被禁止的原话，方括号里的是协议标记，两样都不算文案
const stripQuoted = t => t
  .replace(/「[^」\n]*」/gu, '「」')
  .replace(/[[【][^\]】\n]*[\]】]/gu, '[]');

// **注释去掉之后，剩下的中文必然在字符串里** —— 这个项目里没有中文标识符。
// 所以不必再把字符串一个个抠出来：抠的那一版漏掉了一半，因为正则字面量里的
// 引号会把后面一大段一起吞掉。逐行扫剩下的东西，行号也就是准的。
export function check() {
  const problems = [];
  for (const file of sources(['.js']).filter(f => FILES.test(rel(f)))) {
    const name = rel(file);
    if (ALLOW.has(name)) continue;
    stripComments(read(file)).split('\n').forEach((raw, i) => {
      if (!/[\u4e00-\u9fff]/.test(raw)) return;
      const line = stripQuoted(raw);
      for (const [re, why] of RULES) {
        const hit = line.match(re);
        if (hit) problems.push(`${name}:${i + 1}  ${why}：…${hit[0]}…`);
      }
    });
  }
  return problems;
}
