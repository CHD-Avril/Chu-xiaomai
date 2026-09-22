# 分支保护钩子

本项目通过 Git 钩子实现 **main 分支写入保护**：只有 `admin-users.txt` 白名单中的管理员可以在 main 分支直接 commit / push；其他人切到 main 提交、或向 main push 都会被拦截，必须走自己的分支 + Pull Request 合并。

## 钩子内容

| 文件 | 作用 |
|---|---|
| `pre-commit` | 在 main 分支上 commit 时校验身份，非管理员拒绝 |
| `pre-push` | push 到 `refs/heads/main` 时校验身份，非管理员拒绝 |
| `admin-users.txt` | 管理员白名单（按 git user.name 或 user.email 匹配，每行一个） |

## 启用方式（每个克隆本仓库的人都要执行一次）

```powershell
git config core.hooksPath .githooks
```

启用后即可生效。要验证是否生效：

```powershell
git config core.hooksPath   # 应输出 .githooks
```

## 新增管理员

在 `admin-users.txt` 中新增一行，填入对方的 git user.name 或 user.email。

## 远程层保护（重要，仍需配置）

本地钩子只保护"本机"的提交行为，**不阻止其他设备/网页端直接 push**。要真正封死 main，还需在 GitHub 网页端配置分支保护规则：

1. 打开仓库 → **Settings → Branches → Add branch protection rule**
2. Branch name pattern 填 `main`
3. 勾选 **Require a pull request before merging**（可要求 1 个审批）
4. 勾选 **Require status checks**（可选）
5. 保存

> 提示：仓库 Owner 默认可以绕过分支保护，普通协作者则必须走 PR。

## 常用工作流

```powershell
# 日常开发：在自己的分支（如 Avril）上提交
git checkout Avril
git add .
git commit -m "..."

# 开发完成后合并到 main（需管理员身份，或在 GitHub 上发 PR）
```
