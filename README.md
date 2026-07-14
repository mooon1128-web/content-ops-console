# 内容运营管理台

给 1-3 人使用的内容运营管理台，包含标题库、账号频率、发布日历、制作进度、产品库存、节日选题和本月重点运营产品 Top10。

小红书媒介投放跟踪台入口：

```text
/xhs-media/
```

## Render 部署

Render 会读取 `render.yaml` 并启动：

```bash
npm start
```

当前 `render.yaml` 使用 Render Persistent Disk，把数据写到 `/var/data`，适合作为公网稳定版。小红书媒介投放跟踪台已启用访问密码，默认密码为 `xhs2026`；正式上线后建议在 Render 环境变量里修改 `XHS_MEDIA_PASSWORD`。
