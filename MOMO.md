# Momo 分开的订阅入口

此仓库原有的 sing-box-subscribe 页面和 `/config/...` 接口继续走 Python `/api/app`；新增 `/api/momo` 走 Node.js 函数。请求 `source=A` 时只用 `Clash.Meta` UA 拉取 A，`source=B` 时只用 `sing-box` UA 拉取 B。两者各自返回可供 Momo 加载的完整 sing-box 配置。省略 `source` 时继续返回旧版 A+B 合并配置，供原订阅地址兼容使用。

## Vercel 设置

在项目的 **Production 环境变量**中填写：

| 变量 | 值 |
| --- | --- |
| `MOMO_SOURCE_A` | 第一份原始订阅 URL |
| `MOMO_SOURCE_B` | 第二份原始订阅 URL |
| `MOMO_API_SECRET` | Momo 手动选节点面板的 API 密钥 |
| `MOMO_FEED_TOKEN` | 至少 24 字符的随机密钥，用于保护订阅入口 |
| `MOMO_MIN_A` | 可选，默认 `61`；A 节点不足时拒绝更新 |
| `MOMO_MIN_B` | 可选，默认 `118`；B 节点不足时拒绝更新 |

本地私有值在 `D:\codex\2026-09-23\momo\.private\`：`sources.local.json`、`clash-api-secret.txt`、`vercel-feed-token.txt`。不要把这些文件或带密钥的完整订阅 URL 提交到 Git；`.env*` 也已排除。

保存变量后重新部署。A 的地址为 `https://sb.332231.xyz/api/momo?source=A&key=<MOMO_FEED_TOKEN>`，B 为 `https://sb.332231.xyz/api/momo?source=B&key=<MOMO_FEED_TOKEN>`。在私有浏览器或本机保存结果后验证它是包含 `dns`、`inbounds`、`outbounds`、`route` 的 JSON，并用实际 sing-box 版本运行 `check`。不要分享返回内容，其中包含节点凭据。

## Momo 设置

1. **页面填写配置**：Momo → 配置文件 → 订阅，分别新增 A 和 B 两个订阅；链接填各自受保护地址，UA 都填 `sing-box`，优先选“远程”。此 UA 只用于请求本入口，上游 UA 由入口固定设置。
2. **页面开关**：先选中 B 订阅并开启“检查配置文件”；A 可单独切换排错。代理配置中的 TCP Redirect、UDP TPROXY、DNS 劫持及 LAN 开关按 `D:\codex\2026-09-23\momo\README.md` 设置。每次只运行一个订阅，因此 Zashboard 只会显示当前订阅中的节点。
3. **页面按钮**：点击“更新”后还要点击“重载”或“重启服务”，Momo 才会运行新配置。要每天自动更新，可先在手动更新成功后启用 Momo 定时重启，例如 Cron `0 4 * * *`；“优先远程”会让每次重启重新下载。

分流规则对 Google 常用域名明确指定代理及代理 DNS，避免其中国大陆 CDN IP 命中 `geoip-cn` 后直连；广告规则仍先匹配。WireGuard 使用的私网地址由 `ip_is_private` 规则直连。

端点在所选上游失败、格式变化或节点数低于门槛时返回 HTTP 502，Momo 已有缓存时会回退使用缓存。若服务商确实减少节点，确认后再调整 `MOMO_MIN_A/B`。节点标签基于身份生成，订阅顺序调整时手动选择不会因序号变化而指向另一个节点。

此前路由器通过现有自定义域名取得过合并配置，并通过路由器 sing-box 检查。拆分版仍需在部署后从路由器分别下载和验证。
