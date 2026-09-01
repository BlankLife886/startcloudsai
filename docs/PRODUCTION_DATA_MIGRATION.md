# 旧服务器到新服务器的数据迁移

本文用于把旧服务器的生产数据迁移到已经完成部署测试的新服务器。准备阶段只做读取、
盘点和备份，不停止旧服务、不修改 DNS，也不覆盖新服务器数据。

## 1. 必须迁移的数据

| 数据 | 来源 | 目标 | 处理方式 |
| --- | --- | --- | --- |
| 星空云绘业务数据 | 旧 PostgreSQL `starclouds` | 新 PostgreSQL 18 `starclouds` | `pg_dump` / `pg_restore` |
| ChatGPT2API 结构化数据 | 新服务器 PostgreSQL 18 `chatgpt2api` | 保留在新服务器 | 迁移前备份，不从旧机覆盖 |
| ChatGPT2API 文件 | 新服务器持久卷 `/app/data` | 保留在新服务器 | 迁移前备份，不从旧机覆盖 |
| 生产配置 | 旧 `.env`、后台数据库设置 | 新 `.env.integrated` 和数据库 | 人工映射并核对密钥指纹 |
| 用户图片 | 旧 R2、旧对象存储或旧机持久目录 | 新生产 OSS | 先盘点真实来源，再按原 Object Key 全量和增量复制 |

不要迁移旧 Redis 数据。Redis 中包含队列、租约和短期状态，跨服务器恢复可能让旧任务
重复执行。最终切换前必须让运行中任务归零，新服务器使用干净 Redis，任务的最终事实以
PostgreSQL 为准。

旧服务器没有 ChatGPT2API，因此不存在 SQLite、ChatGPT2API PostgreSQL 或 `/app/data`
迁移。新服务器已经配置好的 ChatGPT2API 数据属于目标环境自身数据，必须保留并在迁移
前单独备份；恢复旧星空云绘数据库时不能删除或重建 `chatgpt2api` 数据库及其数据卷。

数据库和图片对象必须配套迁移。旧数据库中的 `tasks.input_keys/output_keys/thumbnail_keys`、
用户头像、资产库、AI助手消息、画布文档和运营图片保存的是对象 Key 或历史 URL，不包含
图片二进制。旧 R2 已从新项目移除不代表旧图片已经进入 OSS；只有确认旧对象来源，并把
全部对象按完全相同的 Key 复制到新 OSS 后，历史图片才可继续读取。恢复演练前禁止假设
旧、新服务器目录或存储后端相同。

## 2. 当前迁移边界

迁移分为五个阶段：

1. 两台服务器只读预检，确认代码提交、迁移版本、Compose 服务和全部数据卷。
2. 盘点旧数据库中的所有对象 Key/URL，并确认每类图片真实位于 R2、其他对象存储还是本地目录。
3. 新服务器分别备份当前星空云绘测试库、ChatGPT2API 数据库和 `/app/data`。
4. 把旧图片按原 Key 复制到隔离 OSS 前缀或迁移演练 Bucket，核对对象数、字节数和抽样哈希。
5. 使用旧数据库副本做隔离恢复演练，执行新版本迁移并逐类验证用户、钱包、任务和图片。
6. 安排短暂停写窗口，执行数据库最终导出和图片增量同步，再恢复到新服务器。
7. 业务冒烟通过后切换流量；旧服务器、旧数据库和旧图片源保持只读作为回退点。

现在只执行第 1、2 阶段。预检和图片来源清单没有核对完成前，不执行数据库恢复。

## 3. 旧服务器只读预检

在旧服务器宝塔终端执行：

```bash
cd /www/wwwroot/startcloudsai
ROLE=source \
COMPOSE_FILE=docker-compose.yml \
ENV_FILE=.env \
sh deploy/integrated/scripts/migration-preflight.sh
```

旧服务器没有 ChatGPT2API，报告中出现 `not_present_on_legacy_source=true` 是正常结果，
不需要提供 ChatGPT2API 容器 ID。

报告保存在 `.artifacts/production-migration/source-preflight-*.txt`。它只包含版本、数量、
挂载点、非敏感 OSS 配置和密钥 SHA-256 指纹，不输出密码或 AccessKey。

## 4. 新服务器只读预检

在新服务器宝塔终端执行：

```bash
cd /www/wwwroot/startcloudsai
ROLE=target \
COMPOSE_FILE=deploy/integrated/docker-compose.yml \
ENV_FILE=deploy/integrated/.env.integrated \
sh deploy/integrated/scripts/migration-preflight.sh
```

报告保存在 `.artifacts/production-migration/target-preflight-*.txt`。

重点比较：

- 旧库 PostgreSQL 版本、新库 PostgreSQL 18 版本和 Goose 迁移版本；
- Goose版本必须读取 `goose_db_version.version_id`，不能使用该表自增主键 `id`；
- 旧、新项目的 Git 提交或发布版本、迁移文件数量及 Compose 挂载目录；
- 新服务器磁盘剩余空间必须大于“两个数据库备份 + ChatGPT2API `/app/data`”的两倍；
- `APP_SECRET_SHA256` 必须在正式恢复前保持与旧环境一致，否则已加密的服务商密钥可能无法读取；
- OSS Bucket、Region 和 Endpoint 必须指向生产 Bucket，不能指向本地 MinIO 或开发 Bucket；
- 新 ChatGPT2API PostgreSQL 和 `/app/data` 的实际大小、挂载卷及备份空间；
- 新 ChatGPT2API 中已有账号、配置和文件必须保留，不能随旧星空云绘数据库一起重置。
- 旧库全部图片Key/URL前缀、对应旧存储位置，以及目标OSS中已存在/缺失对象数量。

## 5. 最终切换前的硬性条件

以下条件必须全部满足：

- 已备份并校验新服务器当前测试数据库，允许必要时恢复；
- 已在隔离数据库执行旧Schema到当前Schema的完整迁移，且没有破坏性错误；
- 旧R2、对象存储和本地文件目录已经完成清单，目标OSS逐Key校验无缺失；
- 旧服务器 `tasks` 不存在 `queued`、`running` 或取消中的任务；
- AI 助手、批量任务和 OSS 清理没有正在写入的作业；
- 已独立备份新服务器 ChatGPT2API PostgreSQL 和真实 `/app/data` 挂载卷；
- 已完成一次从旧数据副本恢复到隔离目标的演练；
- 两边系统时间正确，备份文件 SHA-256 一致；
- 宝塔 Nginx 和 DNS 尚未切换，旧服务器仍能继续提供只读或正常服务；
- 旧 PostgreSQL、目标 ChatGPT2API 备份和生产 OSS 至少保留到回退观察期结束。

## 6. 不应执行的操作

迁移全过程禁止：

```text
docker compose down -v
docker volume rm ...
直接复制 PG17 数据目录给 PG18
把旧 Redis dump 恢复到新服务器
只恢复数据库而不迁移旧R2/本地图片
更改对象Key或只复制部分图片前缀
恢复星空云绘数据库时误删新服务器 ChatGPT2API 数据库或 /app/data
迁移成功后立即删除旧服务器或 OSS 数据
```

最终导出、对象复制、恢复、逐Key对账和切流命令要根据两份预检报告及旧图片来源清单生成。
恢复操作只允许替换新服务器的 `starclouds` 数据库，不能操作 `chatgpt2api` 数据库；
任何图片来源仍不明确时，迁移流程必须停在演练阶段。
