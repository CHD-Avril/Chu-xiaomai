# 分支保护说明（.githooks）

## 这套钩子是什么

`pre-commit` / `pre-push` 是**本地软约束**：防止协作者不小心在 `main` 分支上直接提交或推送。
管理员白名单见 `admin-users.txt`（按 `git user.name` 或 `git user.email` 匹配）。

**重要**：git 本地没有分支权限机制，钩子可被 `git commit --no-verify` 绕过。
**真正的强制**是 GitHub 分支保护规则（branch protection），必须配置：

## GitHub 远程强制配置（必须做，一次性）

仓库页面 → **Settings → Branches → Add branch protection rule**：

| 配置项 | 值 |
|--------|-----|
| Branch name pattern | `main` |
| ✅ Require a pull request before merging | 勾选（协作者不能直接 push，只能提 PR） |
| Require approvals | 1（PR 需管理员 approve 后合并） |
| 其余选项 | 保持默认（不勾选 status checks / 不勾选禁止管理员绕过） |

保存后效果：

- **仓库管理员（owner）**：可直接 push / 合并，不受限制；
- **其他协作者**：push 到 main 被 GitHub 拒绝 → 只能从自己的分支提 Pull Request → 管理员 approve 后合并。

## 启用本地钩子（每个协作者第一次 clone 后执行一次）

```powershell
git config core.hooksPath .githooks
```

## 管理员名单如何维护

编辑 `admin-users.txt`，添加成员的 `git user.name` 或 `git user.email`，提交到仓库共享。
注意：名单文件本身可被协作者修改，因此**远程保护**才是最终防线，钩子只用于防手滑。
