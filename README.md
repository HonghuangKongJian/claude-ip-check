# Claude AI IP 风险检测 · Cloudflare 版

一套 **可完整部署在 Cloudflare** 的 Claude AI 出口 IP 风险检测页。
后端为单个 Cloudflare Worker（静态资源通过 Assets 绑定同仓托管），无需服务器、无数据库依赖，全球边缘运行。

**在线地址**

| 域名 | 说明 |
|---|---|
| <https://ipcheck.amw3.eu.org> | 自定义域名，自动签发证书，国内可直连 |
| `https://claude-ip-check.<你的子域>.workers.dev` | `workers.dev` 兜底，部分地区被 DNS 污染需代理 |

> 中国大陆网络下 `*.workers.dev` 常被 DNS 污染（解析到无关 IP），因此**建议务必绑定自己的自定义域名**，
> 见 [方式三 · 绑定自定义域名](#绑定自定义域名推荐)。

**目录**

- [一、功能清单](#一功能清单)
- [二、数据源](#二数据源)
- [三、信任评分模型](#三信任评分模型)
- [四、部署](#四部署) —— 含 **Cloudflare 控制台网页部署教程**
- [五、配置项速查](#五配置项速查)
- [六、API](#六api)
- [七、目录结构](#七目录结构)
- [八、已知限制](#八已知限制)
- [九、合规声明](#九合规声明)

---

## 一、功能清单

| 模块 | 状态 | 说明 |
|---|---|---|
| Cloudflare 出口 IP | ✅ | 浏览器直连 `1.1.1.1/cdn-cgi/trace` |
| Claude 出口 IP | ✅ | 浏览器直连 `claude.ai/cdn-cgi/trace` |
| 中国出口 IPv4 | ✅ | `my.ip.cn` → `2026.ip138.com`（受 CORS 限制，失败属正常） |
| Trust Score 信任评分 | ✅ | 后端启发式评分模型（见下） |
| IP 属性（住宅/机房/ASN/运营商） | ✅ | ipwho.is / ipapi.co / ipleak.net |
| VPN / Proxy / Tor / 爬虫 / 滥用 | ⚠️ 部分 | VPN·Proxy·Tor·机房来自 ipquery.io；爬虫为 ASN+组织名+rDNS 启发式；滥用以风险分代理（可接 AbuseIPDB） |
| Claude 可用性检测 | ✅ | claude.ai / anthropic.com 时延 |
| WebRTC UDP 泄露 | ✅ | 纯前端 STUN 探测 |
| DNS 出口一致性检测 | ✅ | 见下方「DNS 模块说明」 |
| 设备指纹（时区/语言/WebGL/Canvas） | ✅ | 纯前端采集 |
| IP 历史（localStorage） | ✅ | 仅浏览器本地存储 |

### DNS 模块说明（重要）

解析器级的 DNS 泄露检测依赖**自建权威 DNS**：浏览器解析随机子域时，
自建 NS 侧可以看到「是哪个递归解析器来查的」，从而暴露用户真实 DNS 出口。
Cloudflare Workers **无法获取请求方的递归解析器 IP**（Cloudflare 的权威 DNS 日志不向用户开放），
因此该能力在纯 Cloudflare 上无法实现。

本版改为 **「出口一致性」探测**：

1. 浏览器并发请求中性探测域名（默认当前域名，可通过 `DNS_TEST_HOSTS` 指定额外域名）的 `/api/echo`；
2. Worker 返回它在该域名视角下看到的出口 IP；
3. 与 `claude.ai` 视角的出口 IP 比对 —— **不一致即说明分流规则或 DNS 出口配置存在问题**（事实上的泄露）。

如果你确实需要解析器级检测，可自建权威 NS 并把结果接口挂到 `DNS_TEST_HOSTS` 上，前端逻辑无需改动。

---

## 二、数据源

| 用途 | 数据源 | 是否需要 Key | 备注 |
|---|---|---|---|
| IP 归属（主） | `ipwho.is` | 否 | 城市级 + ASN + 时区 |
| IP 归属（备 1） | `ipapi.co` | 否 | 免费额度约 1000 次/天 |
| IP 归属（备 2） | `ipleak.net` | 否 | 兜底，含 rDNS |
| 风险标记 | `api.ipquery.io` | 否 | vpn / proxy / tor / datacenter / mobile / risk_score |
| Tor 出口列表 | `check.torproject.org` | 否 | 交叉校验，缓存 6h，失败静默降级 |
| 反向 DNS | `cloudflare-dns.com` DoH | 否 | 用于爬虫识别，失败不影响主流程 |

全部数据源逐级降级，任一不可用不会导致整页报错。

---

## 三、信任评分模型

满分 100，按因子逐项扣减，最后夹取到 `[0, 100]`：

| 因子 | 扣分 |
|---|---|
| Tor 出口节点 | −70 |
| 机房 / 数据中心 IP | −35 |
| 已知 VPN 出口 | −30 |
| 代理 / 中继出口 | −25 |
| 疑似爬虫流量 | −20 |
| 存在滥用记录 | −20 |
| 不在 Claude 支持地区清单 | −30 |
| 移动基站 IP | −5 |
| 数据源风险分 | −`risk_score × 0.15` |
| 确认为住宅 IP | +5 |

**受限地区强制归零**：中国大陆、中国香港、中国澳门、俄罗斯、朝鲜、伊朗、叙利亚、古巴、白俄罗斯、委内瑞拉。
即便 IP 本身干净，Claude 也会对这些来源执行严格风控，故直接判 0。

> 评分是启发式模型，不是官方口径。它用于快速自查出口质量，不应作为唯一判断依据。

---

## 四、部署

三种方式任选。**推荐方式一**：全程在 Cloudflare 控制台网页操作，本机不需要装 Node.js，
且后续推送代码会自动重新部署。

| 方式 | 适用场景 | 是否需要本机环境 |
|---|---|---|
| 零、一键部署按钮 | 让别人（或你自己）几秒部署一份 | 否，只要仓库公开 |
| 一、控制台连接 Git 仓库 | 长期维护、自动部署 | 否 |
| 二、控制台手动创建 + 命令行上传 | 想先在网页建好资源再上传 | 是（Node ≥ 18） |
| 三、纯命令行 `wrangler deploy` | 本地快速验证 | 是（Node ≥ 18） |

---

### 方式零：一键部署（Deploy to Cloudflare 按钮）

Cloudflare 官方提供「Deploy to Cloudflare」按钮：点击后自动完成 **Fork 仓库 → 读取 `wrangler.toml` → Workers Builds 构建 → 部署**，全程无需本机 Node.js。

**先在 README 顶部加一行徽章**（把 `YOUR/REPO` 换成你的公开仓库）：

```markdown
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR/REPO)
```

若本项目在仓库子目录里，URL 追加目录路径：

```
https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR/REPO&rootDir=cf-claude-ip-check
```

**点击后按提示操作：**

| 步骤 | 要做什么 |
|---|---|
| 1 | 授权 Cloudflare 访问 GitHub / GitLab（仅首次） |
| 2 | 确认仓库名与 Worker 名称（默认 `claude-ip-check`） |
| 3 | 检查 Build command 为 `npm install`、Deploy command 为 `npx wrangler deploy` |
| 4 | 点 **Deploy**，等待日志出现 `Total Upload: 25.7 KiB / gzip: 8.7 KiB` |
| 5 | 打开 `https://claude-ip-check.<你的子域>.workers.dev` |

**前置条件**：仓库必须**公开**（private 仓库按钮不可用，请用方式一）。

> 项目没有 `build` 脚本，若 Build command 被预填成 `npm run build` 会直接失败，手动改成 `npm install` 即可。`[assets]` 会在 `wrangler deploy` 阶段自动打包 `public/`，不需要产物目录。

---

### 0. 注册与登录

1. 打开 <https://dash.cloudflare.com> ，注册或登录 Cloudflare 账号。
2. 登录后先确认能看到左侧 **Compute & AI → Workers & Pages**（旧版界面为 **Workers**）。
3. 在 **Workers & Pages** 概览页右侧找到 **Account ID**，复制保存——命令行部署时需要它。

---

### 方式一：控制台连接 Git 仓库（推荐）

**第 1 步：把代码推到 Git 仓库**

仓库根目录必须包含 `wrangler.toml`、`src/`、`public/`、`package.json` 四个内容。
若本项目只是仓库的子目录，记下相对路径（如 `cf-claude-ip-check`），下一步要填。

```bash
git init && git add . && git commit -m "init"
git remote add origin <你的仓库地址>
git push -u origin main
```

**第 2 步：在控制台创建 Worker**

1. 进入 **Workers & Pages → Create**。
2. 选择 **Import a repository**（部分界面显示为 *Connect to Git* / *导入仓库*）。
3. 首次使用需授权 Cloudflare 访问 GitHub / GitLab，按提示完成授权。
4. 选中刚才推送的仓库和分支（默认 `main`）。

**第 3 步：填写构建配置**

| 字段 | 填写内容 |
|---|---|
| Project name | `claude-ip-check`（须与 `wrangler.toml` 的 `name` 一致） |
| Root directory (path to application) | 仓库根目录填 `/`；项目在子目录则填 `cf-claude-ip-check` |
| Build command | `npm install` |
| Deploy command | `npx wrangler deploy` |
| Node version | 18 或更高 |

> **不要**把 Build command 留空后期待默认执行 `npm run build`——本项目没有 build 脚本，
> 那样构建会失败。`wrangler.toml` 里的 `[assets]` 会在 `wrangler deploy` 时自动打包
> `public/` 目录，无需额外产物目录。

**第 4 步：保存并部署**

点击 **Save and Deploy**。首次构建约 1–2 分钟，日志中出现
`Total Upload: 25.7 KiB / gzip: 8.7 KiB` 即为成功。

完成后在 **Settings → Domains & Routes** 可以看到分配到的
`https://claude-ip-check.<你的子域>.workers.dev`。

**后续更新**：直接 `git push`，Cloudflare 会自动触发重新构建部署。

---

### 方式二：控制台手动创建 Worker + 命令行上传

> ⚠️ **限制说明**：Cloudflare 控制台的在线代码编辑器是单文件 JS 编辑器，
> 无法上传 `public/` 目录下的静态资源，也不能编辑 `wrangler.toml`。
> 因此本项目**不能**只靠网页编辑器部署完整功能。网页端只负责「建坑位 + 拿凭据」，
> 实际代码仍需命令行上传。

**第 1 步：网页创建空 Worker（拿名字）**

**Workers & Pages → Create → Start with Hello World** → 命名 `claude-ip-check` → Deploy。

**第 2 步：网页创建 API Token**

1. 右上角头像 → **My Profile → API Tokens → Create Token**。
2. 选 **Create Custom Token**，按下表配置：

| 项目 | 配置 |
|---|---|
| Permissions | Account · Workers Scripts · **Edit** |
| Permissions | Account · Workers KV Storage · **Edit**（仅启用 KV 时需要） |
| Account Resources | Include → 选中你的账号 |

3. 生成后**立刻复制 Token**（只显示一次）。

**第 3 步：命令行上传**

```bash
# Windows PowerShell
$env:CLOUDFLARE_API_TOKEN="刚才复制的Token"
$env:CLOUDFLARE_ACCOUNT_ID="第0步复制的Account ID"
npx wrangler deploy
```

```bash
# macOS / Linux / Git Bash
export CLOUDFLARE_API_TOKEN="刚才复制的Token"
export CLOUDFLARE_ACCOUNT_ID="第0步复制的Account ID"
npx wrangler deploy
```

---

### 方式三：纯命令行部署

```bash
npm install          # 安装 wrangler
npx wrangler login   # 浏览器授权登录（无需手动配 Token）
npm run dev          # 本地预览 http://localhost:8787
npm run deploy       # 部署
```

> 本机若设置了代理，本地预览时需 `NO_PROXY=127.0.0.1,localhost`，否则连不上本地服务。

---

### 绑定自定义域名（推荐）

网页操作，三种方式部署后都适用：

1. 进入该 Worker → **Settings → Domains & Routes**。
2. **Add → Custom domain**，输入 `ip.example.com`。
3. 确认后 Cloudflare 会自动写入 DNS 记录并签发证书，等待 1–5 分钟生效。

要求：`example.com` 的 DNS 已托管在 Cloudflare（同一账号）。

**命令行方式（本项目已采用）**：在 `wrangler.toml` 声明 `custom_domain`，部署时自动建 DNS 记录并签证书：

```toml
[[routes]]
pattern = "ipcheck.amw3.eu.org"
custom_domain = true
```

然后 `npm run deploy`，输出会同时列出两条路由：

```
Deployed claude-ip-check triggers
  https://claude-ip-check.<子域>.workers.dev
  ipcheck.amw3.eu.org (custom domain)
```

> ⚠️ 一旦声明了 `[[routes]]` 而未显式写 `workers_dev`，wrangler 会**默认关闭 `workers.dev`**。
> 想两者都保留就加 `workers_dev = true`（本项目已加）。

---

### 配置环境变量

网页路径：**Worker → Settings → Variables and Secrets → Add**

| Name | Type | Value |
|---|---|---|
| `PORTAL_URL` | Text | 门户地址，例如 `https://amw3.eu.org/`；**留空则隐藏「返回门户」按钮** |
| `DNS_TEST_HOSTS` | Text | 留空，或填 `d1.example.com,d2.example.com`（逗号分隔的额外探测域名） |
| `FLAG_CDN` | Text | `https://flagcdn.com/24x18/{cc}.png` |

> 网页端添加的变量优先级高于 `wrangler.toml` 的 `[vars]`。两者都配时以网页端为准。

---

### 启用 KV 缓存（可选）

不启用也能跑（自动降级到单 PoP 的 Cache API），启用后跨机房共享结果、回源显著下降。

1. **Storage & Databases → Workers KV → Create a namespace**，名称填 `claude-ip-check-cache`。
2. 进入该命名空间，复制 **Namespace ID**。
3. 回到 Worker → **Settings → Bindings → Add binding**：
   - Type: **KV namespace**
   - Variable name: `IP_KV`（**必须完全一致**，代码里按此名读取）
   - KV namespace: 选刚创建的命名空间
4. 重新部署一次才会生效。

命令行方式：`npm run kv:create`，把返回的 `id` 填进 `wrangler.toml` 的 `[[kv_namespaces]]` 并取消注释。

---

### 部署后验证

```bash
curl https://<你的域名>/api/healthz
# 期望返回：{"ok":true,"version":"1.0.0","colo":"..."}

curl https://<你的域名>/api/iprisk/1.1.1.1
# 期望返回含 trust_score、country_zh 等字段的完整 JSON
```

浏览器打开首页，三个出口 IP 卡片应在 2–3 秒内完成加载。

---

### 常见失败排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 构建日志报 `npm run build` 失败 | Build command 被填成了默认值 | 改为 `npm install` |
| 构建报 `wrangler.toml not found` | Root directory 填错 | 填 `/` 或项目所在的子目录 |
| 首页 200 但 `/api/healthz` 返回 HTML | `run_worker_first` 未生效 | 确认 wrangler ≥ 3.78（建议 4.x），检查 `[assets]` 段是否完整 |
| 页面提示 `ASSETS binding missing` | 静态资源未随部署上传 | 重新部署；确认 `public/` 已提交进 Git |
| 自定义域名访问 404 | 未在 Worker 上绑定路由 | 在 Domains & Routes 重新添加并等待生效 |
| 首次访问很慢、之后变快 | 外部数据源回源 | 正常；启用 KV 后跨机房也会命中 |
| 国内出口 IP 显示「获取失败」 | 第三方站点 CORS 限制 | 预期行为，不影响其余模块 |

---

## 五、配置项速查

完整的网页端配置步骤见「四、部署 → 配置环境变量 / 启用 KV 缓存」。下表为速查：

| 变量 | 配置位置 | 默认值 | 说明 |
|---|---|---|---|
| `PORTAL_URL` | 网页 Variables / `wrangler.toml [vars]` | `https://amw3.eu.org/` | 页头「返回门户」按钮指向的地址，留空则隐藏按钮 |
| `DNS_TEST_HOSTS` | 网页 Variables / `wrangler.toml [vars]` | 空 | 逗号分隔的额外探测域名，用于 DNS 出口一致性比对 |
| `FLAG_CDN` | 网页 Variables / `wrangler.toml [vars]` | `https://flagcdn.com/24x18/{cc}.png` | 国旗图片模板，`{cc}` 替换小写国家码 |
| `IP_KV` | 网页 Bindings / `[[kv_namespaces]]` | 未绑定 | 可选 KV 缓存命名空间，绑定名必须写作 `IP_KV` |

---

## 六、API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/healthz` | 健康检查，返回版本与机房代码 |
| GET | `/api/config` | 前端运行配置 |
| GET | `/api/geoip/{ip}` | IP 归属查询（缓存 24h） |
| GET | `/api/geoip-batch?ips=a,b,c` | 批量归属查询，最多 8 个 |
| GET | `/api/iprisk/{ip}` | IP 风险画像 + 信任评分（缓存 6h） |
| GET | `/api/rdns/{ip}` | 反向 DNS |
| GET | `/api/echo` | 分流一致性探测，返回该域名视角下的出口 IP |
| POST | `/api/session` | 匿名统计上报（默认不落库，直接返回 ok） |

示例：

```bash
curl https://<your-domain>/api/iprisk/1.1.1.1 | jq
```

---

## 七、目录结构

```
cf-claude-ip-check/
├── wrangler.toml          # Worker 配置（含 Assets、KV、路由）
├── package.json
├── src/
│   ├── index.js           # 路由入口
│   └── lib/
│       ├── http.js        # 超时 fetch 封装 / IP 校验
│       ├── cache.js       # KV → Cache API 二级缓存
│       ├── geoip.js       # IP 归属查询（三源降级）
│       ├── iprisk.js      # 风险画像合成
│       ├── trustscore.js  # 评分模型与地区策略
│       ├── tor.js         # Tor 出口列表
│       └── rdns.js        # DoH 反向解析
└── public/
    ├── index.html
    ├── style.css
    ├── app.js
    └── favicon.svg
```

---

## 八、已知限制

1. **DNS 解析器级泄露检测不可用** —— 架构原因，已改为出口一致性检测。
2. **滥用记录**为代理指标（数据源风险分 ≥ 75 判定）。若需真实黑名单，可在 `iprisk.js` 中接入 AbuseIPDB（需 Key）。
3. **爬虫识别**为启发式，骨干 ASN（如 4134/4837/9808）仅在组织名或 rDNS 命中关键字时才判定，避免误伤普通宽带用户。
4. **中国出口 IPv4** 依赖第三方页面的 CORS 策略，失败时显示「获取失败」，属预期行为。
5. 免费版 Workers 有 10ms CPU/请求限制；本实现的外部请求多为并发且带超时，正常路径约 3–6ms CPU，但首次回源可能触发子请求数量上限（免费版 50 个/请求，本实现最多约 12 个）。

---

## 九、合规声明

本工具仅用于自查网络出口质量与代理配置是否正确，不采集、不存储任何访问者身份信息；
IP 历史仅保存在访问者浏览器 localStorage 中。请勿用于规避他人服务条款。
