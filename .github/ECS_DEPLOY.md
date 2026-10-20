# ECS 自动部署

生产分支为 `Avril`。用户端地址为 `https://chuxiaomai.cyou/`，管理端地址为 `https://chuxiaomai.cyou/admin/`。

流程：GitHub 上检查两个应用及 QQ 授权后端 → 上传静态构建和后端源码 → 用专用 SSH 账号传到 ECS → 切换版本并重启 QQ 服务 → 检查两个页面、授权后端和版本号。任何检查失败都不会开始发布；发布后的健康检查失败会恢复上一版前后端。若等待发布期间 `Avril` 已有新提交，旧运行会跳过发布。

**QQ 登录升级前置步骤：** 原来的部署仅包含静态站，必须先按 [QQ 登录接入](../docs/QQ_LOGIN.md) 安装 `chu-qq-auth.service`、服务端密钥配置和 Nginx `/qq/` 代理，再执行新版流水线。没有初始化授权服务时，新发布会在切换前停止。以下原有 SSH 初始化只负责静态目录和上传权限；QQ 安装另行只授予部署账号重启 `chu-qq-auth.service` 的 sudo 权限。

## 1. 在 ECS 终端初始化（仅首次需要）

以现有 root 账号在阿里云网页终端执行：

```bash
cd /root/chu-xiaomai-review-5eRNE4 &&
git pull --ff-only &&
if [ ! -f /root/chu-xiaomai-actions ]; then
  ssh-keygen -t ed25519 -C "github-actions-chu-xiaomai" \
    -f /root/chu-xiaomai-actions -N ''
fi
```

上面的命令成功后执行：

```bash
bash scripts/setup-ecs-deploy.sh "$(cat /root/chu-xiaomai-actions.pub)"
```

看到 `Ready: chu-deploy can publish through SSH without sudo.` 表示初始化完成。

该脚本创建专用账号 `chu-deploy`，不授予 sudo 权限，授权它维护 `/var/www/chu-xiaomai`。脚本会保留现有页面副本，将 `user`、`admin` 改为指向 `current` 的链接，并测试现有 HTTPS 页面；初始化失败会恢复原目录。现有 Nginx 配置和 HTTPS 证书不需要改动。

生成 SSH 主机校验内容：

```bash
awk '{print "47.109.105.20 " $1 " " $2}' /etc/ssh/ssh_host_ed25519_key.pub
```

输出的整行用于下一步的 `ECS_KNOWN_HOSTS`。

## 2. 在 GitHub 填入配置

打开仓库 → **Settings → Secrets and variables → Actions → Secrets → New repository secret**。

添加以下 4 项：

| Secret 名称 | 内容 |
| --- | --- |
| `ECS_HOST` | `47.109.105.20` |
| `ECS_USER` | `chu-deploy` |
| `ECS_SSH_KEY` | 下方命令输出的完整私钥，含 BEGIN 和 END 行 |
| `ECS_KNOWN_HOSTS` | 上一步 awk 命令输出的整行 |

在 ECS 终端显示部署私钥：

```bash
cat /root/chu-xiaomai-actions
```

将其直接复制到 GitHub 的 `ECS_SSH_KEY` Secret。不要把私钥发到聊天、提交到仓库或填入 Variables。

若网页终端复制多行内容时出现 `error in libcrypto`，可以改用单行 base64。在 ECS 上执行：

```bash
base64 -w 0 /root/chu-xiaomai-actions; printf '\n'
```

将输出的整行直接替换同一个 `ECS_SSH_KEY` Secret，流水线会自动解码。base64 内容同样属于私钥，不应发到聊天。脚本兼容 Windows 换行，并在连接服务器前验证私钥格式；只接受无口令的部署私钥。

SSH 端口已确认为 22，无需额外填写。若以后更换端口，在 Variables 添加 `ECS_PORT`，并将 `ECS_KNOWN_HOSTS` 中的主机前缀改为 `[47.109.105.20]:新端口`。

## 3. 启用并执行首次发布

全部配置完成后，在同一页面的 **Variables → New repository variable** 添加：

| Variable 名称 | 值 |
| --- | --- |
| `ECS_DEPLOY_ENABLED` | `true` |

随后进入 **Actions → CI → Run workflow**，选择 **Avril** 并运行。

检查 `Build (user)`、`Build (admin)`、`Check deployment scripts`、`Deploy to ECS` 均为绿色。首次发布成功后，今后向 `Avril` 推送代码就会自动检查并部署；其他分支和 PR 只做检查。

尚未启用时，`Deploy to ECS` 显示 skipped 属于正常状态。SSH 超时需要核对 ECS 安全组及 SSH 服务是否允许 GitHub runner 通过 TCP 22 连接；`Permission denied` 则核对私钥和账号。

## 发布目录与验证

```text
/var/www/chu-xiaomai/
├── user -> current/user
├── admin -> current/admin
├── current -> releases/某个版本
├── releases/
├── incoming/
├── user.before-actions-首次初始化时间
└── admin.before-actions-首次初始化时间
```

发布版本号由提交 SHA、Actions run ID 和重试次数组成。两端通过同一个 `current` 链接切换，不需要重启 Nginx；服务器不再运行 npm 构建。

健康检查在服务器上经本地 Nginx 验证 HTTPS 首页、管理端页面、两端的 `REVISION`，以及 `/qq/health` 的真实模式、配置和本次版本。后端跟随同一个 `current` 版本链接，发布和回滚均需重启该服务。页面或健康检查可访问不代表真实 QQ 扫码及数据库业务已通过，Supabase 仍是独立服务。

从浏览器访问 `/REVISION` 和 `/admin/REVISION`，应看到本次提交的完整 SHA。服务器源码目录不会随自动发布更新，线上文件位于 `releases`。

既往版本与初始化备份会保留，暂不自动删除。

## 暂停及手动回滚

暂停后续自动发布：将 `ECS_DEPLOY_ENABLED` 改为 `false`。已经运行的发布任务应等待完成。

手动回滚：先暂停自动发布并确认没有发布正在运行，以 root 在服务器上执行 `readlink /var/www/chu-xiaomai/current` 和 `ls -1 /var/www/chu-xiaomai/releases`，从记录中选定上一版本，然后执行（将 `上一版本目录名` 替换为真实目录名）：

```bash
cd /var/www/chu-xiaomai &&
test -s 'releases/上一版本目录名/user/index.html' &&
test -s 'releases/上一版本目录名/admin/index.html' &&
ln -s 'releases/上一版本目录名' .current-manual &&
mv -Tf .current-manual current &&
systemctl restart chu-qq-auth.service
```
