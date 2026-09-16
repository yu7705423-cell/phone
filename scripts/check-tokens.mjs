import { sources, read, rel, report } from './lib.mjs';

// 颜色一律来自 tokens.css,禁止硬编码。见 CLAUDE.md 第 4 条
const COLOR = /(#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\()/;

export function check() {
  const problems = [];
  for (const file of sources(['.css'])) {
    const path = rel(file);
    if (path === 'styles/tokens.css') continue;
    read(file).split('\n').forEach((line, i) => {
      if (/^\s*(\/\*|\*)/.test(line)) return;
      if (!COLOR.test(line)) return;
      // 允许纯黑白的半透明遮罩与阴影
      if (/rgba\(\s*(0,\s*0,\s*0|255,\s*255,\s*255)\s*,/.test(line)) return;
      if (/^\s*(--shadow|box-shadow)/.test(line)) return;
      if (/#fff\b|#ffffff\b/i.test(line) && /background:\s*#fff/i.test(line)) return;
      problems.push(`${path}:${i + 1}  硬编码颜色: ${line.trim().slice(0, 70)}`);
    });
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(report('设计令牌', check()));
}
