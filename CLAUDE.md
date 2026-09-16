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

一次性跑完单位、emoji、依赖边界、硬编码颜色四项检查。
