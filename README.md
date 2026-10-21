# Claude AI IP 风险检测 · Cloudflare 版

一套 **可完整部署在 Cloudflare** 的 Claude AI 出口 IP 风险检测页。
后端为单个 Cloudflare Worker（静态资源通过 Assets 绑定同仓托管），无需服务器、无数据库依赖，全球边缘运行。

演示站：<https://ipcheck.amw3.eu.org>

---

### 🚀 极简两步部署（先 Fork，后部署）

> 💡 **为什么推荐先 Fork？**  
> 拥有真正的 GitHub Fork 归属。日后原项目更新，只需在 GitHub 网页端点击 **`Sync fork`**，Cloudflare 就会**全自动同步构建部署最新版**，免去本地拉取代码的烦琐！

| 第一步：Fork 仓库到个人账号 | 第二步：导入 Cloudflare 部署 |
| :---: | :---: |
| [![Fork on GitHub](https://img.shields.io/badge/1._点击_Fork_本项目-24292e?style=for-the-badge&logo=github&logoColor=white)](https://github.com/14649814/claude-ip-check/fork) | [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create) |

> 📌 **操作提示**：进入 Cloudflare 控制台后，页面会显示 **`Continue with GitHub`**（右上角带绿点），**点击该卡片**即可进入仓库列表选择 `claude-ip-check`。

*(若不想在个人 GitHub 建立 Fork 关系，也可直接使用 [Cloudflare 独立克隆部署按钮](https://deploy.workers.cloudflare.com/?url=https://github.com/14649814/claude-ip-check))*

**目录**

- [一、功能清单](#一功能清单)
- [二、数据源](#二数据源)
- [三、信任评分模型](#三信任评分模型)
- [四、部署](#四部署)
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
自建 NS 侧可以看到「是哪个递归解析器来查的」，从而暴露访问者的真实 DNS 出口。
Cloudflare Workers **无法获取请求方的递归解析器 IP**（Cloudflare 的权威 DNS 日志不向用户开放），
因此该能力在纯 Cloudflare 上无法实现。

本项目改为 **「出口一致性」探测**：

1. 浏览器并发请求中性探测域名（默认当前域名，可通过 `DNS_TEST_HOSTS` 指定额外域名）的 `/api/echo`；
2. Worker 返回它在该域名视角下看到的出口 IP；
3. 与 `claude.ai` 视角的出口 IP 比对 —— **不一致即说明分流规则或 DNS 出口配置存在问题**（事实上的泄露）。

若确需解析器级检测，可自建权威 NS 并把结果接口挂到 `DNS_TEST_HOSTS` 上，前端逻辑无需改动。

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

部署方式任选，**强烈推荐方式一**：先 Fork 到自己 GitHub，再导入 Cloudflare 部署。全程只需网页点击，无需本地环境，且今后支持 **`Sync fork` 一键自动同步更新**。

| 方式 | 适用场景 | 是否需要本机环境 | 后续更新方式 |
|---|---|---|---|
| 一、先 Fork 后连接部署（推荐） | 长期使用、零命令网页一键更新 | 否 | 网页点 `Sync fork` 自动重新部署 |
| 二、官方 Deploy 按钮一键部署 | 快速验证、克隆为独立仓库 | 否 | 需本地添加 upstream 同步 |
| 三、控制台手动创建 + 命令行上传 | 需先建好资源再上传 | 是（Node ≥ 18） | 本地命令行部署 |
| 四、纯命令行 `wrangler deploy` | 本地开发与二次开发验证 | 是（Node ≥ 18） | 本地命令行部署 |

---

### 方式一：先 Fork 后连接部署（强烈推荐）

**第 1 步：Fork 仓库到自己的 GitHub**

1. 确保已登录 GitHub，点击 👉 **[一键 Fork 本项目](https://github.com/14649814/claude-ip-check/fork)**。
2. 保持默认仓库名 `claude-ip-check`，点击绿色的 **Create fork**（约 3 秒完成）。

**第 2 步：在 Cloudflare 控制台导入仓库**

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)，进入 **Workers & Pages → Create（创建）**（或直接点击 README 顶部的第二步按钮）。
2. 在“创建新项目”页面中，**点击【Continue with GitHub】卡片**（卡片右上角的绿点表示已授权连接，点击它即可进入仓库选择列表）。
3. 在弹出的仓库列表中，选中刚刚 Fork 的 **`claude-ip-check`**。

> 💡 **若列表中找不到刚 Fork 的仓库**：说明初次授权时勾选了“仅选择指定仓库”。点击列表上方的 *Configure GitHub app* 或 *Adjust permissions*，勾选新增的 `claude-ip-check` 即可。

**第 3 步：确认构建配置**

| 字段 | 填写内容 | 说明 |
|---|---|---|
| Project name | `claude-ip-check` | 须与 `wrangler.toml` 的 `name` 一致 |
| Root directory | `/` | 仓库根目录直接填 `/` |
| Build command | `npm install` | ⚠️ **切勿留空**，本项目无 build 脚本，填 `npm install` 即可 |
| Deploy command | `npx wrangler deploy` | 保持默认即可 |
| Node version | 18 或更高 | 保持默认 |

**第 4 步：保存并部署**

点击 **Save and Deploy**。初次构建约 1 分钟，日志出现 `Total Upload: ...` 即表示部署成功，并返回 `https://claude-ip-check.<子域>.workers.dev` 访问地址。

**🌟 日后如何同步原作者更新？**

当原作者发布新功能或修复时，您无需敲任何命令：
1. 打开自己 GitHub 上的该仓库页面；
2. 点击标题正下方的 **`Sync fork` → `Update branch`**；
3. **Cloudflare 会自动检测到新提交并自动重新构建部署**，约几十秒后您的站点即可无缝升级为最新版！

---

### 方式二：官方 Deploy 按钮一键部署（克隆为独立仓库）

若不想与原项目建立 GitHub Fork 关系，可使用 Cloudflare 官方提供的 Deploy 按钮：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/14649814/claude-ip-check)

Cloudflare 会在获得授权后，调用 API 在您的 GitHub 下**克隆创建一个全新独立的同名仓库**并自动绑定部署：

> 授权 → **克隆创建全新独立仓库** → 读取 `wrangler.toml` → Workers Builds 执行 `npm install` + `npx wrangler deploy` → 返回 `*.workers.dev` 地址。

**注意**：
1. 此方式创建的是独立仓库（非官方 Fork），页面上不具备 GitHub 的 `Sync fork` 按钮，后续同步更新需在本地终端通过 `git remote add upstream` 手动拉取。
2. **Build command** 同样需确认填写为 `npm install`，切勿留空。
3. `workers.dev` 域名在大陆网络环境下可能受 DNS 污染，如遇无法打开，请参考下方 [绑定自定义域名](#绑定自定义域名)。

---

### 方式三：控制台手动创建 Worker + 命令行上传

> ⚠️ **限制说明**：Cloudflare 控制台的在线代码编辑器是单文件 JS 编辑器，
> 无法上传 `public/` 目录下的静态资源，也不能编辑 `wrangler.toml`。
> 因此本项目**不能**只靠网页编辑器部署完整功能。网页端只负责「建坑位 + 拿凭据」，
> 实际代码仍需命令行上传。

**第 1 步：网页创建空 Worker**

**Workers & Pages → Create → Start with Hello World** → 命名 `claude-ip-check` → Deploy。

**第 2 步：网页创建 API Token**

1. 右上角头像 → **My Profile → API Tokens → Create Token**。
2. 选 **Create Custom Token**，按下表配置：

| 项目 | 配置 |
|---|---|
| Permissions | Account · Workers Scripts · **Edit** |
| Permissions | Account · Workers KV Storage · **Edit**（仅启用 KV 时需要） |
| Account Resources | Include → 选中目标账号 |

3. 生成后**立即复制 Token**（只显示一次）。

**第 3 步：命令行上传**

```bash
# Windows PowerShell
$env:CLOUDFLARE_API_TOKEN="<Token>"
$env:CLOUDFLARE_ACCOUNT_ID="<Account ID>"
npx wrangler deploy
```

```bash
# macOS / Linux / Git Bash
export CLOUDFLARE_API_TOKEN="<Token>"
export CLOUDFLARE_ACCOUNT_ID="<Account ID>"
npx wrangler deploy
```

Account ID 位于 **Workers & Pages** 概览页右侧。

---

### 方式四：纯命令行部署

```bash
npm install            # 安装 wrangler
npx wrangler login     # 浏览器授权登录（无需手动配 Token）
npm run dev            # 本地预览 http://localhost:8787
npm run deploy         # 部署，仅分配 workers.dev 域名
npm run deploy:domain  # 部署并绑定 wrangler.local.toml 中声明的自定义域名
```

> 若本机设置了代理，本地预览时需 `NO_PROXY=127.0.0.1,localhost`（Windows 下同样适用），
> 否则请求会被代理转发而连不上本地服务。

---

### 绑定自定义域名

`*.workers.dev` 在中国大陆常被 DNS 污染，生产使用建议绑定自有域名。

**网页方式**（任意部署方式均适用）

1. 进入该 Worker → **Settings → Domains & Routes**。
2. **Add → Custom domain**，输入 `ip.example.com`。
3. 确认后 Cloudflare 会自动写入 DNS 记录并签发证书，等待 1–5 分钟生效。

前提：`example.com` 的 DNS 已托管在 Cloudflare 的**同一账号**下。

**命令行方式**

在个人配置文件 `wrangler.local.toml` 中声明（该文件已在 `.gitignore` 中，不会进入仓库）：

```toml
[[routes]]
pattern = "ip.example.com"
custom_domain = true
```

执行 `npm run deploy:domain`，输出会同时列出两条路由：

```
Deployed claude-ip-check triggers
  https://claude-ip-check.<子域>.workers.dev
  ip.example.com (custom domain)
```

**三点注意事项**

1. 声明 `[[routes]]` 而未显式设置 `workers_dev = true` 时，wrangler 会**默认关闭 `workers.dev`**。
   若需两个域名并存，务必显式开启。
2. **自定义域名不要写进 `wrangler.toml`**。该文件是公开模板，他人 fork 后账号内没有对应 zone，
   部署会直接失败。个人化配置一律放入 `wrangler.local.toml` 或控制台。
3. 已绑定自定义域名的实例应固定使用 `npm run deploy:domain`。使用 `npm run deploy`（读 `wrangler.toml`）
   会按模板同步路由，可能覆盖既有的自定义域名绑定。

---

### 配置环境变量（可选）

网页路径：**Worker → Settings → Variables and Secrets → Add**

所有配置均已内置默认值，**不添加任何变量即可正常运行**。仅在需要定制时才添加同名变量覆盖：

| Name | Type | Value | 内置默认值 |
|---|---|---|---|
| `PORTAL_URL` | Text | 门户地址；设为 `-` 可隐藏「返回门户」按钮 | `https://amw3.eu.org/` |
| `DNS_TEST_HOSTS` | Text | `d1.example.com,d2.example.com`（逗号分隔的额外探测域名） | 空（只探测当前域名） |
| `FLAG_CDN` | Text | `https://flagcdn.com/24x18/{cc}.png` | 同左 |

> 网页端变量优先级高于内置默认值。默认值统一定义在 `src/lib/config.js` 的 `DEFAULTS`。
>
> 之所以不在 `wrangler.toml` 声明 `[vars]`：Deploy 按钮会把其中声明的变量作为待填项
> 呈现给部署者，与「零配置一键部署」的目标冲突。

---

### 启用 KV 缓存（可选）

不启用也能运行（自动降级到单 PoP 的 Cache API），启用后跨机房共享结果、回源显著下降。

1. **Storage & Databases → Workers KV → Create a namespace**，名称填 `claude-ip-check-cache`。
2. 进入该命名空间，复制 **Namespace ID**。
3. 回到 Worker → **Settings → Bindings → Add binding**：
   - Type: **KV namespace**
   - Variable name: `IP_KV`（**必须完全一致**，代码按此名读取）
   - KV namespace: 选择刚创建的命名空间
4. 重新部署一次才会生效。

命令行方式：`npm run kv:create`，把返回的 `id` 填入 `wrangler.toml` 的 `[[kv_namespaces]]` 并取消注释。

---

### 部署后验证

```bash
curl https://<域名>/api/healthz
# 期望返回：{"ok":true,"version":"1.0.0","colo":"..."}

curl https://<域名>/api/iprisk/1.1.1.1
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

完整配置步骤见「四、部署 → 配置环境变量 / 启用 KV 缓存」。下表为速查：

全部可留空——每项都内置了默认值，一键部署无需填写。

| 变量 | 配置位置 | 内置默认值 | 说明 |
|---|---|---|---|
| `PORTAL_URL` | 网页 Variables | `https://amw3.eu.org/` | 页头「返回门户」按钮地址；设为 `-` 可隐藏该按钮 |
| `DNS_TEST_HOSTS` | 网页 Variables | 空 | 逗号分隔的额外探测域名，用于 DNS 出口一致性比对 |
| `FLAG_CDN` | 网页 Variables | `https://flagcdn.com/24x18/{cc}.png` | 国旗图片模板，`{cc}` 替换小写国家码 |
| `IP_KV` | 网页 Bindings / `[[kv_namespaces]]` | 未绑定 | 可选 KV 缓存命名空间，绑定名必须写作 `IP_KV` |

> 默认值集中定义在 `src/lib/config.js` 的 `DEFAULTS`；网页端同名变量优先级更高。

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
curl https://example.com/api/iprisk/1.1.1.1 | jq
```

---

## 七、目录结构

```
cf-claude-ip-check/
├── wrangler.toml          # 公开模板配置（入库；PORTAL_URL 内置）
├── wrangler.local.toml    # 个人配置（.gitignore 忽略；可选，含自定义域名）
├── package.json
├── src/
│   ├── index.js           # 路由入口
│   └── lib/
│       ├── http.js        # 超时 fetch 封装 / IP 校验
│       ├── cache.js       # KV → Cache API 二级缓存
│       ├── geoip.js       # IP 归属查询（三源降级）
│       ├── i18n.js        # 国家代码 → 中文名
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

`wrangler.local.toml` 为可选项：不使用自定义域名时无需创建，直接 `npm run deploy` 即可。

---

## 八、已知限制

1. **DNS 解析器级泄露检测不可用** —— 架构原因，已改为出口一致性检测。
2. **滥用记录**为代理指标（数据源风险分 ≥ 75 判定）。若需真实黑名单，可在 `iprisk.js` 中接入 AbuseIPDB（需 Key）。
3. **爬虫识别**为启发式，骨干 ASN（如 4134/4837/9808）仅在组织名或 rDNS 命中关键字时才判定，避免误伤普通宽带用户。
4. **中国出口 IPv4** 依赖第三方页面的 CORS 策略，失败时显示「获取失败」，属预期行为。
5. 免费版 Workers 有 10ms CPU/请求限制；本实现的外部请求多为并发且带超时，正常路径约 3–6ms CPU，
   但首次回源可能触及子请求数量上限（免费版 50 个/请求，本实现最多约 12 个）。
6. **`*.workers.dev` 在中国大陆不可直连**，生产部署建议绑定自有域名。

---

## 九、合规声明

本工具仅用于自查网络出口质量与代理配置是否正确，不采集、不存储任何访问者身份信息；
IP 历史仅保存在访问者浏览器 localStorage 中。请勿用于规避他人服务条款。
