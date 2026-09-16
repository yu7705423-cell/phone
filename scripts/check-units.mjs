import { sources, read, rel, report } from './lib.mjs';

// 只用 vh,禁止 dvh / svh / lvh,更禁止混用。见 CLAUDE.md 第 1 条
// 全项目只允许 .root 出现一次视口单位。
const BANNED = /\b\d*\.?\d+(dvh|svh|lvh|dvw|svw|lvw)\b/;
const VH = /\b\d*\.?\d+vh\b/;

export function check() {
  const problems = [];
  const vhHits = [];

  for (const file of sources(['.css', '.js', '.html'])) {
    read(file).split('\n').forEach((line, i) => {
      if (line.includes('CLAUDE.md') || /^\s*(\/\*|\*|\/\/)/.test(line)) return;
      const bad = line.match(BANNED);
      if (bad) problems.push(`${rel(file)}:${i + 1}  用了 ${bad[1]}，只允许 vh`);
      if (VH.test(line)) vhHits.push(`${rel(file)}:${i + 1}  ${line.trim()}`);
    });
  }

  if (vhHits.length > 1) {
    problems.push(`视口单位出现了 ${vhHits.length} 处，应当只在根容器出现一次：`);
    vhHits.forEach(h => problems.push(`  ${h}`));
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(report('视口单位', check()));
}
