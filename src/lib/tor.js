/**
 * Tor 出口节点列表。
 *
 * 使用 Tor Project 官方批量出口列表作为 ipquery.io `is_tor` 字段的交叉校验。
 * 列表约 1000~3000 行，缓存 6 小时后写入 Cache API / KV，避免每次请求回源。
 * 该源在中国大陆网络下经常不可达，失败时静默降级，不判定为 Tor。
 */

import { fetchText } from './http.js';
import { withCache } from './cache.js';

const TOR_LIST_URL = 'https://check.torproject.org/torbulkexitlist';
const TOR_TTL = 6 * 3600;

/**
 * 获取 Tor 出口节点集合。
 *
 * Args:
 *   env: Worker 环境变量。
 *   ctx: 执行上下文。
 *
 * Returns:
 *   Promise<string[]>: 出口 IP 数组；拉取失败时返回空数组。
 */
export async function torExitList(env, ctx) {
  const data = await withCache('tor:exitlist', TOR_TTL, env, ctx, async () => {
    const text = await fetchText(TOR_LIST_URL, { timeout: 6000 });
    if (!text) return null;
    const list = text
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s));
    if (list.length === 0) return null;
    return { list };
  });
  return (data && data.list) || [];
}

/**
 * 判断 IP 是否为 Tor 出口节点。
 *
 * Args:
 *   ip: 目标 IP。
 *   env: Worker 环境变量。
 *   ctx: 执行上下文。
 *
 * Returns:
 *   Promise<boolean>: 命中返回 true；列表不可用时返回 false。
 */
export async function isTorExit(ip, env, ctx) {
  try {
    const list = await torExitList(env, ctx);
    if (!list.length) return false;
    return list.includes(ip);
  } catch {
    return false;
  }
}
