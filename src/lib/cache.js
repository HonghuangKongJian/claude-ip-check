/**
 * 缓存层：优先使用 KV（可选绑定），否则退回 Workers Cache API。
 *
 * 设计取舍：
 * - KV 是跨 PoP 强一致读（最终一致写），适合跨地域共享评分结果；
 * - Cache API 是单 PoP 本地缓存，零配置即可用，但不同机房结果不共享。
 * 未绑定 KV 时自动降级到 Cache API，保证「开箱即部署」。
 */

const PREFIX = 'cic:v1:';

/**
 * 读取缓存。
 *
 * Args:
 *   key: 缓存键。
 *   env: Worker 环境变量。
 *
 * Returns:
 *   Promise<any|null>: 命中的值，未命中返回 null。
 */
async function kvGet(key, env) {
  if (!env.IP_KV) return null;
  try {
    return await env.IP_KV.get(PREFIX + key, { type: 'json' });
  } catch {
    return null;
  }
}

/**
 * 写入缓存。
 *
 * Args:
 *   key: 缓存键。
 *   value: 待缓存的值（需可 JSON 序列化）。
 *   ttl: 过期秒数。
 *   env: Worker 环境变量。
 *   ctx: 执行上下文，用于 waitUntil。
 *
 * Returns:
 *   Promise<void>
 */
async function kvPut(key, value, ttl, env, ctx) {
  if (!env.IP_KV) return;
  const p = env.IP_KV.put(PREFIX + key, JSON.stringify(value), {
    expirationTtl: ttl,
  });
  if (ctx && ctx.waitUntil) ctx.waitUntil(p);
  else await p;
}

/**
 * 带缓存地执行生产者函数。
 *
 * Args:
 *   key: 缓存键。
 *   ttl: 过期秒数。
 *   env: Worker 环境变量。
 *   ctx: 执行上下文。
 *   producer: 未命中时调用的异步工厂函数。
 *
 * Returns:
 *   Promise<any>: 缓存值或新生成的值；producer 返回 null 时不写缓存。
 */
export async function withCache(key, ttl, env, ctx, producer) {
  const cached = await kvGet(key, env);
  if (cached !== null && cached !== undefined) return cached;

  // Cache API 兜底（仅 caches.default 在 Workers 中可用）
  const cache = caches.default;
  const cacheKey = new Request(`https://cache.internal/${encodeURIComponent(key)}`);
  try {
    const hit = await cache.match(cacheKey);
    if (hit) return JSON.parse(await hit.text());
  } catch {
    /* 忽略缓存读取异常，直接走网络 */
  }

  const value = await producer();
  if (value === null || value === undefined) return null;

  const body = JSON.stringify(value);
  const res = new Response(body, {
    headers: {
      'content-type': 'application/json',
      'cache-control': `public, max-age=${ttl}`,
    },
  });
  try {
    if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    else await cache.put(cacheKey, res.clone());
  } catch {
    /* 某些子请求场景下 Cache API 不可用，忽略 */
  }
  await kvPut(key, value, ttl, env, ctx);
  return value;
}
