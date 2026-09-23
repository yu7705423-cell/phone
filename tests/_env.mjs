// 测试共用的那几样：页面地址、浏览器、夹具、截图目录。
//
// 本项目不装 npm 依赖（CLAUDE.md 第 9 条），playwright 从别处借，和冒烟一样：
//   SMOKE_PW   一个装了 playwright 的目录（它下面有 node_modules/playwright）
//   PW_CHROME  浏览器可执行文件，默认是云端环境里预装的那一个
//   TEST_BASE  静态服务器地址。scripts/test.mjs 会自己起一个，并把地址传进来
//   TEST_OUT   截图与临时文件放哪儿，默认系统临时目录下的 phone-tests
//
// 单独跑一个：先起服务器（python3 -m http.server 8000），再 node tests/xxx.test.mjs

import { readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const BASE = process.env.TEST_BASE || 'http://127.0.0.1:8000';
export const OUT = process.env.TEST_OUT || join(tmpdir(), 'phone-tests');
mkdirSync(OUT, { recursive: true });

const here = dirname(fileURLToPath(import.meta.url));
/** 一张能用的小 PNG，base64。生图、上传、头像那几处要真图 */
export const PNG_B64 = readFileSync(join(here, 'fixtures', 'png.b64'), 'utf8').trim();
export const PNG_PATH = join(here, 'fixtures', 'png.b64');
/** 夹具目录：几段测试用的音频与视频 */
export const FIX = join(here, 'fixtures');

const pw = process.env.SMOKE_PW ? `${process.env.SMOKE_PW}/node_modules/playwright/index.mjs` : 'playwright';
let mod;
try { mod = await import(pw); }
catch {
  console.log('  跳过：找不到 playwright。用 SMOKE_PW=<某个装了它的目录> 指过去');
  process.exit(0);
}
export const chromium = mod.chromium;
export const EXE = process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
