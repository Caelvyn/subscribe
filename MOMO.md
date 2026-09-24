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
| `MOMO_WAN_INTERFACE` | 可选，A 节点专用 DNS 直连接口；当前主路由默认 `pppoe-wan` |

本地私有值在 `D:\codex\2026-09-23\momo\.private\`：`sources.local.json`、`clash-api-secret.txt`、`vercel-feed-token.txt`。不要把这些文件或带密钥的完整订阅 URL 提交到 Git；`.env*` 也已排除。

保存变量后重新部署。A 的地址为 `https://sb.332231.xyz/api/momo?source=A&key=<MOMO_FEED_TOKEN>`，B 为 `https://sb.332231.xyz/api/momo?source=B&key=<MOMO_FEED_TOKEN>`。在私有浏览器或本机保存结果后验证它是包含 `dns`、`inbounds`、`outbounds`、`route` 的 JSON，并用实际 sing-box 版本运行 `check`。不要分享返回内容，其中包含节点凭据。

## Momo 设置

1. **页面填写配置**：Momo → 配置文件 → 订阅，分别新增 A 和 B 两个订阅；链接填各自受保护地址，UA 都填 `sing-box`，优先选“远程”。此 UA 只用于请求本入口，上游 UA 由入口固定设置。
2. **页面开关**：按需要选中 A 或 B 订阅并开启“检查配置文件”。代理配置中的 TCP Redirect、UDP TPROXY、DNS 劫持及 LAN 开关按 `D:\codex\2026-09-23\momo\README.md` 设置。每次只运行一个订阅，因此 Zashboard 只会显示当前订阅中的节点。
3. **页面按钮**：点击“更新”后还要点击“重载”或“重启服务”，Momo 才会运行新配置。“优先远程”只在服务启动时重新下载当前选中的订阅；未选中的订阅需要单独定时更新。

当前路由器已设置每日 02:30 更新 A、02:40 更新 B、03:00 重启 Momo（均为路由器本地时间）。A/B 订阅更新只更换缓存，03:00 重启时应用当前选中的订阅。

A 的完整节点来自 `Clash.Meta` UA。生成器从同一份订阅的 `dns.nameserver-policy` 读取适用于节点服务器域名的专用 HTTPS DNS，并为每个 A 节点设置 `domain_resolver`；DNS 的地址和路径随上游订阅更新，不写入仓库。A 配置保留 IPv6，需手动选择实测支持 IPv6 出口的节点。B 配置暂用 `ipv4_only`，因为抽测 B 节点的 IPv6 目标连接失败；这只影响 B 的 DNS 配置，不关闭路由器 LAN 的 IPv6 广播。

分流规则对 Google 常用域名明确指定代理及代理 DNS，避免其中国大陆 CDN IP 命中 `geoip-cn` 后直连；广告规则仍先匹配。WireGuard 使用的私网地址由 `ip_is_private` 规则直连。

端点在所选上游失败、格式变化或节点数低于门槛时返回 HTTP 502，Momo 已有缓存时会回退使用缓存。若服务商确实减少节点，确认后再调整 `MOMO_MIN_A/B`。节点标签基于身份生成，订阅顺序调整时手动选择不会因序号变化而指向另一个节点。

此前路由器通过现有自定义域名取得过合并配置，并通过路由器 sing-box 检查。拆分版仍需在部署后从路由器分别下载和验证。

## 一加 6T 的 2.4G 模式草案（尚未部署）

当前路由器是 sing-box 1.12.25，软件源也只提供此版本。按来源 MAC 匹配 IPv4/IPv6 需要 sing-box 1.14；本机使用官方 1.14.1 检查过本草案的配置语法，但尚未在路由器上升级或验证实际流量。

默认 `MOMO_PHONE_MODE_ENABLED=0`；即使提前填写代理信息，也继续返回原配置。升级核心并验证防火墙后改为 `1`，A、B 两份配置才会加入一加 6T 的独立规则。此时须完整填写：`MOMO_PHONE_24G_MAC`、`MOMO_RESIDENTIAL_SERVER`、`MOMO_RESIDENTIAL_PORT`、`MOMO_RESIDENTIAL_USERNAME`、`MOMO_RESIDENTIAL_PASSWORD`。缺任何一项时接口拒绝生成新配置。住宅代理账号密码只应放在私有环境变量，不能提交到 Git。**此实现会把住宅代理账号密码放进 Vercel 返回给路由器的完整配置；启用前需要明确接受该存储与传输方式。**

在 Zashboard 使用顶部模式切换：`Rule` 为原分流、`Global` 为住宅代理、`Direct` 为直连。只有指定的 2.4G MAC 使用这三个模式；5G MAC 和其他设备继续执行原分流。住宅模式下普通 UDP 被拒绝，住宅 DNS 走住宅 SOCKS5 出口，IPv6 TCP 也尝试从住宅出口发送；若该产品不支持 IPv6 目标，则连接失败而不会回退到普通节点。`Direct` 只表示手机 2.4G 的流量直连，不能作为银行 App 的防泄漏模式。

启用前还须在路由器防火墙增加仅针对 2.4G MAC 的 LAN→WAN IPv4/IPv6 转发拒绝规则，防止 Momo 停止时手机从路由器直接出网；不能误伤 5G MAC。先核对 Momo 捕获规则、备份旧核心与配置，再升级官方 x86_64 包、应用新订阅，最后实测三种模式的 IPv4/IPv6/DNS 出口及断线阻断。验证完成前不要把住宅模式当作银行 App 的严格防泄漏方案。
