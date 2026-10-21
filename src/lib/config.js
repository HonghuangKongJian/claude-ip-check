/**
 * 运行配置的默认值与读取工具。
 *
 * 设计原则：一键部署不应要求使用者填写任何内容。所有可选配置都在代码
 * 中内置了可直接使用的默认值，部署者若需定制，在 Cloudflare 控制台
 * Worker → Settings → Variables and Secrets 添加同名变量覆盖即可。
 *
 * 因此 `wrangler.toml` 中不再声明 `[vars]`：一旦声明，Deploy 按钮会把
 * 这些变量作为待填项呈现给部署者，与「零配置一键部署」的目标冲突。
 */

/** 各配置项的内置默认值。 */
export const DEFAULTS = {
  /** 页头「返回门户」按钮指向的地址。 */
  PORTAL_URL: 'https://amw3.eu.org/',
  /** 分流一致性探测的额外主机名，逗号分隔；留空表示只探测当前域名。 */
  DNS_TEST_HOSTS: '',
  /** 国旗图片 CDN 模板，`{cc}` 替换为小写两位国家码。 */
  FLAG_CDN: 'https://flagcdn.com/24x18/{cc}.png',
};

/**
 * 读取字符串型配置。
 *
 * 缺失、非字符串或仅含空白时回落到内置默认值，保证任何情况下都能取到
 * 可用值；非空值会做去空白处理。
 *
 * Args:
 *   env: Worker 环境变量对象，可为 undefined。
 *   key: 配置项名称，须为 `DEFAULTS` 的键。
 *
 * Returns:
 *   string: 生效的配置值，必定非空（除非默认值本身为空）。
 */
export function getVar(env, key) {
  const raw = env?.[key];
  if (typeof raw !== 'string' || raw.trim() === '') {
    return DEFAULTS[key];
  }
  return raw.trim();
}

/**
 * 读取逗号分隔的列表型配置。
 *
 * Args:
 *   env: Worker 环境变量对象，可为 undefined。
 *   key: 配置项名称，须为 `DEFAULTS` 的键。
 *
 * Returns:
 *   Array<string>: 去空白并剔除空项后的列表，可能为空数组。
 */
export function getList(env, key) {
  return getVar(env, key)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
