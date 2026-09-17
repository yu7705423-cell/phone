// 渲染层唯一入口。其余文件一律从这里导入,不直接碰 vendor。
import { h, Component } from '../vendor/preact-htm.mjs';

export {
  h, html, render, Component, createContext,
  useState, useReducer, useEffect, useLayoutEffect,
  useRef, useMemo, useCallback, useContext, useErrorBoundary,
} from '../vendor/preact-htm.mjs';

// 列表里成百上千个同构的小组件（消息气泡、会话行），只要外面重画一次，
// 它们就全跟着重画。流式回复一秒几十帧，每帧都把整屏气泡过一遍，
// 差的那点每次都不多，加起来就是打字时的卡顿。
//
// 这层只做一件事：props 逐项比过，一样就不往下走。
// 只给**没有 children 的叶子组件**用 —— children 每次渲染都是新数组，
// 比不出相等，包了也白包。
//
// 传进去的函数属性必须身份稳定（useCallback，或者用 ref 兜住最新闭包），
// 每次渲染现造一个箭头函数的话，这里永远判不出相等。
export function memo(Inner) {
  class Memo extends Component {
    shouldComponentUpdate(nextProps) { return !same(this.props, nextProps); }
    render(props) { return h(Inner, props); }
  }
  Memo.displayName = `Memo(${Inner.name || '匿名'})`;
  return Memo;
}

function same(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is(a[k], b[k])) return false;
  return true;
}
