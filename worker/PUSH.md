# 后台消息：自己部署推送服务器

部署完成后，在「设置 - 通知 - 后台消息」中填入推送服务器地址并打开开关：**应用关闭期间，
开启了「主动找你」的角色仍会按原定时间发来消息**，回到应用时这些消息已在会话中，并可在离开期间弹出通知。

推送服务器部署在**你自己的** Cloudflare 与 Supabase 账号上：模型调用用的是你自己的接口额度，
消息与接口密钥只存放在你自己的数据库里，不经过任何其他人。全程在网页上操作，不需要自己的服务器，
不需要安装软件，约 30 分钟。两家的免费额度对个人使用足够。

> Cloudflare 与 Supabase 的后台会不定期改版，按钮名称和位置可能与本文略有出入。
> 找不到时按含义查找：「新建项目」「SQL 编辑器」「新建 Worker」「编辑代码」「部署」「环境变量」「定时触发」。

---

## 先了解这几点

**它是怎么工作的**

1. 离开应用时，应用把「哪个角色、几点开口、到时要发给模型的那一次请求」交给推送服务器
2. 推送服务器每分钟检查一次，到时间后代为调用模型，保存角色的回复，并发出通知
3. 回到应用时，应用取回这些回复，写入会话，服务器上随即删除

| 组成 | 作用 |
|---|---|
| **Cloudflare Worker**（Worker 代码） | 接收任务、到时间调用模型、发通知。每分钟由定时触发唤醒一次 |
| **Supabase**（建表 SQL） | 数据库，存放设备登记、待发任务与调用记录 |

**接口密钥与聊天内容**：到时间调用模型需要你的接口密钥，因此任务中带有密钥和该段对话的上下文。
Worker 收到后先用 `DATA_KEY` 加密，再存入 Supabase，数据库中只有密文。结果取回后即删除。

**不额外花费**：这是原本就会发生的「主动找你」，换由服务器发出。应用开着时由手机自己发出，
关闭时由服务器发出，同一次不会两边都发。

**防止失控**：服务器从不自动重试；每台设备 24 小时内调用模型的次数有上限，同一段会话两次之间有最短间隔；
另有一个急停开关。见第四步与「急停与查账」。

**各版本的通知方式**：消息都由服务器按时生成并保存，打开应用时一定会出现在会话中。离开期间能否弹出通知，
取决于所用版本：

| 版本 | 离开期间 | 打开应用时 |
|---|---|---|
| 安卓 Chrome / Edge（浏览器或添加到主屏幕） | 系统通知 | 消息在会话中 |
| iPhone：Safari「添加到主屏幕」后从主屏幕图标打开（iOS 16.4 及以上） | 系统通知 | 消息在会话中 |
| iPhone：直接在 Safari 标签页中使用 | 无系统通知，可用通知通道（第八步） | 消息在会话中 |
| 电脑 Chrome / Edge / Firefox | 系统通知（浏览器须在运行） | 消息在会话中 |
| 安装版 apk、ipa | 无系统通知，可用通知通道（第八步）：iPhone 用 Bark，任何手机用 PushPlus | 消息在会话中，时间为当时发出的时刻 |

---

## 第一步：Supabase 建数据库

1. 打开 <https://supabase.com>，点 **Start your project**，用 GitHub 账号或邮箱注册
2. 点 **New project**（新建项目）
   - **Name**：任意，例如 `eira-push`
   - **Database Password**：点 Generate 生成，**自行保存**
   - **Region**：选离自己近的，国内选 **Northeast Asia (Tokyo)** 或 **Southeast Asia (Singapore)**
   - 套餐选 **Free**
3. 点 **Create new project**，等待一两分钟
4. 左侧菜单点 **SQL Editor**，再点 **New query**
5. 在 Eira 的「部署教程」页顶部点 **复制建表 SQL**，粘贴到编辑器中（在电脑上阅读本文时，复制仓库中 `worker/push.sql` 的全部内容）
6. 点右下角 **Run**。下方显示 `Success. No rows returned` 即完成
7. 左侧点 **Table Editor**，能看到 `push_devices`、`push_jobs`、`push_log` 三张表

### 记下两项

左下角 **Project Settings**（齿轮）：

- **项目地址**：在 **General** 中找到 **Project ID**（一串字母），项目地址为

  ```
  https://你的Project ID.supabase.co
  ```

  例如 Project ID 是 `abcdefghijk`，地址就是 `https://abcdefghijk.supabase.co`。
  （有的版本在 **Data API** 页直接显示 **Project URL**，与此相同。）
- **service_role 密钥**：在 **API Keys** 中找到 **service_role**（有的版本叫 `secret` key），点 Reveal 后复制

> **service_role 密钥可以读写整个数据库**，只填进下面 Worker 的环境变量，不要发给任何人，不要截图外传。
> 另一个 `anon` / `publishable` 密钥这里用不到。

---

## 第二步：Cloudflare 新建 Worker

1. 打开 <https://dash.cloudflare.com>，注册并登录（免费）。询问是否添加网站时跳过
2. 左侧 **Workers & Pages** → **Create** → 选 **Worker** → **Start with Hello World!**
3. 名称填 `eira-push`，点 **Deploy**
4. 部署完成后点 **Edit code**（编辑代码）
5. 左侧点开 `worker.js`（或 `index.js`），右侧全选并删除
6. 在 Eira 的「部署教程」页顶部点 **复制 Worker 代码**，粘贴进去（电脑上阅读时，复制仓库中 `worker/push.js` 的全部内容）
7. 右上角点 **Deploy**

此时打开 Worker 的地址（形如 `https://eira-push.你的名字.workers.dev`），显示：

```
Eira 推送服务器：环境变量还没填全，见 worker/PUSH.md
```

属于正常，下一步填写。

---

## 第三步：生成密钥

在浏览器中打开 Worker 地址并在末尾加上 `/setup`：

```
https://eira-push.你的名字.workers.dev/setup
```

页面显示三行：

```
VAPID_PUBLIC   BHx…（很长一串）
VAPID_PRIVATE  kP3…
DATA_KEY       9fQ…
```

**保持此页打开**，下一步逐行复制。每次刷新都会生成新的一套；填好之后此页不再显示密钥。

---

## 第四步：填写环境变量

Worker 页面 → **Settings** → **Variables and Secrets** → **Add**。

逐项添加，**Type 一律选 Secret**，每项填完点 **Save**：

| 名称（一字不差） | 值 |
|---|---|
| `SUPABASE_URL` | 第一步记下的项目地址，例如 `https://abcdefghijk.supabase.co` |
| `SUPABASE_KEY` | 第一步记下的 **service_role** 密钥 |
| `VAPID_PUBLIC` | `/setup` 页面上 VAPID_PUBLIC 后面那串 |
| `VAPID_PRIVATE` | `/setup` 页面上 VAPID_PRIVATE 后面那串 |
| `DATA_KEY` | `/setup` 页面上 DATA_KEY 后面那串 |
| `ALLOW_ORIGINS` | `https://eiraphone.cn`（只允许 Eira 调用；使用测试版时再加上测试版地址，英文逗号分隔） |
| `MAX_PER_DAY` | 每 24 小时最多代为调用模型几次。**建议先填 `5`**，确认一切正常后再调大 |
| `MIN_GAP_MIN` | 同一段会话两次之间至少间隔几分钟。建议 `15` |
| `VAPID_SUBJECT` | 可选。`mailto:你的邮箱` |

> **VAPID 三项与 DATA_KEY 确定后不要更换。** 更换 VAPID 后需要在应用里关闭后台消息再重新打开；
> 更换 DATA_KEY 后数据库中已有的任务全部无法解开。建议另存一份。

全部填完后再打开 Worker 地址，显示下面一行即完成：

```
Eira 推送服务器：已就绪
```

---

## 第五步：添加定时触发

Worker 页面 → **Settings** → **Trigger Events**（有的版本叫 Triggers）→ **Add** → **Cron Triggers**：

- 选 **Custom**，填 `* * * * *`（五个星号，以空格分隔，表示每分钟一次）
- 点 **Add** / **Save**

缺少这一步，任务永远不会按时发出。

---

## 第六步（可选）：绑定自己的域名

`*.workers.dev` 在中国大陆有时无法访问。如果你有接入 Cloudflare 的域名，可给 Worker 加一个子域名：

Worker 页面 → **Settings** → **Domains & Routes** → **Add** → **Custom domain** → 填例如 `push.你的域名` → **Add domain**。

状态变为 Active 后，用这个地址替代 `workers.dev` 的地址。

---

## 第七步：填进 Eira

1. Eira →「设置 - 通知」→ **后台消息**
2. 在 **推送服务器地址** 中填入 Worker 的地址（`https://` 开头，不带末尾的斜杠）
3. 打开 **后台消息** 开关。系统询问是否允许通知时点**允许**
4. 能够接收系统通知的版本会出现 **发一条测试推送**，点一下，应立即收到「推送服务器工作正常」
5. 找一个角色，在角色卡中打开「主动找你」
6. 离开应用，到了该角色开口的时间，会收到通知；点开后消息已在会话中，时间为它发出的时刻

---

## 第八步（可选）：通知通道

安装版应用（apk、ipa）和 Safari 标签页没有系统推送，可以借其他应用送达通知。在「后台消息」中选择 **通知通道**：

| 通道 | 适合 | 点击通知 | 隐私 |
|---|---|---|---|
| **Bark**（App Store 免费） | iPhone，尤其是 ipa | 直接打开 Eira 的对应会话（须使用新版 ipa） | 可加密，Bark 的服务器看不到内容 |
| **PushPlus**（微信公众号） | 任何手机，国内最稳定 | 在微信中查看，需自行打开 Eira | 内容经过 PushPlus 的服务器 |

两种通道都有 **通知中不显示消息内容**：开启后通知只显示「某某发来一条消息」。

### Bark（iPhone）

1. App Store 搜索 **Bark** 安装，打开并允许通知
2. 首页那一栏地址形如 `https://api.day.app/一串字母数字/...`，点击复制
3. Eira 中通知通道选 **Bark**，粘贴到「Bark 推送地址」
4. 点 **测试通知通道**，应收到「通知通道工作正常」
5. 建议开启加密：Bark 右下角「设置」→「推送加密」，算法选 **AES256**、模式选 **CBC**，Key 填 32 位、IV 填 16 位（字母数字均可，自行编写），保存；Eira 中「加密 Key」「加密 IV」填入相同内容，再测试一次

### PushPlus（微信）

1. 打开 <https://www.pushplus.plus>，用微信扫码登录
2. 按提示关注「pushplus 推送加」公众号（不关注收不到）
3. 在「一对一消息」中复制 **token**
4. Eira 中通知通道选 **PushPlus**，粘贴到「PushPlus token」
5. 点 **测试通知通道**，微信中应收到一条消息

PushPlus 免费版每天有发送条数上限，用完当天不再发送通知（消息照常生成，打开 Eira 时出现）。

---

## 急停与查账

**急停**：Worker 的环境变量中添加 `PAUSED`，值填 `1`，保存。服务器立即停止调用模型；删除这一项即恢复。
发现任何异常（通知过多、接口扣费异常）时先急停，再排查。

**查账**：Supabase → **Table Editor** → `push_log`。服务器每调用一次模型记一行（调用之前记录，失败也计入），
保留两天。行数应与收到的消息次数相符。应用开着的期间不应出现新的行（那时由手机自己发出）。

**上限**：`MAX_PER_DAY` 是每台设备 24 小时内的调用上限，超出的任务记为失败、不调用；
`MIN_GAP_MIN` 是同一段会话的最短间隔，过近的任务顺延、不调用。

---

## 已经按旧版建过表

建表 SQL 后来增加了内容（通知通道、调用记录）。已经建过表的，在 SQL Editor 中把新的建表 SQL 整段再运行一次：
每一句都会跳过已存在的部分，不影响已有数据。然后把 Worker 的代码换成新版并 Deploy。

---

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| 后台消息的开关是灰的 | 还没有填写推送服务器地址，或地址不是 `https://` 开头 |
| 打开开关时提示「推送服务器的环境变量还没填全」 | 第四步有一项未填或名称拼错。打开 Worker 地址，确认显示「已就绪」 |
| 打开开关时提示 `Failed to fetch` | Worker 地址无法访问（大陆访问 `workers.dev` 常见，参考第六步），或地址填错 |
| 提示「这个网站不在 ALLOW_ORIGINS 里」 | `ALLOW_ORIGINS` 中没有当前使用的网址。正式版填 `https://eiraphone.cn`，测试版另外加上测试版网址 |
| 测试推送能收到，角色消息收不到 | 缺少第五步的定时触发；或该角色没有打开「主动找你」；或未读已达「用量与上限」中设定的上限；或已达 `MAX_PER_DAY` |
| 离开应用后过了一段时间才发出 | 应用退到后台时会通知服务器；iPhone 有时来不及通知，服务器最多等待 6 分钟确认应用已不在前台 |
| apk、ipa 离开期间没有通知 | 安装版没有系统推送，设置第八步的通知通道；不设置时消息在打开应用时出现 |
| Bark 提示 404 / 400 | 推送地址复制不完整，须从 Bark 首页复制完整的 `https://api.day.app/...` |
| Bark 收到乱码或无法打开 | Bark 的加密设置与 Eira 中不一致：算法 AES（128/192/256 对应 Key 16/24/32 位）、模式 CBC，Key 与 IV 两边完全相同 |
| 点击 Bark 通知没有打开 Eira | 使用的是旧版 ipa，新版 ipa 才支持跳转 |
| PushPlus 提示 token 错误 | token 复制不完整，或尚未关注「pushplus 推送加」公众号 |
| Worker 日志中出现 `Exceeded CPU` | 免费套餐每次只有 10 毫秒 CPU，聊天记录很长时可能不够。Workers 付费套餐（每月 5 美元）没有此限制 |
| Supabase 项目被暂停 | 免费项目一周无访问会暂停。开着后台消息时每分钟都有访问，一般不会暂停；已暂停时在 Supabase 后台点 Restore |

---

## 费用

- **Cloudflare Workers 免费版**：每天 10 万次请求。定时触发每天 1440 次，加上应用开着时每 4 分钟一次报到，个人使用远用不完
- **Supabase 免费版**：500 MB 数据库。任务取回即删，调用记录保留两天，占用很少
- **模型调用**：使用你自己的接口额度，与应用开着时角色主动发消息是同一笔费用；上限由 `MAX_PER_DAY` 控制
