// 手写的构建号。每次推代码都改一下，index.html 里那份 meta 也要跟着改
// （scripts/check-build.mjs 会拦）。
// 无构建方案没有文件指纹，手机上很容易还在跑缓存里的旧代码；
// 有这一行就能一眼看出屏幕上的到底是哪一版。
export const BUILD = '2026-09-17.38';
