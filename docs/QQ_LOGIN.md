# QQ 登录接入与验证

当前应用：小麦君歌曲征集平台，AppID `1905775107`。QQ 互联登记的回调为 `https://chuxiaomai.cyou/qq/callback`。

## 登录流程

1. 页头的「QQ 登录」链接直接访问本站 `/qq/authorize`，保留当前歌单页面，不等待 `/qq/session` 请求。
2. 后端生成随机 state，绑定发起浏览器的 HttpOnly、SameSite=Lax Cookie，再 302 到腾讯 `https://graph.qq.com/oauth2.0/authorize`，携带 `response_type=code`、AppID、回调和 `scope=get_user_info`。
3. 腾讯回到 `/qq/callback` 后，后端验证一次性 state 和浏览器 Cookie，再以相同回调地址向 `/oauth2.0/token` 交换授权码，获取 OpenID 和 `/user/get_user_info`。
4. 后端仅保存本站会话及显示资料，浏览器只接收随机 HttpOnly 会话 Cookie。AppKey、腾讯 access token 和 refresh token 不进入前端、URL 回跳或 localStorage。
5. 返回发起页面并显示头像、昵称；刷新由 `/qq/session` 校验，退出通过 `/qq/logout` 作废会话。

参考：[腾讯 Authorization Code 流程](https://wiki.connect.qq.com/使用authorization_code获取access_token)。QQ 登录与 Supabase 管理员、测试账号、访客投票身份分别处理。

## 本地试用

真实凭据只填写 `apps/user/qq-auth/.env.local`，此文件已被 Git 忽略。前端配置只包含 `VITE_QQ_AUTH_BASE=/qq`，不能使用 `VITE_` 保存密钥。

Windows 下运行仓库根目录的 `dev-up.ps1`。脚本启动本地 Vite、QQ 后端和 HTTPS 网关，并打开独立测试浏览器。仅该窗口把登记域名路由到本机；不更改系统 hosts、系统证书信任或云端网站。页面会标明「本地预览」。`scripts/stop-qq-local.ps1` 停止服务。

无真实授权的界面联调使用 `dev-up.ps1 -QqMode mock`，或在 `apps/user` 运行 `npm run dev:qq:mock` 与 `npm run dev`。模拟状态会明确标识，不能用于腾讯正式站审核。

## 首次在 ECS 安装（发布批准后执行）

前提：已有 ECS 静态站部署目录 `/var/www/chu-xiaomai/current`、`chu-deploy` 部署账号、`/usr/bin/node` 22 或更新版本、systemd、sudo 和已配置 HTTPS 的 Nginx。本次代码修复不会自动运行以下命令，也不会上传本机密钥。

1. 将代码更新到服务器的源码目录，或通过 `QQ deployment preflight` 工作流把安装文件暂存到服务器，以 root 执行对应目录的 `scripts/setup-qq-auth.sh`。
2. 首次在交互终端运行时，会提示粘贴已有 AppKey，输入不会显示；也可预先在服务器填写 `/etc/chu-xiaomai/qq-auth.env`。核对 AppID、域名、回调，文件保持 root:root、600，位于 Web 根目录之外，不放入发布包、聊天或 Git。安装脚本不打印密钥。
3. 脚本安装只监听 `127.0.0.1:3000` 的 `chu-qq-auth.service`，以独立的 `chu-qq-auth` 用户运行。它会给现有静态版本补装一个后端用于首次发布失败后的回滚，并为 `chu-deploy` 仅允许通过 sudo 重启这个单一服务。
4. 脚本会识别现有 `chuxiaomai.cyou` 的 HTTPS `server {}`，先备份到 `/etc/chu-xiaomai/`，再添加一行 `include /etc/nginx/snippets/chu-qq-auth.conf;`。保留原来的证书、用户端和 `/admin/` 路由，只有 `nginx -t` 通过后才重载；失败恢复原配置。匹配到多个站点或已有其他 `/qq/` 路由时会停止，交由人工确认。
5. 完成上述初始化后，使用现有 ECS 发布流程同时发布前端与授权后端。发布包只包含后端 `index.mjs`、`server.mjs` 和版本文件，不包含本地配置、开发证书、浏览器资料或日志。

生产启动会拒绝模拟模式、缺少凭据或 HTTP 回调。生产服务不读取仓库中的 `.env.local`。会话及未完成授权存在进程内存，服务重启后需要重新登录。

## 验证与重新提审

先运行：

```bash
node scripts/check-qq-login.mjs https://chuxiaomai.cyou
```

它验证 `/qq/health` 和 `/qq/session` 返回真实模式 JSON、授权入口返回腾讯 302、AppID、回调、scope 和 state Cookie 完整。返回 HTML、404、未配置或模拟模式都会失败。检查只探测入口，不使用凭据、不扫码、不代用户授权。

随后在普通浏览器访问正式网址，使用腾讯允许的开发者/测试账号完成登录，确认昵称头像、刷新恢复、歌单页面返回、退出和再次登录。实际可用账号范围以 QQ 互联后台为准；腾讯在授权页拒绝应用时，本站无法自行通过审核限制。

当前 ECS 流程会核对 `/qq/health` 中的版本与本次前端版本相同；后端缺失、启动失败或仍在运行旧版本时，发布失败并恢复之前的前后端。初始化脚本未执行时会在切换前拒绝发布，防止再次上线只有按钮的页面。

只有前端与后端都发布并完成真实登录后，再通知客服复查。自动测试通过或 `/qq/health` 正常都不能代替真实扫码验证。
