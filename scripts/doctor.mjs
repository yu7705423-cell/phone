import { report } from './lib.mjs';
import { check as emoji } from './check-no-emoji.mjs';
import { check as units } from './check-units.mjs';
import { check as boundaries } from './check-boundaries.mjs';
import { check as tokens } from './check-tokens.mjs';

console.log('小手机 自检\n');
let failed = 0;
failed += report('视口单位（只用 vh）', units());
failed += report('零 emoji', emoji());
failed += report('模块边界', boundaries());
failed += report('设计令牌', tokens());
console.log(failed ? `\n${failed} 项未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
