# 内容运营管理台

这是一个给 2-3 人内部使用的轻量网页工具，覆盖：

- 爆款标题库：来源平台、链接、互动数据、内容类型、赛道、人群、标题公式、情绪钩子
- 账号频率：账号定位、平台、负责人、周发布目标、禁发时段、偏好发布时间
- 发布数据：曝光、点击、点赞、收藏、评论、分享、涨粉、转化
- 建议看板：下周方向、频率缺口、标题公式复用、数据登记缺口

## 启动

在项目根目录运行：

```bash
npm run content-ops
```

默认地址：

```text
http://localhost:4322
```

小红书媒介投放跟踪台的稳定版地址：

```text
http://localhost:4322/xhs-media/
```

公司内网使用时，让同事访问这台电脑/服务器的内网 IP：

```text
http://内网IP:4322
```

小红书媒介投放跟踪台已启用访问密码。默认密码：

```text
xhs2026
```

共享数据会写到：

```text
content-ops/data.json
```

小红书媒介投放数据会写到：

```text
content-ops/xhs-media-data.json
```

每次保存前会自动备份到：

```text
content-ops/xhs-media-backups/
```

## 配置

可通过环境变量改端口和数据文件：

```bash
PORT=8080 CONTENT_OPS_DATA=/path/to/content-ops-data.json npm run content-ops
```

小红书媒介投放访问密码和数据文件也可以单独指定：

```bash
XHS_MEDIA_PASSWORD=你的新密码 XHS_MEDIA_DATA=/path/to/xhs-media-data.json npm run content-ops
```

如果只打开 `public/content-ops/index.html` 或用普通静态服务打开 `public/xhs-media/index.html`，页面也能运行，但数据只保存在当前浏览器本机，无法多人共享。

## 公网上线

推荐用 Render Web Service：

1. 把当前项目推到 GitHub。
2. 打开 Render，选择 New → Blueprint。
3. 连接这个 GitHub 仓库，Render 会读取根目录的 `render.yaml`。
4. 创建服务后，等待部署完成。
5. 访问 Render 生成的 `https://...onrender.com` 链接。
6. 小红书媒介投放跟踪台访问 `https://...onrender.com/xhs-media/`。

这个版本有小红书媒介投放跟踪台访问密码。上线后建议在 Render 环境变量里设置 `XHS_MEDIA_PASSWORD`，不要长期使用默认密码。

注意：小红书媒介投放跟踪台会在线写入数据，不建议用 Render Free 作为长期正式版。当前 `render.yaml` 已配置 1GB Persistent Disk，并把 `CONTENT_OPS_DATA`、`XHS_MEDIA_DATA` 指到 `/var/data`。上线后仍建议定期点右上角“导出备份”，尤其是在改动大量账号、标题、产品和发布记录之后。
