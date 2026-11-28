# 队友任务 2：Qoder Sites 部署与公网验收（约 30–60 分钟）

## 背景

把「长大小麦君点歌台」参赛演示版部署到 **Qoder Sites**，拿到一个公网可访问的网址（比赛硬性要求）。
演示版 = 用户端（`/`）+ 管理端（`/admin/index.html`）+ 一个投稿网关 Function，数据存在任务 1 建好的演示 Supabase 库里。

## 前置条件（缺一不可）

- [ ] 任务 1 已完成：拿到演示库 **Project URL** 和 **anon key**（群里发的公开值）
- [ ] 已从负责人处**私下**拿到 **service_role / secret key**（不在群聊里）
- [ ] 电脑装了 [Node.js](https://nodejs.org) ≥ 20（命令行 `node -v` 能输出版本）
- [ ] 装了 Qoder Desktop，并登录**参赛报名用的 Qoder 账号**（比赛要求用 Qoder 开发，部署也算开发过程，记得截图）

## 步骤

### 1. 拉取参赛代码

```bash
git clone -b contest-demo https://github.com/lzy718cr-code/Chu-xiaomai.git
cd Chu-xiaomai
```

### 2. 安装依赖

```bash
cd apps/user && npm install
cd ../admin && npm install
cd ../..
```

### 3. 配置演示库公开值

复制 `contest/.env.contest.example` 为 `contest/.env.contest`，填入任务 1 拿到的两个值：

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_ANON_KEY=eyJ...（或 sb_publishable_...）
```

这两个值是公开的，写进文件没问题。**service key 不写进任何文件。**

### 4. 让 Qoder 构建并部署

用 Qoder 打开 `Chu-xiaomai` 文件夹，在对话里发这段话（可微调）：

> 请先运行 `node scripts/build-contest.mjs` 构建参赛版，然后按 Qoder Sites 流程部署：静态目录 `contest/web`，Edge Function 目录 `contest/functions`（入口 index.ts），Function 名 `app`，`prepare_site` 的 secretNames 用 `CHU_DB_URL` 和 `CHU_DB_SECRET`。部署后设为公开访问，把公网网址给我。过程中每个关键步骤帮我截图留证。

Qoder 会完成打包、上传、发布。**其中有一步必须你本人做**（见第 5 步）。

### 5. 填写 Secrets（平台安全设计，AI 不能代填）

在 Qoder Sites 的 **Settings → Secrets** 里添加两条：

| Name | Value |
|---|---|
| `CHU_DB_URL` | 演示库 Project URL |
| `CHU_DB_SECRET` | service_role key（或 `sb_secret_...`） |

填完保存。值只在这个界面出现，**不要贴回聊天、不要截图带值的画面**。

### 6. 发布并确认公开

让 Qoder 继续 `publish_site` 并确认访问策略为公开，拿到形如 `https://xxxx.qoder.zone` 的网址。
浏览器无痕窗口打开验证：不登录也能看到榜单。

### 7. 验收清单（桌面 + 手机各做一遍）

打开 F12 控制台，**全程 0 红色报错**才算过（黄色 warning 可记录但不阻塞）。

**游客态：**
- [ ] 首页榜单有 8 首歌，《晴天》5 个赞排第一
- [ ] 投稿区曲库显示 12 首可选歌曲
- [ ] 公告栏有 2 条公告；「往期」页有 3 首歌
- [ ] 点喜欢 / 投稿按钮提示先登录，不能操作

**演示用户态（`judge@chu.demo` / `ChuDemo#2026`）：**
- [ ] 首页「演示登录」弹窗登录成功，头像区显示昵称
- [ ] 投稿《同桌的你》→ 提示成功，榜单出现这首歌
- [ ] 给《晴天》点喜欢 → 变 6 赞；再点取消 → 回到 5
- [ ] 点踩必须填理由（≤20 字），提交成功
- [ ] 退出登录 → 恢复游客态

**管理端（`/admin/index.html`，`admin@chu.demo` / `ChuDemo#2026`）：**
- [ ] 登录成功进入运营台
- [ ] 举报审核里有 2 条待审（一条为点踩触发，一条理由「课间播放太吵」），能批准 / 驳回
- [ ] 征集期管理能看到「参赛演示 · 校园点歌征集」

**手机端：** 重复游客浏览 + 登录投稿 + 点喜欢核心流程，控制台 0 报错。

### 8. 提交成果

把结果交到提交仓库 `submissions/任务2-部署验收/`（按里面的模板）：公网网址、逐项勾选的验收表、桌面和手机的控制台截图、关键页面截图、遇到的问题。

## 常见问题

- **投稿 / 登录返回 503**：Secrets 没填或填错（第 5 步），改完让 Qoder 重新发布或等 Function 生效。
- **管理端 404**：必须访问 `/admin/index.html`，Sites 禁用了目录索引，`/admin/` 打不开是正常的。
- **页面一直「正在读取」**：`.env.contest` 没配好就构建了，重跑第 3、4 步；或演示库 Paused 了，去 Supabase Dashboard 点 Restore。
- **登录提示「登录失败」**：确认任务 1 关了 Confirm email、账号已创建、密码是 `ChuDemo#2026`。

## 红线

- service key 不进聊天、不进代码、不进截图。
- 所有操作只针对演示库，不碰正式站 `aiblivjuhccwcwwrwxsl.supabase.co`。
- 部署用参赛报名的 Qoder 账号，过程截图留给参赛帖用。