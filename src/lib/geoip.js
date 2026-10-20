/**
 * IP 归属查询（geoip）。
 *
 * 数据源优先级：ipwho.is → ipapi.co → ipleak.net。
 * 三者均无需 API Key、支持 HTTPS，前两者提供城市级精度，ipleak.net 提供
 * ASN 与 rDNS 兜底。任一失败自动降级到下一个。
 */

import { fetchJson } from './http.js';
import { withCache } from './cache.js';
import { withZhName } from './i18n.js';

const GEO_TTL = 24 * 3600; // 24 小时

/**
 * 查询 IP 的地理位置与 ASN 信息（带缓存）。
 *
 * Args:
 *   ip: 目标 IP。
 *   env: Worker 环境变量。
 *   ctx: 执行上下文。
 *
 * Returns:
 *   Promise<object|null>: 归一化后的归属信息；全部数据源失败返回 null。
 */
export function lookupGeo(ip, env, ctx) {
  return withCache(`geoip:${ip}`, GEO_TTL, env, ctx, async () => {
    const geo = await fetchGeo(ip);
    return withZhName(geo);
  });
}

/**
 * 依次尝试三个数据源拉取归属信息。
 *
 * Args:
 *   ip: 目标 IP。
 *
 * Returns:
 *   Promise<object|null>: 归一化结果。
 */
async function fetchGeo(ip) {
  const who = await fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}`, {
    timeout: 4500,
  });
  if (who && who.success !== false && who.country_code) {
    return {
      ip,
      country: who.country || '',
      country_code: (who.country_code || '').toUpperCase(),
      region: who.region || '',
      city: who.city || '',
      latitude: who.latitude ?? null,
      longitude: who.longitude ?? null,
      timezone: (who.timezone && who.timezone.id) || '',
      isp: (who.connection && (who.connection.isp || who.connection.org)) || '',
      asn: (who.connection && who.connection.asn) || null,
      org: (who.connection && who.connection.org) || '',
      is_eu: !!who.is_eu,
      source: 'ipwho.is',
    };
  }

  const co = await fetchJson(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
    timeout: 4500,
  });
  if (co && co.country_code && !co.error) {
    return {
      ip,
      country: co.country_name || '',
      country_code: (co.country_code || '').toUpperCase(),
      region: co.region || '',
      city: co.city || '',
      latitude: co.latitude ?? null,
      longitude: co.longitude ?? null,
      timezone: co.timezone || '',
      isp: co.org || '',
      asn: co.asn ? parseInt(String(co.asn).replace(/^AS/i, ''), 10) : null,
      org: co.org || '',
      is_eu: !!co.in_eu,
      source: 'ipapi.co',
    };
  }

  const leak = await fetchJson(`https://ipleak.net/json/${encodeURIComponent(ip)}`, {
    timeout: 4500,
  });
  if (leak && leak.country_code) {
    return {
      ip,
      country: leak.country_name || '',
      country_code: (leak.country_code || '').toUpperCase(),
      region: leak.region_name || '',
      city: leak.city_name || '',
      latitude: leak.latitude ?? null,
      longitude: leak.longitude ?? null,
      timezone: leak.time_zone || '',
      isp: leak.isp_name || '',
      asn: leak.as_number || null,
      org: leak.isp_name || '',
      is_eu: !!leak.country_eu,
      source: 'ipleak.net',
    };
  }

  return null;
}

/**
 * 批量查询（并发上限保护，最多 8 个）。
 *
 * Args:
 *   ips: IP 数组。
 *   env: Worker 环境变量。
 *   ctx: 执行上下文。
 *
 * Returns:
 *   Promise<object>: { ip: geo|null } 映射。
 */
export async function lookupGeoBatch(ips, env, ctx) {
  const list = ips.slice(0, 8);
  const results = await Promise.all(
    list.map((ip) => lookupGeo(ip, env, ctx).catch(() => null))
  );
  const out = {};
  list.forEach((ip, i) => {
    out[ip] = results[i];
  });
  return out;
}
