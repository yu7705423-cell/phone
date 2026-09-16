// 渲染层唯一入口。其余文件一律从这里导入,不直接碰 vendor。
export {
  h, html, render, Component, createContext,
  useState, useReducer, useEffect, useLayoutEffect,
  useRef, useMemo, useCallback, useContext, useErrorBoundary,
} from '../vendor/preact-htm.mjs';
