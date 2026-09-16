import { sources, read, rel, report } from './lib.mjs';

// 源码、界面文案、图标任何位置都不允许 emoji。见 CLAUDE.md 第 2 条
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{E0020}-\u{E007F}]/u;

export function check() {
  const problems = [];
  for (const file of sources()) {
    read(file).split('\n').forEach((line, i) => {
      const m = line.match(EMOJI);
      if (m) problems.push(`${rel(file)}:${i + 1}  出现 emoji ${JSON.stringify(m[0])}`);
    });
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(report('零 emoji', check()));
}
