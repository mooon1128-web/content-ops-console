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

公司内网使用时，让同事访问这台电脑/服务器的内网 IP：

```text
http://内网IP:4322
```

共享数据会写到：

```text
content-ops/data.json
```

## 配置

可通过环境变量改端口和数据文件：

```bash
PORT=8080 CONTENT_OPS_DATA=/path/to/content-ops-data.json npm run content-ops
```

如果只打开 `public/content-ops/index.html`，页面也能运行，但数据只保存在当前浏览器本机，无法多人共享。

## 免费上线

推荐用 Render Free Web Service：

1. 把当前项目推到 GitHub。
2. 打开 Render，选择 New → Blueprint。
3. 连接这个 GitHub 仓库，Render 会读取根目录的 `render.yaml`。
4. 创建服务后，等待部署完成。
5. 访问 Render 生成的 `https://...onrender.com` 链接。

这个版本不需要登录，知道链接的人都能访问和修改数据，适合 1-3 人小范围使用。

注意：免费 Web Service 适合轻量测试和内部协作。上线后请定期点右上角“导出备份”，尤其是在改动大量账号、标题、产品和发布记录之后。
