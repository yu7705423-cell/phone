# ffmpeg.wasm 核心

来源：npm `@ffmpeg/core` 0.12.10 的 `dist/esm`，单线程版。
许可：**GPL-2.0-or-later**（ffmpeg 自身的许可）。

单线程版不需要 `SharedArrayBuffer`，也就不需要 COOP/COEP 两个响应头 ——
本项目是个静态目录，加不了响应头（见 CLAUDE.md 第 9 条）。多线程版快一倍，
但要那两个头，所以不用。

`ffmpeg-core.wasm` 三十二兆，**只在用户点「用 ffmpeg 处理」时才加载**，
平时一个字节都不读（见 `src/system/ffmpeg.js`）。

**wasm 切成两块放**：`ffmpeg-core.wasm.1`、`ffmpeg-core.wasm.2`，按顺序拼起来就是原来那个
`ffmpeg-core.wasm`。Cloudflare Pages（测试版）单个文件上限 25 MB，整个的放不上去。
`src/system/ffmpeg.js` 取回两块拼好，经 `wasmBinary` 交给核心。

换版本时把 `dist/esm` 下那两个文件整个换掉，再把 wasm 从正中间切成两块、删掉整的：

```
python3 -c "b=open('ffmpeg-core.wasm','rb').read();h=len(b)//2;open('ffmpeg-core.wasm.1','wb').write(b[:h]);open('ffmpeg-core.wasm.2','wb').write(b[h:])"
rm ffmpeg-core.wasm
```
