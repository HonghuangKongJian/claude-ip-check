/**
 * Claude AI IP 风险检测 —— Cloudflare Worker 入口。
 *
 * 路由表：
 *   GET  /api/geoip/:ip        IP 归属查询
 *   GET  /api/geoip-batch      批量归属查询（?ips=a,b,c，最多 8 个）
 *   GET  /api/iprisk/:ip       IP 风险画像 + Claude 信任评分
 *   GET  /api/rdns/:ip         反向 DNS
 *   GET  /api/echo             分流一致性探测（返回本域名视角下的出口 IP）
 *   GET  /api/config           前端运行配置
 *   GET  /api/healthz          健康检查
 *   POST /api/session          匿名统计上报（默认仅计数，不落库）
 *   *                          静态资源（Assets 绑定）
 */

import { lookupGeo, lookupGeoBatch } from './lib/geoip.js';
import { lookupRisk } from './lib/iprisk.js';
import { lookupRdns } from './lib/rdns.js';
import { isValidIP } from './lib/http.js';

const VERSION = '1.0.0';

/**
 * 构造 JSON 响应。
 *
 * Args:
 *   data: 响应体对象。
 *   status: HTTP 状态码，默认 200。
 *   maxAge: 浏览器缓存秒数，默认 60。
 *
 * Returns:
 *   Response: 带 CORS 与安全头的响应。
 */
function json(data, status = 200, maxAge = 60) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${maxAge}`,
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
      'x-content-type-options': 'nosniff',
      referrer_policy: 'no-referrer',
    },
  });
}

/**
 * 从请求中提取客户端 IP。
 *
 * Args:
 *   request: 原始请求。
 *
 * Returns:
 *   string: 客户端 IP，取不到返回空字符串。
 */
function clientIP(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    ''
  );
}

/**
 * 从路径中抽取并校验 IP 段。
 *
 * Args:
 *   pathname: 请求路径。
 *   prefix: 路由前缀。
 *
 * Returns:
 *   string|null: 合法 IP 或 null。
 */
function extractIP(pathname, prefix) {
  const raw = decodeURIComponent(pathname.slice(prefix.length).replace(/^\/+|\/+$/g, ''));
  return isValidIP(raw) ? raw : null;
}

export default {
  /**
   * Worker 请求入口。
   *
   * Args:
   *   request: 请求对象。
   *   env: 环境变量与绑定。
   *   ctx: 执行上下文。
   *
   * Returns:
   *   Promise<Response>
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,OPTIONS',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '86400',
        },
      });
    }

    // —— 健康检查 ——
    if (url.pathname === '/api/healthz') {
      return json({ ok: true, version: VERSION, colo: request.cf?.colo || null });
    }

    // —— 前端配置 ——
    if (url.pathname === '/api/config') {
      const hosts = (env.DNS_TEST_HOSTS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return json({
        version: VERSION,
        dnsTestHosts: hosts,
        flagCdn: env.FLAG_CDN || 'https://flagcdn.com/24x18/{cc}.png',
        portalUrl: env.PORTAL_URL || '',
      });
    }

    // —— 分流一致性探测 ——
    // 浏览器从不同主机（或本域）并发请求该端点，比较各域名视角下看到的出口 IP。
    // 若与 Claude 出口 IP 不一致，说明存在分流 / DNS 出口不一致（即"泄露"）。
    if (url.pathname === '/api/echo') {
      return json({
        ip: clientIP(request),
        host: url.hostname,
        colo: request.cf?.colo || null,
        country: request.cf?.country || null,
        tls: request.cf?.tlsVersion || null,
        http: request.cf?.httpProtocol || null,
        ts: Date.now(),
      }, 200, 0);
    }

    // —— 归属查询 ——
    if (url.pathname.startsWith('/api/geoip/')) {
      const ip = extractIP(url.pathname, '/api/geoip/');
      if (!ip) return json({ error: 'invalid ip' }, 400);
      const geo = await lookupGeo(ip, env, ctx);
      if (!geo) return json({ error: 'lookup failed', ip }, 502);
      return json(geo, 200, 3600);
    }

    if (url.pathname === '/api/geoip-batch') {
      const ips = (url.searchParams.get('ips') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(isValidIP)
        .slice(0, 8);
      if (ips.length === 0) return json({ error: 'no valid ips' }, 400);
      const map = await lookupGeoBatch(ips, env, ctx);
      return json({ results: map }, 200, 3600);
    }

    // —— 风险画像 ——
    if (url.pathname.startsWith('/api/iprisk/')) {
      const ip = extractIP(url.pathname, '/api/iprisk/');
      if (!ip) return json({ error: 'invalid ip' }, 400);
      const risk = await lookupRisk(ip, env, ctx);
      if (!risk) return json({ error: 'lookup failed', ip }, 502);
      return json(risk, 200, 600);
    }

    // —— 反向 DNS ——
    if (url.pathname.startsWith('/api/rdns/')) {
      const ip = extractIP(url.pathname, '/api/rdns/');
      if (!ip) return json({ error: 'invalid ip' }, 400);
      const rdns = await lookupRdns(ip, env, ctx);
      return json({ ip, rdns }, 200, 3600);
    }

    // —— 匿名统计（默认不落库，仅返回确认）——
    if (url.pathname === '/api/session' && request.method === 'POST') {
      return json({ ok: true }, 200, 0);
    }

    // —— 静态资源 ——
    if (env.ASSETS) {
      const res = await env.ASSETS.fetch(request);
      if (res.status === 404) {
        return new Response('Not Found', { status: 404 });
      }
      return new Response(res.body, {
        status: res.status,
        headers: {
          ...Object.fromEntries(res.headers),
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'strict-origin-when-cross-origin',
        },
      });
    }

    return new Response('ASSETS binding missing', { status: 500 });
  },
};
