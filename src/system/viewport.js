// 整页被浏览器推离原位之后，推回来。
//
// 外壳是一整块 100vh（CLAUDE.md 第 1 条），html、body 都 overflow: hidden，页面本身不该滚动。
// 可手机浏览器在点输入框时会**自己**把整页往上推，好让输入框露在键盘上面 —— overflow: hidden 拦不住它。
// 键盘收起后它常常不推回来：整页停在推上去的位置，上面少一截、下面空一大片。
// 聊天页的输入框在最底下，推得最多，所以最显眼。
//
// 这里只做一件事：没有输入框处于激活状态时，页面一旦不在原位就归位。
// 正在输入时不动 —— 那时候推上去是对的，不推输入框就被键盘挡住了。
// 不量高度、不改容器的单位，外壳那一串 100vh 原样不动。

const editable = el => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

function reset() {
  if (editable(document.activeElement)) return;
  const se = document.scrollingElement || document.documentElement;
  if (window.scrollY || window.scrollX || se.scrollTop || document.body.scrollTop) {
    window.scrollTo(0, 0);
    se.scrollTop = 0;
    document.body.scrollTop = 0;
  }
}

export function install() {
  if (typeof window === 'undefined') return;
  // 失焦之后键盘还在往下收，等它收完再归位；换到另一个输入框的不算失焦
  document.addEventListener('focusout', () => { setTimeout(reset, 60); setTimeout(reset, 350); });
  window.addEventListener('scroll', reset, { passive: true });
  window.visualViewport?.addEventListener('resize', reset);
  window.addEventListener('orientationchange', () => setTimeout(reset, 300));
}
