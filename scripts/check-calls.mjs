import { read, rel, report, sources } from './lib.mjs';

// 一次回复只调一次接口。见 CLAUDE.md 第 15 条。
//
// 这一条以前只是口头约定，结果是：功能一个个加上去，每个都「顺带」多打一次，
// 而界面上没有任何地方说得出「发一条消息到底花几次」。用户是从账单上发现的。
//
// 机器能查的只有两件事，但这两件正是最容易漏的：
//
//   **默认得关着**  cost.js 的 EXTRA_CALLS 里登记的每一项，
//                   在 DEFAULT_SETTINGS 里必须是关着的那个值。
//   **重试不过 3**  enqueue 的 retries 字面量不得大于 3。
//
// 查不出来的那一层仍然要自己把关：**新加了会多打接口的东西却没往
// EXTRA_CALLS 里登记**。漏登记的后果是安静的，所以加功能时先加那一行。

/**
 * 用户点名默认打开的那几项，一行一个理由。
 *
 * 第 15 条是「默认关着」，但项目是用户的：他明确说某一项要默认打开，就打开。
 * **不是把这道闸拆了**，是在闸上登记一个例外 —— 没登记的新项照样拦下来，
 * 登记了的一眼看得出是谁、为什么放行的。和 check-dead 的 KEEP 同一个做法。
 *
 * 放行的只是「默认值」。它仍然在 EXTRA_CALLS 里，「用量与上限」照样把它
 * 算进账里、照样能关。
 */
const ALLOW_ON = new Map([
  ['callSummary', '用户明确要求默认开启（每通接通过的电话挂断时一次）'],
]);

const COST = 'src/system/ai/cost.js';
const DEFAULTS = 'src/system/db/defaults.js';
const CAP = 3;

// 从 EXTRA_CALLS 里把 { setting, off } 那几对抠出来。
// 不 import：defaults 那一串要 db，Node 里没有 window，跑不起来。
function registry(src) {
  const body = src.slice(src.indexOf('export const EXTRA_CALLS'));
  const out = [];
  const re = /setting:\s*(?:'([\w]+)'|null)\s*,\s*off:\s*(false|true|0|-?\d+)/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[1]) out.push({ key: m[1], off: m[2] });
  }
  return out;
}

// DEFAULT_SETTINGS 里某个键写的是什么。找不到返回 undefined。
function defaultOf(src, key) {
  const m = src.match(new RegExp(`^\\s*${key}:\\s*([^,\\n]+)`, 'm'));
  return m ? m[1].trim() : undefined;
}

export function check() {
  const problems = [];

  const costSrc = read(COST);
  const defSrc = read(DEFAULTS);
  const rows = registry(costSrc);

  if (!rows.length) {
    problems.push(`${COST}  EXTRA_CALLS 里一项带 setting 的都没有，清单是不是被改坏了`);
  }

  for (const { key, off } of rows) {
    if (ALLOW_ON.has(key)) continue;
    const got = defaultOf(defSrc, key);
    if (got === undefined) {
      problems.push(`${DEFAULTS}  EXTRA_CALLS 登记了 ${key}，但 DEFAULT_SETTINGS 里没有这一项`);
    } else if (got !== off) {
      problems.push(`${DEFAULTS}  ${key} 默认值是 ${got}，应为 ${off}`
        + '（会多调接口的东西默认必须关着，见 CLAUDE.md 第 15 条）');
    }
  }

  // retries 字面量
  for (const file of sources(['.js'])) {
    const name = rel(file);
    const src = read(file);
    const re = /retries:\s*(\d+)/g;
    let m;
    while ((m = re.exec(src))) {
      const n = Number(m[1]);
      if (n > CAP) {
        const line = src.slice(0, m.index).split('\n').length;
        problems.push(`${name}:${line}  retries: ${n} 超过上限 ${CAP}`);
      }
    }
  }

  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(report('接口调用次数', check()));
}
