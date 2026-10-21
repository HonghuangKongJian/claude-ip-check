---
title: Cloudflare Workers 默认域名打不开？手把手教你绑定自定义域名（保姆级图文教程）
date: 2026-10-21 10:35:00
categories:
  - 网络与运维
tags:
  - Cloudflare
  - Workers
  - DNS污染
  - 自定义域名
  - 教程
description: 详细剖析 Cloudflare Workers 默认 workers.dev 域名在境内无法访问的根本原因，并通过 5 个图文步骤教你如何零成本绑定自有域名，借助 Cloudflare 全球边缘网络实现免代理流畅访问。
---

# Cloudflare Workers 默认域名打不开？手把手教你绑定自定义域名（保姆级图文教程）

在部署完 Cloudflare Worker（如 [洪荒空间](https://amw3.eu.org) 矩阵旗下的各类 IP 风险检测、测速应用、API 代理或轻量静态站）后，很多小伙伴点击分配到的默认域名 `https://<项目名>.<子域>.workers.dev` 时，往往会发现网页一直在转圈圈，随后弹出 **“连接超时”**、**“无法访问此网站”** 或 **“ERR_CONNECTION_TIMED_OUT”**。

本文将用最直白的方式解释原因，并通过 **5 步高清图解**，带你 2 分钟完成自定义域名绑定，彻底解决无法访问的痛点。

---

## 一、为什么默认的 workers.dev 域名在国内打不开？

Cloudflare 官方为每个账户分配的免费测试二级域名形如：`https://*.workers.dev`。

在中国大陆网络环境下，`*.workers.dev` 根域长期遭受 **DNS 污染与 SNI 阻断**（实测本地 DNS 会被强制解析到例如 `157.240.3.50` 等不可达的境外 IP 地址）。因此，无论你的 Worker 程序写得多完美、边缘服务运行得多正常，本地浏览器都根本无法建立 TCP 握手。

### 核心解决思路：
**将 Worker 绑定到你自己的二级域名上（如 `ip.yourdomain.com`）**。
绑定后：
1. 本地 DNS 解析的是你自己的域名；
2. 流量会经由 Cloudflare Anycast 全球边缘 CDN 节点正常接收和中转；
3. Cloudflare 会自动为你免费签发合规的 Universal SSL 证书（全自动 HTTPS），国内网络即可免代理流畅秒开！

---

## 二、前置准备

在开始前，你只需要准备好：
1. **一个已部署好的 Cloudflare Worker**（例如 `claude-ip-check`）；
2. **一个自有域名**（例如 `example.com`），且该域名的权威 Nameservers（DNS）**已经托管在当前的 Cloudflare 同一账号下**。

> 💡 **手头还没有域名？**  
> 别担心，可以直接参考配套的零成本申请指南：👉 **[没有域名怎么办？2026 最新免费域名申请并接入 Cloudflare 教程](./free-domain-tutorial.md)**。

---

## 三、保姆级图文操作步骤（5 步搞定）

### 步骤 1：在 Cloudflare 控制台找到目标 Worker

1. 登录 [Cloudflare Dashboard 控制台](https://dash.cloudflare.com/)。
2. 在左侧主菜单中点击 **Workers & Pages（Workers 和 Pages）**。
3. 在应用列表中找到你刚刚部署的项目（以 `claude-ip-check` 为例），鼠标点击进入其管理详情页。

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/14649814/claude-ip-check@main/docs/images/domain-step1.svg" width="720" alt="步骤 1：在 Workers 列表点击目标项目">
</p>

---

### 步骤 2：进入「Settings (设置)」中的「Domains & Routes」

1. 进入 Worker 详情页后，在顶部导航选项卡中，点击最右侧的 **Settings (设置)**。
2. 在 Settings 展开的左侧子菜单中，点击 **Domains & Routes (域和路由)**。

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/14649814/claude-ip-check@main/docs/images/domain-step2.svg" width="720" alt="步骤 2：点击 Settings -> Domains & Routes">
</p>

---

### 步骤 3：在「Custom Domains」卡片点击「Add」

1. 页面向下滚动到 **Custom Domains（自定义域）** 卡片区域。
2. 找到卡片右上角蓝色的 **`Add (添加)`** 按钮并点击。
3. 在弹出的下拉菜单中，点击第一项 **`Custom domain`**。

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/14649814/claude-ip-check@main/docs/images/domain-step3.svg" width="720" alt="步骤 3：点击 Add -> Custom domain">
</p>

---

### 步骤 4：填入你想要使用的二级子域名并确认

1. 在弹出的对话框中，输入你规划好的完整域名（例如：`ip.example.com` 或 `check.example.com`）。
2. 点击右下角的 **`Add Custom Domain`** 确认添加。

> 💡 **无需手动修改 DNS 记录**：  
> Cloudflare 会全自动识别并完成底层工作：自动在你的 DNS 区域添加指向 Worker 的 CNAME 记录（开启橙色小云朵 Proxy），同时全自动向 CA 机构申请并签发专属免费 SSL 证书。

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/14649814/claude-ip-check@main/docs/images/domain-step4.svg" width="720" alt="步骤 4：输入子域名并确认保存">
</p>

---

### 步骤 5：等待 1–3 分钟激活生效

1. 提交后回到列表，刚绑定的域名会显示在 Custom Domains 列表中。
2. 初始状态通常为 `Initializing (初始化中)`，稍等 1~3 分钟刷新页面。
3. 当看到状态变为绿色的 **`● Active (有效)`** 时，即表示全球 DNS 广播与 SSL 证书均已配置就绪！

<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/14649814/claude-ip-check@main/docs/images/domain-step5.svg" width="720" alt="步骤 5：状态变为 Active 成功运行">
</p>

🎉 **现在直接在浏览器打开你的专属网址**：  
👉 **`https://ip.example.com`**  
你会发现无需任何代理辅助，在纯境内网络环境下也能秒级极速打开！

---

## 四、常见问题与避坑指南 (FAQ)

### Q1：状态一直停留在 Initializing 超过 10 分钟怎么办？
- **排查 DNS 冲突**：检查你的主域名 DNS 记录列表中，是否已经存在同名的 A 或 CNAME 记录。如果之前手动添加过同名解析，请先删除旧记录，然后重新添加 Custom Domain。
- **SSL 模式设置**：进入主域名的 **SSL/TLS** 设置页面，确保加密模式为 **Full** 或 **Full (strict)**，不要选 Off。

### Q2：绑定自定义域名后，原本的 workers.dev 域名还能用吗？
- 网页控制台方式添加的自定义域名，**默认与 workers.dev 域名并存**，两者均可访问。
- 如果通过命令行 Wrangler 绑定，且配置中未显式声明 `workers_dev = true`，Wrangler 会自动关闭默认的 `workers.dev` 访问。

### Q3：一个 Worker 可以绑定多个不同的域名吗？
- **完全可以**。重复步骤 3 与步骤 4，你可以为一个 Worker 绑定多个不同的子域（例如主域名 `ip.domain1.com` 和备用域名 `check.domain2.com`），甚至支持绑定裸域（根域名）。

---

## 五、结语

通过 Cloudflare Custom Domains 功能，我们无需购置境外 VPS 服务器，也不需要繁琐的 Nginx 反向代理配置，仅用几分钟就能把边缘服务无缝发布到自有域名下。这也是目前部署 Cloudflare 边缘工具矩阵（如 [cf-claude-ip-check](https://github.com/14649814/claude-ip-check)）最稳定、体验最好的标准落地方式。

---

## 六、关于「洪荒空间」

本文由 **[洪荒空间门户 (https://amw3.eu.org)](https://amw3.eu.org)** 整理发布。

**洪荒空间** 是一个面向开发者与网络极客的全能矩阵门户平台，致力于打造沉浸式极客工具生态：
- 🌐 **全能矩阵门户主站**：[https://amw3.eu.org](https://amw3.eu.org)
- 📡 **IP 网络全能工具箱**：[https://ip.amw3.eu.org](https://ip.amw3.eu.org)
- 🛡️ **Claude AI 出口 IP 风险检测**：[https://ipcheck.amw3.eu.org](https://ipcheck.amw3.eu.org)
- 🎨 **QR Studio 二维码工坊**：[https://qr.amw3.eu.org](https://qr.amw3.eu.org)
- 🧰 **80+ 离线格式转换、加解密矩阵及云端运维导航**

欢迎访问主站收藏体验！
