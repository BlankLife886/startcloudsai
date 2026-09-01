# Cloudflare Free 接入与回退

更新时间：2026-09-01

适用架构：Cloudflare 全球网络 → 宝塔 Nginx（HTTPS）→ `127.0.0.1:8080` Docker Gateway → API/Web/Admin。OSS 上传和私有图片不经过 Cloudflare。

## 1. 接入目标

- 加速前端 JS、CSS、字体、品牌图片和业务封面。
- 网站和 API 使用 Cloudflare 全球代理，让中国大陆用户可以尽量访问。
- 不改变 PostgreSQL、Redis、Worker、ChatGPT2API、OSS 和任务并发配置。
- API、登录、钱包、任务状态、SSE 和私有图片禁止 CDN 缓存。
- 保留一键切回 DNS only 的回退能力。

## 2. 上线前备份 DNS

在 Cloudflare 接管名称服务器前，完整保留原 DNS 记录，至少确认：

- 根域名 `@`；
- `www`；
- MX 邮件记录；
- SPF、DKIM、DMARC TXT；
- OSS 自定义域名；
- 域名、证书和第三方服务验证记录。

不要把 MX、TXT、邮件主机或第三方验证记录开启代理。

## 3. 宝塔 Nginx

生产站点配置在 `/www/server/panel/vhost/nginx/starcloudisai.com.conf`。先确认实际路径：

```bash
grep -RIl 'server_name.*starcloudisai.com' /www/server/panel/vhost/nginx
```

在该站点的 `server {}` 内加入：

```nginx
include /www/wwwroot/startcloudsai/deploy/cloudflare/cloudflare-realip.conf;
```

把现有 `location /` 调整为 `deploy/cloudflare/baota-server-snippet.conf` 中的版本。关键要求：

```nginx
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
```

不能继续使用未经清洗的 `$proxy_add_x_forwarded_for`。`cloudflare-realip.conf` 只信任 Cloudflare 官方网段发来的 `CF-Connecting-IP`；直接访问源站时，客户端伪造同名 Header 不会被信任。

检查并平滑加载：

```bash
/www/server/nginx/sbin/nginx -t
/www/server/nginx/sbin/nginx -s reload
```

以后更新 Cloudflare IP 段：

```bash
cd /www/wwwroot/startcloudsai
sh deploy/cloudflare/update-realip-ranges.sh
/www/server/nginx/sbin/nginx -t
/www/server/nginx/sbin/nginx -s reload
```

只有 `nginx -t` 成功后才能 reload。

## 4. Docker Gateway

`deploy/nginx.conf` 会读取宝塔确认过的 `X-Real-IP`，并向 Go 服务传递单一地址。修改配置后只重建无状态 Gateway：

```bash
cd /www/wwwroot/startcloudsai
docker compose --env-file deploy/integrated/.env.integrated \
  -f deploy/integrated/docker-compose.yml \
  up -d --no-deps --force-recreate gateway
```

该操作不会重启数据库、Redis、Worker 或 ChatGPT2API。

## 5. Cloudflare DNS

在 Cloudflare 添加 `starcloudisai.com`，选择 Free。导入记录后逐项和原 DNS 对照，再到阿里云域名控制台替换 Cloudflare 提供的两个 NS。

推荐记录：

| 类型 | 名称 | 内容 | 代理状态 |
|---|---|---|---|
| A | `@` | 日本服务器公网 IP | Proxied（橙云） |
| CNAME | `www` | `starcloudisai.com` | Proxied（橙云） |
| MX/TXT | 按原记录 | 按原记录 | DNS only |
| OSS 域名 | 按当前配置 | OSS Endpoint | DNS only |

如果没有独立 API 域名，不要额外创建 `api`。当前网站和 API 都通过 `starcloudisai.com`。

## 6. SSL/TLS 和网络

Cloudflare 控制台设置：

1. **SSL/TLS → Overview → Full (strict)**。
2. **Edge Certificates → Always Use HTTPS → On**。
3. 保留宝塔上的 Let's Encrypt 源站证书和自动续期。
4. 开启 HTTP/2、HTTP/3 和 Brotli。
5. 不启用 Development Mode。

禁止使用 Flexible SSL，否则会降低源站链路安全性，并可能造成 HTTPS 重定向循环。

## 7. Cache Rules

创建两条规则，顺序不可颠倒。

### 7.1 动态和私有内容绕过缓存

表达式：

```text
(http.request.uri.path starts_with "/api/") or
(http.request.uri.path starts_with "/admin/")
```

操作：**Bypass cache**。

用户登录、钱包、任务、SSE、后台和 `/api/v1/files/...` 都包含在这条规则中。

### 7.2 静态文件缓存

表达式：

```text
(http.request.uri.path starts_with "/assets/") or
(http.request.uri.path starts_with "/brand/") or
(http.request.uri.path starts_with "/icons/") or
(http.request.uri.path starts_with "/sucai/")
```

操作：

- Cache eligibility：Eligible for cache；
- Edge TTL：Respect origin；
- Browser TTL：Respect origin。

`/assets/` 由源站返回30天 immutable；`/brand/`、`/icons/`、`/sucai/` 返回7天；HTML返回 `no-cache`。

不要创建 Cache Everything，不要忽略私有OSS签名URL的查询参数。

## 8. WAF 和限流

第一轮只启用 Cloudflare默认安全能力，不给任务接口增加Cloudflare限流。项目自身已经按用户UUID限制任务并发、按用户/IP限制滥用。

尤其不要对以下路径创建低阈值限流：

- 任务提交；
- 任务状态轮询；
- SSE事件流；
- 无限画布自动保存；
- 分片或批量上传。

Cloudflare Free的一条限流规则更适合以后单独保护登录路径，不能拿它限制整个 `/api/`。

## 9. 验收

接入前：

```bash
curl -fsS http://127.0.0.1:8080/api/v1/health
curl -fsSI https://starcloudisai.com/
```

接入后：

```bash
curl -fsSI https://starcloudisai.com/
curl -fsS https://starcloudisai.com/api/v1/health
curl -fsSI https://starcloudisai.com/assets/<当前存在的hash文件>
```

应看到：

- 响应包含 `server: cloudflare` 和 `cf-ray`；
- 首页为 `Cache-Control: no-cache`；
- `/assets/` 为 `Cache-Control: public, immutable`；
- 第二次请求静态文件时可能出现 `cf-cache-status: HIT`；
- `/api/v1/health` 不应出现缓存命中。

业务测试：

1. 两个不同网络的用户登录，后台安全日志显示不同真实IP；
2. 单用户连续提交允许数量内的任务，不出现Cloudflare 429；
3. 任务状态自动更新；
4. AI助手和画布SSE持续收到事件；
5. OSS上传和生成图片正常；
6. 后台、钱包和历史记录刷新后数据正确。

## 10. 回退

最快回退不需要恢复NS。在Cloudflare DNS中把根域名和 `www` 从 **Proxied** 切换为 **DNS only**。Cloudflare代理TTL通常为几分钟，已有连接可能短暂断开，但数据库和后台任务不会停止。

回退后：

```bash
curl -fsSI https://starcloudisai.com/
curl -fsS https://starcloudisai.com/api/v1/health
```

响应不再包含 `server: cloudflare` 即表示已经绕过代理。宝塔仍保留有效证书，因此直连HTTPS继续工作。

只有确定不再使用Cloudflare DNS时，才把注册商NS恢复为原名称服务器；NS全量切换传播更慢，不适合作为第一回退手段。
