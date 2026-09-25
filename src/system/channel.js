// 这一份是正式版还是测试版。见 CLAUDE.md「正式版与测试版」
//
// 按网址认：测试版放在 Cloudflare Pages（*.pages.dev），正式版在 eiraphone.cn（旧网址 GitHub Pages 留作搬家）。
// 两边是不同的域名，浏览器里的数据天然分开 —— 这正是测试版不放在同一个
// github.io 下面的原因（同域名会共用一份数据，测试版的升级会改掉正式数据）。
//
// 测试里没有 pages.dev 这个域名，localStorage 里写 eira-channel=test 也算
const KEY = 'eira-channel';
const forced = () => { try { return localStorage.getItem(KEY) === 'test'; } catch { return false; } };

export const isTest = () => typeof location !== 'undefined'
  && (/\.pages\.dev$/i.test(location.hostname) || forced());

/** 测试版在屏幕左边缘挂一枚「测试版」，标题也改掉，免得和正式版弄混。登录页之前就挂上 */
export function install() {
  if (!isTest()) return;
  document.title = 'Eira 测试版';
  const tag = document.createElement('div');
  tag.className = 'test-tag';
  tag.textContent = '测试版';
  document.body.appendChild(tag);
}
