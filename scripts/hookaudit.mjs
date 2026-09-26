// 美化契约的第三道核对（前两道在 check-contract.mjs）：**作者写单个钩子必须盖得住**（ARCHITECTURE 4.257）。
//
// 在真实页面上，逐个挂了 ph- 钩子的元素，扫应用自己的样式表里选得中它、而且比单个类名（0,1,0）更特异的规则。
// 这种规则会压住作者写的 `.ph-xxx { ... }`，表现就是「写了没反应」（用户反馈：图标换不动、按钮颜色改不了）。
// 交互态（:hover / :active / :focus / :disabled）不算，伪元素不算。
//
// smoke.mjs 每打开一条路由就跑一遍，攒起来最后一起报。这里只导出跑在页面里的那段代码和放行名单。

// 放行：功能性的规则，作者不该改，或者改了等于关掉一个功能
export const ALLOW = [
  ':root[data-nav="back"] .navbar .nav-left',   // 返回方式选「手势」时藏掉顶栏左侧，是功能不是样式
];

export const AUDIT_JS = `(() => {
  const spec = sel => {
    let s = sel.replace(/:where\\([^)]*\\)/g, '').replace(/::?[a-z-]+\\([^)]*\\)/g, m => (m.startsWith('::') ? '' : m));
    const ids = (s.match(/#[\\w-]+/g) || []).length;
    const cls = (s.match(/\\.[\\w-]+|\\[[^\\]]+\\]|:(?!:)[a-z-]+/g) || []).length;
    return ids * 100 + cls;
  };
  const out = {};
  for (const sheet of document.styleSheets) {
    if (!sheet.href || !/styles\\//.test(sheet.href)) continue;
    const file = sheet.href.split('/').pop().split('?')[0];
    const walk = rules => { for (const r of rules) {
      if (r.cssRules && !r.selectorText) { walk(r.cssRules); continue; }
      if (!r.selectorText) continue;
      for (const sel of r.selectorText.split(',')) {
        const s = sel.trim();
        if (/:(hover|active|focus|focus-visible|focus-within|disabled)\\b/.test(s) || /::/.test(s)) continue;
        if (spec(s) <= 1) continue;
        let els; try { els = document.querySelectorAll(s); } catch { continue; }
        for (const el of els) {
          const hooks = [...el.classList].filter(c => c.startsWith('ph-'));
          if (!hooks.length) continue;
          const props = [...r.style].filter(p => !p.startsWith('--')).join(' ');
          if (!props) continue;
          out[hooks.join(' ') + '  <-  ' + s] = file + ': ' + props;
        }
      }
    } };
    try { walk(sheet.cssRules); } catch {}
  }
  return out;
})()`;
