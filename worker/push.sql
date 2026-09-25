-- Eira 后台消息服务器的表（worker/push.js）。在 Supabase 的 SQL Editor 里整段粘贴、运行一次即可。
--
-- 订阅、任务、结果三列存的都是 Worker 加密过的密文（它的 DATA_KEY），这里看不到原文。
-- 两张表都打开行级安全（RLS）且不写任何策略：只有 service_role 密钥（Worker 用的那一把）读写得了，
-- 网页上公开的 anon 密钥一行都碰不到。

create table if not exists push_devices (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null,               -- 设备口令的哈希，口令本身只在那台设备上
  sub         text,                        -- Web Push 订阅（密文）；安装版应用没有，为空
  seen_at     timestamptz,                 -- 应用最近一次报到；为空表示应用已经退到后台
  created_at  timestamptz not null default now()
);

create table if not exists push_jobs (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null references push_devices(id) on delete cascade,
  due_at      timestamptz not null,        -- 什么时候发
  status      text not null default 'pending',   -- pending 等着 | running 正在发 | done 发了 | failed 没发成
  data        text not null,               -- 任务（密文）：要发给模型的请求、会话、之后几次的时间
  result      text,                        -- 结果（密文）：角色说的话，或者没发成的原因
  fired_at    timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists push_jobs_due on push_jobs (status, due_at);
create index if not exists push_jobs_device on push_jobs (device_id);

alter table push_devices enable row level security;
-- 早先按「订阅必填」建过表的，补这一句（没建过的跑了也无妨）
alter table push_devices alter column sub drop not null;
alter table push_jobs enable row level security;
