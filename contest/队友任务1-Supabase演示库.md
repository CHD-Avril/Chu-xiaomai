# 队友任务 1：搭建 Supabase 演示数据库（约 15 分钟）

## 背景

我们的「长大小麦君点歌台」要参加 2026 Qoder 高校创造力大赛，需要部署一个**公网演示版**。
演示版必须用一个**全新的、独立的 Supabase 项目**存数据，绝对不能碰正式校园站的数据库。

> ⚠️ 红线：正式站项目是 `aiblivjuhccwcwwrwxsl.supabase.co`（chuxiaomai.cyou 在用）。
> 本任务的所有 SQL **只能在新建的演示项目里运行**，在正式项目里运行会清空正式站数据。

## 你需要先拿到的东西

两个 SQL 文件就在**本仓库的 `sql/` 目录**下（代码仓库里对应 `Chu-xiaomai/supabase-reset-and-rebuild.sql` 和 `Chu-xiaomai/contest/demo-seed.sql`）：

| 文件 | 用途 |
|---|---|
| `sql/supabase-reset-and-rebuild.sql` | 重建完整表结构和权限 |
| `sql/demo-seed.sql` | 灌入演示歌单、曲库、公告 |

## 步骤

### 1. 注册 / 登录 Supabase

打开 https://supabase.com/dashboard ，用 GitHub 账号登录即可（免费，不需要信用卡）。

### 2. 新建项目

点 **New project**：

- Name：`chu-contest-demo`
- Database Password：点生成按钮用随机强密码，**自己保存好，不要发到群里**（后面基本用不到，但找回麻烦）
- Region：`Northeast Asia (Tokyo)` 或 `Southeast Asia (Singapore)`
- Plan：Free

点 Create，等 1–2 分钟项目就绪。

### 3. 关闭邮箱验证（重要）

左侧 **Authentication → Sign In / Providers → Email**：

- 把 **Confirm email** 关掉 → Save。

不关的话演示账号登录会要求收验证邮件，演示就卡住了。

### 4. 运行建表脚本

左侧 **SQL Editor → New query**：

1. 把 `supabase-reset-and-rebuild.sql` **全文**粘贴进去（文件很长，约 2700 行，必须完整）。
2. 点 **Run**。
3. 成功标志：结果区显示 `重建完成：业务数据已清空……`。

### 5. 运行演示数据脚本

再 **New query**：

1. 把 `contest/demo-seed.sql` 全文粘贴 → Run。
2. 成功标志：显示 **`演示种子完成：2 个征集期，12 首曲库，11 首投稿，27 条喜欢。`**
3. 这个脚本可以重复运行，不会重复灌数据。

### 6. 创建 3 个演示账号

左侧 **Authentication → Users → Add user → Create new user**，逐个创建：

| 邮箱 | 用途 |
|---|---|
| `admin@chu.demo` | 管理员（脚本已授权，建好即可用） |
| `judge@chu.demo` | 评委 / 体验用户 |
| `student@chu.demo` | 普通体验用户 |

- 密码三个统一用：`ChuDemo#2026`（这是**故意公开的演示密码**，参赛帖里要写给评委用，不算泄密）。
- 如果 Add user 里有 Auto Confirm 选项，勾上。

### 7. 取回两个公开值，发给负责部署的同学

左侧 **Settings → API**（或 Settings → API Keys）：

- **Project URL**（形如 `https://xxxx.supabase.co`）
- **anon public key**（很长的一段 `eyJ...` 或 `sb_publishable_...`）

这两个值**本来就是设计为公开的**（前端代码里会带），直接发群里没问题。

### 8. service_role / secret key 的保管（重要）

同一页还有一个 **service_role key**（或新版叫 **Secret key**，`sb_secret_...`）：

- ❌ 不要发群聊、不要贴进代码、不要截图发出来。
- ✅ 只交给负责部署的同学，让 TA 在 Qoder Sites 的 Settings → Secrets 里粘贴一次（见任务 2）。
- 传递方式：私聊 + 阅后即焚，或密码管理器分享。拿到 anon key 和 URL 不影响这一步。

## 完成自检

- [ ] 新项目名 `chu-contest-demo`，不是正式站项目
- [ ] Confirm email 已关闭
- [ ] 两个 SQL 都运行成功，种子结果显示 2 期 / 12 曲库 / 11 投稿 / 27 喜欢
- [ ] 3 个演示账号已创建
- [ ] Project URL + anon key 已发给部署同学
- [ ] service key 没有出现在任何群聊 / 代码 / 截图里

## 常见问题

- **SQL 报错 `请先完整运行 supabase-reset-and-rebuild.sql`**：说明第 4 步没成功，先重跑建表脚本。
- **SQL 报错提到锁 / 其他会话**：关掉该项目的 Table Editor 标签页再 Run。
- **项目过几天显示 Paused**：免费项目一周无活动会暂停，去 Dashboard 点 Restore 即可，数据不丢。比赛期间（11 月底前）记得偶尔打开一下保持活跃。