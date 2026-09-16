# 小手机

跑在浏览器里的仿手机前端。外壳是手机，里面装各种 app。
核心场景是 AI 角色扮演：角色卡 + 世界书 + 记忆 + 聊天 + 朋友圈。

## 在手机上打开

仓库开启 GitHub Pages 之后就有一个固定网址，手机浏览器直接访问。

开启方式（手机浏览器也能操作）：
打开 github.com 上的这个仓库 → Settings → Pages →
Source 选 **Deploy from a branch** → Branch 选 `claude/mini-phone-architecture-tqzvig`、目录 `/ (root)` → Save。
等一两分钟，网址是：

```
https://yu7705423-cell.github.io/phone/
```

**打开后请「添加到主屏幕」。** 这不是可选步骤：
手机浏览器的地址栏会占掉一块高度，而本项目规定只用 `vh`（`dvh` 会让界面随地址栏
显隐而抽动，见 CLAUDE.md），所以在普通标签页里底部的 Dock 可能被压在可视区外。
加到主屏后以独立窗口全屏运行，没有地址栏，`100vh` 正好是整屏。

- iPhone Safari：分享按钮 → 添加到主屏幕
- Android Chrome：右上角菜单 → 添加到主屏幕 / 安装应用

## 在电脑上运行

原生 ES Modules，不需要 npm install，不需要打包器。
但 ES Modules 在 `file://` 下受 CORS 限制，双击 index.html 打不开，需要一个静态服务器：

```
python3 -m http.server 8000
```

然后访问 http://localhost:8000

## 开始用

1. 打开「设置 → 接口与密钥」，填 API Key 和模型
2. 打开「设置 → 我的人设」，写清楚你是谁
3. 进「聊天 → 联系人」新建一个角色卡
4. 点进角色主页，发消息

## 自检

```
node scripts/doctor.mjs
```

一次跑完四项：视口单位只用 vh、零 emoji、模块边界、设计令牌。
提交前跑一次。

## 文档

- `CLAUDE.md` — 不可违反的硬性规则，写代码前先读
- `ARCHITECTURE.md` — 完整架构：分层、数据域、AI 引擎、系统界面、路线图

## 目录

```
index.html            入口
vendor/               手工放入的第三方 ESM（preact + htm）
styles/               设计令牌与全局样式
scripts/              自检与脚手架
src/
  shell/              根容器、状态栏、Dock
  system/             内核：数据域、AI 引擎、注册表、导航
  sdk/                app 唯一能接触的系统入口
  ui/                 设计系统原语
  icons/              全部 SVG 图标
  screens/            锁屏、主界面、多任务
  apps/               chat / lorebook / memory / settings
```

## 数据

全部存在浏览器本地的 IndexedDB，不上传任何服务器。
图片以 Blob 存储并在上传时压缩。
「设置 → 存储与备份」可以导出 JSON 备份（不含图片与密钥）。

纯前端直连模型接口意味着 API Key 会暴露在前端，只适合自己使用。
