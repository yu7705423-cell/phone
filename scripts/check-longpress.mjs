import { sources, read, rel, report } from './lib.mjs';

// 挂了长按手势的元素必须带 .no-callout。见 CLAUDE.md 第 12 条。
//
// 没法从静态文本里精确认出「哪个元素挂了长按」，所以按文件粗判：
// 一个文件里既有 onTouchStart，又有一个 300 到 1200 毫秒的定时器字面量，
// 那它八成在做长按判定 —— 这个区间就是人手长按的时长，
// 更短的是动画收尾，更长的是自动关闭。这种文件里必须出现 no-callout。
//
// 粗是粗，但要防的就是「新写了个长按，忘了禁系统浮层」这一种错，
// 而这种错一定落在同一个文件里。
const HOLD_MS = /,\s*(\d{3,4})\s*\)/g;

export function check() {
  const problems = [];
  for (const file of sources(['.js'])) {
    const src = read(file);
    if (!src.includes('onTouchStart')) continue;
    if (!src.includes('setTimeout')) continue;

    HOLD_MS.lastIndex = 0;
    let looksLikeHold = false;
    let m;
    while ((m = HOLD_MS.exec(src))) {
      const ms = Number(m[1]);
      if (ms >= 300 && ms <= 1200) { looksLikeHold = true; break; }
    }
    if (!looksLikeHold) continue;

    if (!src.includes('no-callout')) {
      problems.push(`${rel(file)}  像是在做长按判定，但没给元素加 no-callout 类`);
    }
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(report('长按禁选', check()));
}
