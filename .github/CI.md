# 自动检查

工作流文件：`workflows/ci.yml`，GitHub Actions 中显示为 **CI**。

## 触发方式

- 向任意分支推送代码。
- 创建或更新 Pull Request。
- 在仓库 Actions → CI → Run workflow 中手动运行。

除生产分支 `Avril` 外，同一分支、同一触发类型的新运行会取消之前尚未完成的运行。`Avril` 的运行不会中途取消，避免打断发布；ECS 发布任务也会串行执行。

## 检查内容

使用 Ubuntu 和 Node.js 22（与 ECS 的 Node.js 主版本一致），并行执行：

| 检查名称 | 应用目录 | 构建路径 |
| --- | --- | --- |
| Build (user) | `apps/user` | `/` |
| Build (admin) | `apps/admin` | `/admin/` |

每个检查先运行 `npm ci`，确保依赖能按提交的锁文件安装，再运行生产构建。安装或构建失败时，该检查会失败；两个应用独立报告结果。构建成功后上传产物，保留 7 天。

另有 `Check deployment scripts` 检查，校验 Bash 语法，并在临时目录测试成功发布、健康检查失败回滚、不完整产物及非法版本号的拒绝行为。测试不连接生产服务器。

SSH 配置回归检查使用临时生成的测试密钥和模拟传输，验证 LF、CRLF、单行 base64 的解析，以及损坏、公钥误填、有口令密钥在连接前被拒绝。

`Check database workflows` 在 `apps/admin` 安装锁定依赖后运行 `npm run test:db`，使用隔离的内存 PostgreSQL 检查管理工作流、数据库完整性、测试账号权限和清空重建的事务回滚。测试不会连接或修改线上 Supabase；该检查通过后才允许自动部署。

本地复现命令（在仓库根目录执行）：

```bash
npm --prefix apps/user ci
npm --prefix apps/user run build -- --base=/
npm --prefix apps/admin ci
npm --prefix apps/admin run build -- --base=/admin/
npm --prefix apps/admin run test:db
```

## 当前范围

CI 检查依赖安装、生产构建、部署脚本和数据库业务权限。项目目前没有配置 lint 或浏览器端到端测试，这些检查通过不能代替线上投稿、点赞和 QQ 登录流程的实际验证，也不会自动执行线上数据库迁移。

现有依赖漏洞尚待单独核查，本工作流没有将 `npm audit` 设为通过条件。

检查任务无需配置服务器密钥。只有在仓库变量 `ECS_DEPLOY_ENABLED=true`、分支为 `Avril`、触发类型为 push 或手动运行，且所有检查通过时，才会执行 `Deploy to ECS`。初始化及配置见 [ECS 自动部署](ECS_DEPLOY.md)。旧 GitHub Pages 和 Firebase 工作流是独立流程。

若以后需要禁止合并未通过 CI 的 PR，可在 GitHub 分支保护规则中将 `Build (user)`、`Build (admin)`、`Check database workflows` 和 `Check deployment scripts` 设为必需检查；仅添加 CI 不会自动启用分支保护。
