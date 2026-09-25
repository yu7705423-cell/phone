# 后台消息：Supabase + Cloudflare 部署教程（给运营方看）

做完这一套，用户在「设置 - 通知」里打开「后台消息」之后，**关掉应用，角色也会按「主动找你」的时间
发消息来**：手机上弹一条系统通知，点开就是那段会话，角色说的话已经在里面了。

全程在网页上点，不需要自己的服务器，不需要装任何软件，大约 30 分钟。两家的免费额度都够用。

> Cloudflare 和 Supabase 的后台隔一阵会改版，按钮的名字和位置可能和这里写的略有出入。
> 找不到某个按钮时，认准它的意思：「新建项目」「SQL 编辑器」「新建 Worker」「编辑代码」「部署」「环境变量」「定时触发」。

---

## 它是怎么工作的

网页关掉之后什么都跑不了，所以要一台服务器替它值班：

1. 用户离开应用的那一刻，应用把「哪个角色、几点开口、到时候要发给模型的那一次请求」交给服务器
2. 服务器每分钟看一次，到点就替应用调用模型，拿到角色说的话，用 **Web Push** 推到手机上
3. 用户回到应用，应用把服务器替它写好的那几条取回来，放进会话，服务器那边删掉

分工：

| | 做什么 |
|---|---|
| **Cloudflare Worker**（`worker/push.js`） | 收任务、到点调用模型、发推送。每分钟被 Cron Trigger 叫醒一次 |
| **Supabase**（`worker/push.sql`） | 一个数据库，存每台手机的推送订阅和待发的任务 |

**关于用户的接口密钥**：到点调用模型要用用户自己的接口密钥，所以任务里带着它，还带着那段对话的
上下文。Worker 收下后先用只有它知道的 `DATA_KEY` 加密，再存进 Supabase —— 数据库里只看得到一串
密文。结果取回后即删除。应用的开关说明里也向用户写明了这一点。

**不多花钱**：这是本来就会发生的「主动找你」换了个地方发。应用开着时由手机自己发；关着时由服务器发；
同一次开口不会两边都发（应用开着时每隔几分钟向服务器报到，服务器看到最近报过到就先不发）。

**所有版本都能用，区别只在离开期间弹不弹通知**。消息都是服务器到点写好存着的，打开应用时一定会出现在会话里；
能不能在离开期间弹通知，要看有没有 Web Push：

| | 离开期间 | 打开应用时 |
|---|---|---|
| 安卓 Chrome / Edge（浏览器或添加到主屏幕） | 弹通知 | 消息在会话里 |
| iPhone：Safari 里「添加到主屏幕」之后，从主屏幕图标打开（iOS 16.4 及以上） | 弹通知 | 消息在会话里 |
| iPhone：直接在 Safari 标签页里用 | 不弹（苹果只给主屏幕上的网页发推送） | 消息在会话里 |
| 电脑 Chrome / Edge / Firefox | 弹通知（浏览器要开着或在后台） | 消息在会话里 |
| 安装版 apk、ipa | 不弹（外壳里没有 Web Push） | 消息在会话里，时间是当时发出的那一刻 |

---

## 第一步：Supabase 建数据库

1. 打开 <https://supabase.com>，点 **Start your project**，用 GitHub 账号或邮箱注册
2. 点 **New project**（新建项目）
   - **Name**：随便起，例如 `eira-push`
   - **Database Password**：点 Generate 生成一个，**自己存好**（以后一般用不到，但丢了很麻烦）
   - **Region**：选离用户近的，国内用户选 **Northeast Asia (Tokyo)** 或 **Southeast Asia (Singapore)**
   - 套餐选 **Free**
3. 点 **Create new project**，等一两分钟，项目建好
4. 左边菜单点 **SQL Editor**（SQL 编辑器），再点 **New query**
5. 打开本仓库的 [`worker/push.sql`](./push.sql)，**整个文件**全选、复制，粘进编辑器
6. 点右下角 **Run**（运行）。下面显示 `Success. No rows returned` 就对了
7. 左边点 **Table Editor**，能看到 `push_devices` 和 `push_jobs` 两张表，说明建好了

### 记下两样东西

左边最下面点 **Project Settings**（齿轮），然后：

- 点 **Data API**（有的版本叫 API）：复制 **Project URL**，形如 `https://abcdefgh.supabase.co`
- 点 **API Keys**：找到 **service_role**（有的版本叫 `secret` key），点 Reveal / 复制

> **service_role 密钥等于数据库的万能钥匙**，只能填进下面 Worker 的环境变量里，
> 不要发给任何人，不要写进网页代码，不要截图发群里。
> 另一个 `anon` / `publishable` 密钥这里用不到。

---

## 第二步：Cloudflare 新建 Worker

1. 打开 <https://dash.cloudflare.com>，登录（没有账号就注册一个，免费）
2. 左侧 **Workers & Pages** → **Create** → 选 **Worker** → **Start with Hello World!**
3. 名字填 `eira-push`，点 **Deploy**
4. 部署成功后点 **Edit code**（编辑代码）
5. 左边点开 `worker.js`（或 `index.js`），右边全选、删掉
6. 打开本仓库的 [`worker/push.js`](./push.js)，**整个文件**复制，粘进去
7. 右上角 **Deploy**

这时打开 Worker 的地址（形如 `https://eira-push.你的名字.workers.dev`），会看到：

```
Eira 推送服务器：环境变量还没填全，见 worker/PUSH.md
```

正常，下一步填。

---

## 第三步：生成密钥

浏览器打开 Worker 地址后面加 `/setup`：

```
https://eira-push.你的名字.workers.dev/setup
```

页面上会显示三行：

```
VAPID_PUBLIC   BHx...（很长一串）
VAPID_PRIVATE  kP3...
DATA_KEY       9fQ...
```

**先别关这一页**，下一步要一行一行复制。（每次刷新都会生成新的一套；填进去之后这一页就不再显示了。）

---

## 第四步：填环境变量

回到 Worker 页面 → **Settings**（设置）→ **Variables and Secrets**（变量和机密）→ **Add**（添加）。

一项一项加，**Type（类型）全部选 Secret**，填完每项点 **Save**：

| Variable name（名字，一字不差） | Value（值） |
|---|---|
| `SUPABASE_URL` | 第一步记下的 Project URL，例如 `https://abcdefgh.supabase.co` |
| `SUPABASE_KEY` | 第一步记下的 **service_role** 密钥 |
| `VAPID_PUBLIC` | `/setup` 页面上 VAPID_PUBLIC 后面那串 |
| `VAPID_PRIVATE` | `/setup` 页面上 VAPID_PRIVATE 后面那串 |
| `DATA_KEY` | `/setup` 页面上 DATA_KEY 后面那串 |
| `VAPID_SUBJECT` | `mailto:你的邮箱`，例如 `mailto:eira@example.com`（推送服务商联系你用，可不填） |
| `ALLOW_ORIGINS` | 应用的网址，只写到域名，例如 `https://eiraphone.cn`；有几个用英文逗号隔开（建议填，可不填） |

> **VAPID 三样和 DATA_KEY 定下来就不要再换。**
> 换了 VAPID，所有用户的订阅都要重做（关掉后台消息再打开）；换了 DATA_KEY，数据库里已有的任务全都解不开。
> 建议把这几串另外存一份在自己手上（网盘、U 盘都行）。

全部加完后，再打开一次 Worker 地址，看到下面这一行就对了：

```
Eira 推送服务器：已就绪
```

再打开 `/setup`，应该显示「密钥已经设置好了」。

---

## 第五步：加定时触发

Worker 页面 → **Settings** → **Trigger Events**（触发事件，有的版本叫 Triggers）→ **Add** → **Cron Triggers**：

- 选 **Custom**（自定义），填 `* * * * *`（五个星号，中间空格隔开，意思是每分钟一次）
- 点 **Add** / **Save**

这一步不做，任务永远不会到点发出。

---

## 第六步（建议做）：给 Worker 一个自己的域名

`*.workers.dev` 在中国大陆有时连不上。你的域名已经接在 Cloudflare 上了，给 Worker 加一个子域名：

Worker 页面 → **Settings** → **Domains & Routes** → **Add** → **Custom domain** → 填 `push.eiraphone.cn` → **Add domain**。

等状态变成 Active，打开 `https://push.eiraphone.cn/` 能看到「已就绪」就好了。

---

## 第七步：告诉应用

把推送服务器的地址告诉开发者（或自己改 `src/site.js`）：

```js
pushServer: 'https://push.eiraphone.cn',
```

改完推上去之后，用户在「设置 - 通知」里就能看到「后台消息」。

---

## 第八步：自己试一遍

1. 用**安卓 Chrome**打开应用，或者 **iPhone 上从主屏幕图标**打开（apk、ipa 也能试，只是没有通知，第 5 步之后直接打开应用看会话）
2. 找一个角色，在角色卡里打开「主动找你」，间隔先设短一点（例如 5 分钟），方便试
3. 「设置 - 通知」→ 打开 **后台消息**，系统问是否允许通知时点**允许**
4. 点 **发一条测试推送**：手机上应该马上弹出「推送服务器工作正常」
5. 回到桌面（或者直接划掉应用），等几分钟：角色的消息会以通知弹出来
6. 点通知回到应用：那几条已经在会话里，时间是它发出来的那一刻

在 Supabase 的 **Table Editor** 里可以看到任务的状态（`pending` 等着、`done` 发了、`failed` 没发成），
内容是密文，看不到原文，这是对的。

---

## 出了问题

| 看到的 | 原因与办法 |
|---|---|
| 设置里没有「后台消息」 | `site.js` 里 `pushServer` 没填 |
| apk、ipa 离开期间没有通知 | 正常：外壳里没有 Web Push，消息在打开应用时出现（见上面的表） |
| 打开开关时报「推送服务器的环境变量还没填全」 | 第四步有一项没填，或名字拼错。打开 Worker 地址看是不是「已就绪」 |
| 打开开关时报 `Failed to fetch` | Worker 地址打不开（大陆访问 `workers.dev` 常见，做第六步），或 `ALLOW_ORIGINS` 没写对应用的网址 |
| 测试推送能收到，角色消息收不到 | 第五步的定时触发没加；或者那个角色没开「主动找你」；或者未读已经堆到「用量与上限」里设的上限 |
| 离开应用好一会儿才发 | 应用退到后台时要向服务器说一声「走了」，iPhone 有时来不及说，服务器会等最多 6 分钟确认应用真的不在前台 |
| Supabase 里任务是 `failed` | 回到应用时会把原因记在控制台；常见是用户的接口余额不足、密钥过期 |
| Worker 日志里有 `Exceeded CPU` | 免费套餐每次只给 10 毫秒 CPU，聊天记录很长时可能不够。Workers 付费套餐（每月 5 美元）没有这个问题 |
| 很久不用之后 Supabase 项目被暂停 | 免费项目一周没有任何访问会被暂停。只要有人开着后台消息，每分钟都有访问，不会停；停了去 Supabase 后台点 Restore |

---

## 费用

- **Cloudflare Workers 免费版**：每天 10 万次请求。一个开着后台消息的用户，应用开着时每 4 分钟报到一次，
  离开和回来各一次，加上定时触发每分钟一次（所有用户共用），一般用户几百人都够
- **Supabase 免费版**：500 MB 数据库。任务取回就删，占不了多少
- **模型调用**：花的是用户自己的接口额度，和应用开着时角色主动找你是同一笔钱，服务器不多花
