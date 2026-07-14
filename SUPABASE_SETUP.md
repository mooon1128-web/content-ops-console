# Supabase 持久化配置

内容运营台默认仍可用本地 `content-ops/data.json` 启动；配置 Supabase 后，发布记录、标题库、账号、Top10 产品等状态会保存到 Supabase，不再依赖 Render 的临时文件。

## 1. 创建 Supabase 项目

1. 打开 https://supabase.com
2. 新建一个免费项目
3. 进入项目后打开 `SQL Editor`

## 2. 执行建表 SQL

```sql
create table if not exists public.content_ops_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
```

## 3. 在 Render 填环境变量

Render 服务页进入 `Environment`，添加：

```text
SUPABASE_URL=你的 Supabase Project URL
SUPABASE_SERVICE_ROLE_KEY=你的 Supabase service_role key
CONTENT_OPS_STATE_ID=default
```

Supabase 的值位置：

- `SUPABASE_URL`: Project Settings -> API -> Project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Project Settings -> API -> service_role secret

不要把 `SUPABASE_SERVICE_ROLE_KEY` 放到前端页面或 GitHub 公开文件里，只填在 Render 环境变量。

## 4. 初次迁移数据

配置环境变量并重新部署后，服务会自动用仓库内的 `content-ops/data.json` 初始化数据库一次。当前这份 `data.json` 已恢复为：

- 标题 7 条
- 账号 8 个
- 发布/制作记录 9 条
- 产品库存 175 个

之后线上新增或修改的数据会直接写入 Supabase。
