# 楚小麦点歌台

楚小麦点歌台是为校园广播点歌活动设计的轻量级 Web 应用。它把“投稿歌曲、点赞排序、管理员征集期管理、公告发布、历史歌单归档”放在同一个页面里，适合广播台在固定征集窗口内收集同学们的点歌需求，并在活动结束后快速整理播放歌单。

项目采用纯前端架构，数据存储和权限策略由 Supabase 承担，便于部署到 Firebase Hosting、GitHub Pages 或其他静态站点平台。

## 功能概览

- 歌曲投稿：同学可提交歌曲名和歌手名，系统会按当前开放征集期归档。
- 点赞投票：同一访客可为喜欢的歌曲点赞，歌单支持按热度排序。
- 征集期管理：管理员可设置当前点歌征集期的标题、开始时间和结束时间。
- 自动状态切换：征集期内开放投稿和点赞，结束后进入公示/只读状态。
- 公告发布：管理员可发布或关闭当前公告，用于同步活动说明和版本通知。
- 历史归档：已归档征集期可回看投稿结果，并支持导出榜单。
- 响应式界面：适配桌面和移动端，方便现场运营和同学访问。

## 技术栈

- 前端：HTML、CSS、原生 JavaScript
- 数据服务：Supabase Database、Row Level Security
- 部署：Firebase Hosting 或任意静态站点托管

## 目录结构

```text
.
|-- public/
|   |-- index.html              # 页面结构
|   |-- app.js                  # 前端交互与 Supabase 数据逻辑
|   |-- styles.css              # 页面样式
|   `-- supabase-config.js      # Supabase 连接配置
|-- supabase-schema.sql         # 数据表与 RLS 策略初始化脚本
|-- supabase-rls-setup.sql      # Supabase 权限配置参考
|-- firebase.json               # Firebase Hosting 配置
`-- README.md
```

根目录下的 `index.html`、`styles.css`、`app.js` 用于兼容部分静态部署方式；实际维护时优先关注 `public/` 目录。

## 快速开始

1. 创建 Supabase 项目，并在 SQL Editor 中执行 `supabase-schema.sql`。
2. 打开 `public/supabase-config.js`，填入 Supabase `Project URL` 和 `anon public key`。
3. 本地直接打开 `public/index.html`，或使用任意静态服务器预览。
4. 部署到 Firebase Hosting 时，确认 `firebase.json` 的 public 目录指向 `public`。

## 数据表

项目主要使用以下表：

- `playlist_periods`：保存每一期征集活动的标题、时间窗口、状态和创建者。
- `songs`：保存歌曲投稿，使用征集期 ID 作为歌单归属。
- `song_likes`：保存访客点赞记录，避免同一访客重复点赞同一首歌。
- `announcements`：保存管理员公告及启用状态。

完整字段、索引和 RLS 策略以 `supabase-schema.sql` 为准。

## 管理员功能

页面右上角可进入管理员入口。管理员登录后可以：

- 创建或更新当前征集期。
- 归档当前歌单。
- 发布或关闭公告。
- 查看历史征集期投稿。
- 复制或下载导出歌单。

管理员账号目前由前端常量维护，适合校园活动的小规模内部使用。如果后续要开放给更多成员协作，建议迁移到 Supabase Auth 或服务端鉴权。

## 部署说明

### Firebase Hosting

```powershell
firebase deploy
```

部署前请确认：

- `public/supabase-config.js` 已配置可用的 Supabase 项目。
- Supabase 数据表和 RLS 策略已经初始化。
- 不要在前端文件中放入 `service_role key`。

### 其他静态托管

将 `public/` 目录作为站点根目录上传即可。项目不依赖 Node.js 服务端运行。

## 安全注意事项

- 前端只允许使用 Supabase `anon public key`。
- `service_role key` 只能保存在可信服务端或本地管理环境中，不能提交到仓库。
- 当前管理员登录属于轻量级前端门禁，不适合作为高安全等级的权限系统。
- 生产使用前请检查 Supabase RLS 策略，确保匿名用户只能执行预期范围内的读写操作。

## 项目定位

这个项目不是通用音乐平台，而是面向校园广播点歌活动的一套运营工具。它的目标是让广播台用最少的维护成本完成一次完整点歌流程：开启征集、收集投稿、汇聚热度、公告同步、归档导出。
