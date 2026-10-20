/**
 * HTTP 工具：带超时与外部数据源兜底的 JSON 拉取。
 *
 * Cloudflare Workers 环境没有 `node-fetch`，直接使用运行时内置的 fetch。
 * 所有外部数据源调用都失败静默（返回 null），由上层决定是否降级。
 */

const DEFAULT_UA =
  'Mozilla/5.0 (compatible; ClaudeIPCheck/1.0; +https://github.com/)';

/**
 * 拉取并解析 JSON。
 *
 * Args:
 *   url: 目标地址。
 *   timeout: 超时毫秒数，默认 5000。
 *   headers: 附加请求头。
 *
 * Returns:
 *   object|null: 解析后的对象；失败或超时返回 null。
 */
export async function fetchJson(url, { timeout = 5000, headers = {} } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': DEFAULT_UA,
        accept: 'application/json, text/plain, */*',
        ...headers,
      },
      signal: ac.signal,
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 拉取纯文本。
 *
 * Args:
 *   url: 目标地址。
 *   timeout: 超时毫秒数，默认 5000。
 *
 * Returns:
 *   string|null: 响应文本；失败返回 null。
 */
export async function fetchText(url, { timeout = 5000, headers = {} } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': DEFAULT_UA, ...headers },
      signal: ac.signal,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 判断字符串是否为合法 IP（v4 或 v6）。
 *
 * Args:
 *   ip: 待校验字符串。
 *
 * Returns:
 *   boolean: 合法返回 true。
 */
export function isValidIP(ip) {
  if (typeof ip !== 'string' || ip.length === 0 || ip.length > 45) return false;
  if (/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(ip)) {
    return true;
  }
  if (ip.includes(':')) {
    return /^[0-9a-fA-F:.]{2,45}$/.test(ip);
  }
  return false;
}

/**
 * 判断是否为 IPv6 地址（含 ':' 即视为 v6）。
 *
 * Args:
 *   ip: 待判断地址。
 *
 * Returns:
 *   boolean: IPv6 返回 true。
 */
export function isIPv6(ip) {
  return typeof ip === 'string' && ip.includes(':');
}
