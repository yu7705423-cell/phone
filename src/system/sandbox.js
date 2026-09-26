// 别人写的网页（工具箱里的网页工具、主屏的自定义组件）放进来之前，先关进这个盒子。
// 见 ARCHITECTURE 4.247
//
// 不去审代码 —— 混淆一下就看不出来。靠的是浏览器保证的几道墙：
//
// 1. iframe 只给 `sandbox="allow-scripts"`，**不给 allow-same-origin**。
//    它拿到的是一个不透明源：读不到本应用的 IndexedDB、localStorage（密钥、聊天、角色都在里面），
//    碰不到外面的页面，不能把整个应用跳走，也弹不了新窗口、alert。
// 2. 文档最前面插一条 CSP：不许连任何外部地址、不许加载外部脚本与图片。
//    下载不了别的代码，也发不出任何东西。
// 3. 它还能把自己那一小块跳到外部网址、顺带捎点东西出去 —— 外面数 load 次数，
//    第二次 load 就说明它跳了，当场拆掉（见 watchFrame）。
//
// 堵不死的：部分浏览器的 WebRTC 绕得过 CSP。它手里只有用户当场交给它的那一点东西，
// 最坏也就漏那一点。死循环卡住整个页面也挡不住，只能保证重开之后不再自动跑（工具箱那边管）。

export const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
].join('; ');

export const SANDBOX = 'allow-scripts';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/**
 * 把一段 HTML 包成可以放进 srcdoc 的整页。
 *
 * CSP 必须在它自己的任何东西之前：放在最前面，并去掉它自己的 doctype
 * （doctype 前面有内容会进怪异模式，所以我们自己补一个在最前）。
 * 解析器会把最前面这几样放进 head，后面它自己的 <html>、<head> 合并进来，不影响它的写法。
 *
 * `bridge` 是一段放在 CSP 之后、它的代码之前的脚本（工具箱给网页工具的 window.eira）。
 */
export function wrap(html, { bridge = '' } = {}) {
  const body = String(html || '').replace(/^﻿?\s*<!doctype[^>]*>/i, '');
  return '<!DOCTYPE html>'
    + `<meta http-equiv="Content-Security-Policy" content="${esc(CSP)}">`
    + '<meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + (bridge ? `<script>${bridge}</script>` : '')
    + body;
}

/**
 * 盯着一个 srcdoc iframe：第一次 load 是它自己；再 load 一次就是它把自己跳走了。
 * 跳走的那一刻它可能已经把地址里捎带的东西发出去，但之后不会再有第二次。
 *
 * 返回的是 onLoad 处理函数，直接挂在 iframe 的 onLoad 上 —— 必须在它进文档之前就挂好：
 * 等渲染完再 addEventListener，第一次 load 可能已经过去了，那样跳走的那一次反而被当成第一次。
 * 每次重新挂一个 iframe（换 key）都要拿一个新的。
 */
export function escapeGuard(onEscape) {
  let loads = 0;
  return () => {
    loads += 1;
    if (loads > 1) onEscape?.();
  };
}
