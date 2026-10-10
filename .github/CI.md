# 自动检查

工作流文件：`workflows/ci.yml`，GitHub Actions 中显示为 **CI**。

## 触发方式

- 向任意分支推送代码。
- 创建或更新 Pull Request。
- 在仓库 Actions → CI → Run workflow 中手动运行。

同一分支、同一触发类型的新运行会取消之前尚未完成的运行。

## 检查内容

使用 Ubuntu 和 Node.js 22（与 ECS 的 Node.js 主版本一致），并行执行：

| 检查名称 | 应用目录 | 构建路径 |
| --- | --- | --- |
| Build (user) | `apps/user` | `/` |
| Build (admin) | `apps/admin` | `/admin/` |

每个检查先运行 `npm ci`，确保依赖能按提交的锁文件安装，再运行生产构建。安装或构建失败时，该检查会失败；两个应用独立报告结果。

本地复现命令（在仓库根目录执行）：

```bash
npm --prefix apps/user ci
npm --prefix apps/user run build -- --base=/
npm --prefix apps/admin ci
npm --prefix apps/admin run build -- --base=/admin/
```

## 当前范围

CI 只检查依赖安装和生产构建。项目目前没有配置 lint 和自动化业务测试，构建通过不能代替投稿、点赞、登录及数据库权限的实际验证。

现有依赖漏洞尚待单独核查，本工作流没有将 `npm audit` 设为通过条件。

该工作流无需配置服务器密钥，不会发布到 ECS。旧 GitHub Pages 和 Firebase 工作流是独立流程。

若以后需要禁止合并未通过 CI 的 PR，可在 GitHub 分支保护规则中将 `Build (user)` 和 `Build (admin)` 设为必需检查；仅添加 CI 不会自动启用分支保护。
