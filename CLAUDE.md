# 小手机 项目规约

架构细节见 `ARCHITECTURE.md`。本文件只放**不可违反的硬性规则**。
写任何代码前先读完这里。

---

## 1. 单位：只用 vh，禁止 dvh

**所有视口高度一律使用 `vh`。禁止使用 `dvh` / `svh` / `lvh`。**

原因：`dvh` 会随移动端浏览器地址栏的显隐而变化，滚动时整个界面跟着抽动重排。
本项目是固定高度的手机外壳，这种抖动不可接受。

**更禁止混用。** 两个容器一个用 `vh` 一个用 `dvh`，地址栏一收就直接错位。

```css
/* 正确 */
.app-root { height: 100vh; }

/* 禁止 */
.app-root { height: 100dvh; }
.panel    { height: 50svh; }
```

由 `scripts/check-units.mjs` 扫描拦截。

### 外壳那一串容器必须整整齐齐都是 100vh

```
html, body   height: 100vh
#app         height: 100vh
.root        height: 100vh
```

**一层都不许换成 `100%`，更不许换成量出来的像素值。**

只要中间有一层不是 `100vh`，它就只撑到 WebKit 认为的可视区，撑不到屏幕底部。
底下空出来那条，iOS 会拿页面底色去填，于是永远有一条白边；
换壁纸、切页面都盖不掉它，因为那根本不是页面画的。

`100vh` 在 iOS 上算的是地址栏收起后的高度。加到主屏幕当 PWA 用时没有地址栏，
这就是整块屏幕，正好。配合 `index.html` 里的 `viewport-fit=cover`，
内容能一直铺到 Home Indicator 底下。

**代价**：在普通 Safari 标签页里（没加到主屏幕），`100vh` 比可视区高一截，
底部那排会被地址栏压住。这个项目按 PWA 用，接受这个代价 —— 别为了标签页
再去量高度，量出来的像素值就是上面说的「不是 100vh 的那一层」。

壁纸另外还用了 `position: fixed`，不管外壳怎样都铺满，纯背景不参与布局。

由 `scripts/check-units.mjs` 拦截：dvh/svh/lvh 一律报错；`vh` 只允许出现在
`styles/base.css` 的这三条规则里，而且必须是 `100vh`；少写一层也报错。

## 2. 零 emoji

**源码、界面文案、图标，任何位置都不允许出现 emoji。**
所有图标一律使用 SVG，统一走 `<Icon name="..." />`。

由 `scripts/check-no-emoji.mjs` 扫描拦截。

## 3. 全屏，没有机身外壳

**不画手机外框、不画刘海、不做机身投影。** 界面直接铺满整个视口。
无论桌面还是移动端都是全屏。

## 4. 设计取向：简约

- 不做拟物，不堆毛玻璃，不用彩色渐变图标
- 单色 SVG 图标 + 低饱和底色
- 留白充足，克制装饰
- 颜色、圆角、间距、字号、动效一律来自 `styles/tokens.css`，**禁止硬编码**

## 5. 模块边界

```
apps/*  只能 import:  sdk/, ui/, icons/
apps/a  永远不能 import  apps/b
apps/*  永远不能 import  system/
```

跨 app 的数据一律放在 `system/db/` 的数据域里，app 只是它的视图。
跨 app 的调用一律走 Intent。

由 `scripts/check-boundaries.mjs` 扫描拦截。

## 6. 无构建

原生 ES Modules，不引入打包器，不需要 `npm install`。
第三方库手工放进 `vendor/`，import 本地文件。

ES Modules 在 `file://` 下受 CORS 限制，需静态服务器运行：

```
python3 -m http.server 8000
```

## 7. AI 请求

不允许在组件里直接 `fetch` 模型接口。一律走 `phone.ai.*`，
底下经过 AIQueue（并发限制、去重、取消、重试）与 provider 适配层。

## 8. Prompt 不写死

骨架开场、收尾、各任务的 instruction 全部存在 `settings.promptTemplates`，
代码里只保留 `DEFAULT_TEMPLATES` 作为回落。改语气不应该需要改代码。

---

## 提交前自检

```
node scripts/doctor.mjs
```

一次性跑完六项检查：视口单位、零 emoji、导入导出、hook 顺序、依赖边界、硬编码颜色。

其中两项是无构建方案必须自己补的：

- **导入导出**：没有打包器替我们校验，引用一个已删掉的导出要到运行时打开
  那个页面才会炸。
- **hook 顺序**：hook 必须每次渲染都以相同顺序调用。在提前 return 之后再调
  hook，组件关闭再打开时数量就对不上，表现为状态串味或界面不刷新，而且
  不报异常，只会安静地出怪事。
