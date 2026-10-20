/**
 * IP 风险画像（iprisk）。
 *
 * 综合三个维度：
 *   1. 出口类型  —— api.ipquery.io 提供 vpn / proxy / tor / datacenter / mobile 标记与风险分；
 *   2. 归属与 ASN —— geoip 模块（ipwho.is 等）提供国家、城市、ASN、运营商、时区；
 *   3. 交叉校验  —— Tor 官方出口列表、反向 DNS、组织名关键字（爬虫 / 机房识别）。
 *
 * 全部数据源免 Key、支持 HTTPS，任一失败自动降级，不会因单点不可用导致整页报错。
 */

import { fetchJson } from './http.js';
import { withCache } from './cache.js';
import { lookupGeo } from './geoip.js';
import { isTorExit } from './tor.js';
import { lookupRdns } from './rdns.js';
import { computeTrustScore, detectCrawler } from './trustscore.js';
import { ccToZh } from './i18n.js';

const RISK_TTL = 6 * 3600; // 6 小时

const HOSTING_RE =
  /(hosting|host|datacenter|data ?center|cloud|server|vps|dedicated|colo|hetzner|ovh|digitalocean|vultr|linode|aws|amazon|google|azure|oracle|alibaba|tencent|huawei|ucloud|contabo|leaseweb|m247|psychz|frantech|buyvm|zenlayer|quake|gcore|scaleway|upcloud|ramnode|ionos|godaddy|namecheap|bluehost)/i;
const EDU_RE = /(universit|university|college|school|academic|edu\b|教育|大学|学院)/i;
const ISP_RE =
  /(telecom|mobile|unicom|broadband|internet|communications|comcast|verizon|at&t|t-mobile|vodafone|deutsche|bt |orange|telefonica|ntt|kddi|softbank|sk telecom|kt corp|lg uplus|chunghwa|中国|电信|移动|联通|广电)/i;

/**
 * 根据组织名推断公司类型。
 *
 * Args:
 *   org: ASN 组织名。
 *
 * Returns:
 *   string: hosting / isp / business / education 之一，无法判定返回 ''。
 */
export function classifyCompany(org) {
  const s = org || '';
  if (EDU_RE.test(s)) return 'education';
  if (HOSTING_RE.test(s)) return 'hosting';
  if (ISP_RE.test(s)) return 'isp';
  return 'business';
}

/**
 * 查询 IP 风险画像（带缓存）。
 *
 * Args:
 *   ip: 目标 IP。
 *   env: Worker 环境变量。
 *   ctx: 执行上下文。
 *
 * Returns:
 *   Promise<object>: 风险画像对象，字段与本服务 /api/iprisk 契约一致。
 */
export function lookupRisk(ip, env, ctx) {
  return withCache(`iprisk:${ip}`, RISK_TTL, env, ctx, () => buildRisk(ip, env, ctx));
}

/**
 * 并发拉取各数据源并合成风险画像。
 *
 * Args:
 *   ip: 目标 IP。
 *   env: Worker 环境变量。
 *   ctx: 执行上下文。
 *
 * Returns:
 *   Promise<object>: 风险画像对象。
 */
async function buildRisk(ip, env, ctx) {
  const [risk, geo, torHit, rdns] = await Promise.all([
    fetchJson(`https://api.ipquery.io/${encodeURIComponent(ip)}`, { timeout: 5000 }),
    lookupGeo(ip, env, ctx).catch(() => null),
    isTorExit(ip, env, ctx).catch(() => false),
    lookupRdns(ip, env, ctx).catch(() => ''),
  ]);

  const r = (risk && risk.risk) || {};
  const loc = (risk && risk.location) || {};
  const isp = (risk && risk.isp) || {};

  const country = (geo && geo.country) || loc.country || '';
  const countryCode = ((geo && geo.country_code) || loc.country_code || '').toUpperCase();
  const region = (geo && geo.region) || loc.state || '';
  const city = (geo && geo.city) || loc.city || '';
  const timezone = (geo && geo.timezone) || loc.timezone || '';

  const asnRaw = (geo && geo.asn) || isp.asn || '';
  const asn = parseInt(String(asnRaw).replace(/^AS/i, ''), 10) || null;
  const asOrganization = (geo && geo.org) || isp.org || isp.isp || '';

  const is_datacenter = r.is_datacenter === true;
  const is_mobile = r.is_mobile === true;
  const is_vpn = r.is_vpn === true;
  const is_proxy = r.is_proxy === true;
  const is_tor = r.is_tor === true || torHit === true;
  const risk_score = typeof r.risk_score === 'number' ? r.risk_score : 0;

  // 机房 IP 的补充判定：数据源未标记时，用组织名 / rDNS 关键字兜底
  const orgLooksHosting = HOSTING_RE.test(asOrganization) || HOSTING_RE.test(rdns);
  const datacenterName = is_datacenter || orgLooksHosting ? asOrganization || rdns || '' : '';
  const isDatacenterFinal = is_datacenter || orgLooksHosting;

  const is_crawler = detectCrawler(asn, asOrganization, rdns);
  // 滥用：以数据源风险分作为代理指标（无 AbuseIPDB Key 时不查询黑名单）
  const is_abuser = risk_score >= 75;
  const abuser_score = risk_score;

  const is_residential = isDatacenterFinal ? false : !is_vpn && !is_proxy ? true : null;

  const { trust_score, reasons, restricted, unsupported } = computeTrustScore({
    countryCode,
    is_datacenter: isDatacenterFinal,
    is_vpn,
    is_proxy,
    is_tor,
    is_mobile,
    is_crawler,
    is_abuser,
    risk_score,
    is_residential,
  });

  return {
    ip,
    // —— 出口类型 ——
    is_datacenter: isDatacenterFinal,
    is_vpn,
    is_proxy,
    is_tor,
    is_crawler,
    is_abuser,
    is_mobile,
    is_residential,
    // —— 公司 / 机房 ——
    company_type: classifyCompany(asOrganization),
    company_name: asOrganization || '',
    datacenter_name: datacenterName,
    abuser_score,
    risk_score,
    // —— 归属 ——
    asn,
    asOrganization,
    country,
    country_zh: ccToZh(countryCode) || country,
    countryCode,
    region,
    city,
    timezone,
    latitude: (geo && geo.latitude) ?? null,
    longitude: (geo && geo.longitude) ?? null,
    rdns,
    // —— 评分 ——
    trust_score,
    isResidential: is_residential,
    isBroadcast: null,
    // —— 地区策略 ——
    restricted_region: restricted || null,
    blocked_region: !!restricted,
    unsupported_region: unsupported,
    // —— 调试 / 溯源 ——
    reasons,
    sources: {
      risk: risk ? 'api.ipquery.io' : null,
      geo: (geo && geo.source) || (loc.country ? 'api.ipquery.io' : null),
      tor: torHit ? 'check.torproject.org' : null,
      rdns: rdns ? 'cloudflare-doh' : null,
    },
  };
}
