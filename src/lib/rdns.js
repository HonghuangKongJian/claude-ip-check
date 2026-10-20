/**
 * 反向 DNS（PTR）查询，通过 DNS-over-HTTPS 实现。
 *
 * Workers 运行时没有 UDP DNS 能力，只能走 DoH。使用 Cloudflare 公共 DoH
 * 端点；若被上游网络策略拦截则静默返回空字符串，不影响主流程。
 */

import { fetchJson } from './http.js';
import { withCache } from './cache.js';
import { isIPv6 } from './http.js';

const RDNS_TTL = 12 * 3600;

/**
 * 将 IPv4 转换为 in-addr.arpa 形式。
 *
 * Args:
 *   ip: IPv4 地址。
 *
 * Returns:
 *   string: 反序域名。
 */
function toArpaV4(ip) {
  return `${ip.split('.').reverse().join('.')}.in-addr.arpa`;
}

/**
 * 将 IPv6 转换为 ip6.arpa 形式。
 *
 * Args:
 *   ip: IPv6 地址（支持 :: 缩写）。
 *
 * Returns:
 *   string: 反序域名。
 */
function toArpaV6(ip) {
  let head = ip;
  let zone = '';
  const pct = ip.indexOf('%');
  if (pct >= 0) {
    head = ip.slice(0, pct);
    zone = ip.slice(pct);
  }
  const lastColon = head.lastIndexOf(':');
  let lhs = head.slice(0, lastColon);
  let rhs = head.slice(lastColon + 1);
  if (rhs.includes('.')) {
    const octets = rhs.split('.');
    rhs = octets.map((o) => Number(o).toString(16).padStart(2, '0')).join('');
  }
  const words = [];
  const expand = (s) => {
    if (s === '') return [];
    return s.split(':').map((w) => (w === '' ? '0' : w.padStart(4, '0')));
  };
  words.push(...expand(lhs));
  if (rhs) words.push(rhs.padStart(4, '0'));
  const missing = 8 - words.length;
  if (missing > 0) {
    const zeroIdx = lhs.includes('::') ? lhs.split(':').findIndex((w, i, arr) => w === '' ) : -1;
    if (zeroIdx >= 0) {
      const fill = new Array(missing).fill('0000');
      words.splice(zeroIdx, 0, ...fill);
    } else {
      while (words.length < 8) words.push('0000');
    }
  }
  const nibbles = words.join('').split('');
  return `${nibbles.reverse().join('.')}.ip6.arpa${zone}`;
}

/**
 * 查询 IP 的反向解析记录。
 *
 * Args:
 *   ip: 目标 IP。
 *   env: Worker 环境变量。
 *   ctx: 执行上下文。
 *
 * Returns:
 *   Promise<string>: PTR 记录值；无记录或查询失败返回空字符串。
 */
export function lookupRdns(ip, env, ctx) {
  return withCache(`rdns:${ip}`, RDNS_TTL, env, ctx, async () => {
    const name = isIPv6(ip) ? toArpaV6(ip) : toArpaV4(ip);
    const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(
      name
    )}&type=PTR`;
    const data = await fetchJson(url, {
      timeout: 3500,
      headers: { accept: 'application/dns-json' },
    });
    const answer = data && Array.isArray(data.Answer) ? data.Answer : [];
    const ptr = answer.find((a) => a.type === 12);
    const value = ptr && ptr.data ? String(ptr.data).replace(/\.$/, '') : '';
    return { rdns: value };
  }).then((r) => (r && r.rdns) || '');
}
