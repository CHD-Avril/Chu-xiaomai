# 广播台明日歌单征集站

这是一个基于 `HTML + CSS + JavaScript + Bmob` 的静态网站，适合学校广播台每天征集下一天的歌单。

## 功能

- 投稿歌曲，要求填写歌名和作者
- 默认按点赞数排序
- 可切换为按投稿时间排序
- 支持搜索歌名或作者
- 分页浏览歌曲
- 基于本地访客标识，一台设备 / 一个浏览器对同一首歌只能点一次赞
- 页面默认只展示“明日歌单池”

## 使用方法

1. 在 Bmob 控制台创建应用。
2. 准备 `Application ID` 和 `REST API Key`。
3. 把 `public/bmob-config.js` 里的参数替换成你自己的项目参数。
4. 如需手动建表，可在 Bmob 控制台建立 `songs` 与 `songLikes` 两张表。
5. 把整个目录部署到任意静态网页服务器。

## 数据结构

### `songs`

```json
{
  "title": "晴天",
  "artist": "周杰伦",
  "titleLower": "晴天",
  "artistLower": "周杰伦",
  "playlistDate": "2026-03-31",
  "likesCount": 3,
  "createdBy": "local-visitor-id",
  "createdAt": "bmob auto timestamp"
}
```

### `songLikes`

```json
{
  "songId": "songs objectId",
  "userId": "local-visitor-id",
  "playlistDate": "2026-03-31",
  "createdAt": "bmob auto timestamp"
}
```

## 说明

- 当前版本为了保持纯静态部署，使用浏览器本地保存的访客标识来限制重复点赞，所以更准确地说是“一台设备 / 一个浏览器一票”。
- `Master Key` 绝对不要放到前端代码里；当前前端只会使用 `Application ID` 和 `REST API Key`。
- 如果后面你们希望严格做到“一个真实学生账号一票”，可以继续接校园统一身份认证、微信登录，或者改成自建后端。
