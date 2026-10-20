/**
 * Claude 信任评分（Trust Score）与地区策略。
 *
 * 评分模型为启发式加权扣分制：满分 100，按风险因子逐项扣分，最后夹取到
 * [0, 100]。位于 Claude 明确不支持的地区时强制归零，
 * 因为即便 IP 本身干净，Claude 也会对该地区来源会话执行严格风控。
 */

/**
 * Claude 明确不支持 / 重度风控的地区（ISO 3166-1 alpha-2）。
 * 单数据源，评分与可用性检测共用。
 */
export const CLAUDE_RESTRICTED_CC = {
  CN: '中国大陆',
  HK: '中国香港',
  MO: '中国澳门',
  RU: '俄罗斯',
  KP: '朝鲜',
  IR: '伊朗',
  SY: '叙利亚',
  CU: '古巴',
  BY: '白俄罗斯',
  VE: '委内瑞拉',
};

/**
 * Anthropic 公开支持列表之外的常见高风险地区（命中额外扣分，不归零）。
 * 这些地区不在官方支持清单中，注册与登录容易被拒。
 */
export const CLAUDE_UNSUPPORTED_CC = new Set([
  'AF', 'DZ', 'AO', 'BD', 'BO', 'BW', 'BF', 'BI', 'CM', 'CF', 'TD', 'KM',
  'CG', 'CD', 'DJ', 'EC', 'EG', 'GQ', 'ER', 'SZ', 'ET', 'GA', 'GM', 'GH',
  'GN', 'GW', 'GY', 'HT', 'HN', 'IQ', 'CI', 'KE', 'LA', 'LB', 'LS', 'LR',
  'LY', 'MG', 'MW', 'ML', 'MR', 'MU', 'YT', 'MZ', 'MM', 'NA', 'NP', 'NE',
  'NG', 'PY', 'RW', 'ST', 'SN', 'SC', 'SL', 'SO', 'SS', 'SD', 'SR', 'TJ',
  'TZ', 'TG', 'TN', 'TM', 'UG', 'UZ', 'VU', 'YE', 'ZM', 'ZW',
]);

/**
 * 已知爬虫 / 机器人 ASN 与组织关键字。
 * 命中即判定为爬虫流量，Claude 对这类出口一律拦截。
 */
const CRAWLER_ASN = new Set([
  15169, // Google
  396982, // Google Cloud
  16509, // Amazon
  14618, // Amazon
  13335, // Cloudflare（多为代理/机器人中继）
  8075, // Microsoft
  32934, // Facebook
  36647, // Yahoo
  4837, // 联通骨干（国内出口常见）
  4134, // 电信骨干
  9808, // 移动骨干
]);

const CRAWLER_ORG_RE =
  /(google|bing|baidu|sogou|so\.com|yandex|semrush|ahrefs|mj12|dotbot|petalbot|bytespider|amazonbot|applebot|claudebot|gptbot|crawler|spider|bot\b)/i;

/**
 * 判断某 IP 是否疑似爬虫 / 机器人出口。
 *
 * Args:
 *   asn: ASN 数字。
 *   org: 组织名。
 *   rdns: 反向解析结果，可为空。
 *
 * Returns:
 *   boolean: 疑似爬虫返回 true。
 */
export function detectCrawler(asn, org, rdns) {
  if (asn && CRAWLER_ASN.has(Number(asn))) {
    // 骨干 ASN 只在组织名也匹配爬虫关键字时才判定，避免误伤普通宽带用户
    if (CRAWLER_ORG_RE.test(org || '')) return true;
    if ([4837, 4134, 9808].includes(Number(asn))) return false;
    if (CRAWLER_ORG_RE.test(rdns || '')) return true;
  }
  if (CRAWLER_ORG_RE.test(org || '')) return true;
  if (rdns && /(bot|crawler|spider)\./i.test(rdns)) return true;
  return false;
}

/**
 * 计算 Claude 信任评分。
 *
 * Args:
 *   input: 风险因子集合，字段同 /api/iprisk 内部中间态。
 *
 * Returns:
 *   object: { trust_score, reasons, restricted, unsupported }
 */
export function computeTrustScore(input) {
  const {
    countryCode = '',
    is_datacenter = false,
    is_vpn = false,
    is_proxy = false,
    is_tor = false,
    is_mobile = false,
    is_crawler = false,
    is_abuser = false,
    risk_score = 0,
    is_residential = null,
  } = input || {};

  const cc = String(countryCode || '').toUpperCase();
  const reasons = [];

  const restricted = CLAUDE_RESTRICTED_CC[cc] || null;
  const unsupported = CLAUDE_UNSUPPORTED_CC.has(cc);

  let score = 100;

  if (is_tor) {
    score -= 70;
    reasons.push('Tor 出口节点');
  }
  if (is_vpn) {
    score -= 30;
    reasons.push('已知 VPN 出口');
  }
  if (is_proxy) {
    score -= 25;
    reasons.push('代理 / 中继出口');
  }
  if (is_datacenter) {
    score -= 35;
    reasons.push('机房 / 数据中心 IP');
  }
  if (is_crawler) {
    score -= 20;
    reasons.push('疑似爬虫流量');
  }
  if (is_abuser) {
    score -= 20;
    reasons.push('存在滥用记录');
  }
  if (is_mobile) {
    score -= 5;
    reasons.push('移动基站 IP（地址频繁轮换）');
  }
  if (unsupported) {
    score -= 30;
    reasons.push(`${cc} 不在 Claude 支持地区清单`);
  }
  if (typeof risk_score === 'number' && risk_score > 0) {
    score -= Math.round(risk_score * 0.15);
  }
  if (is_residential === true) {
    score += 5;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // 受限地区强制归零：风控层面事实上不可访问
  if (restricted) {
    return { trust_score: 0, reasons, restricted, unsupported };
  }
  return { trust_score: score, reasons, restricted: null, unsupported };
}
