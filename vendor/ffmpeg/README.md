# ffmpeg.wasm 核心

来源：npm `@ffmpeg/core` 0.12.10 的 `dist/esm`，单线程版。
许可：**GPL-2.0-or-later**（ffmpeg 自身的许可）。

单线程版不需要 `SharedArrayBuffer`，也就不需要 COOP/COEP 两个响应头 ——
本项目是个静态目录，加不了响应头（见 CLAUDE.md 第 9 条）。多线程版快一倍，
但要那两个头，所以不用。

`ffmpeg-core.wasm` 三十二兆，**只在用户点「用 ffmpeg 处理」时才加载**，
平时一个字节都不读（见 `src/system/ffmpeg.js`）。

换版本时把 `dist/esm` 下那两个文件整个换掉即可，不要只换一个。
