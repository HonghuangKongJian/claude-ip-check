/* ============================================================
   Claude AI IP 检测 —— 前端逻辑（Cloudflare Workers 版）
   ============================================================ */

'use strict';

/* ---------- 全局状态 ---------- */
const state = {
  ip: '',            // Cloudflare 视角出口 IP
  cnIp: '',          // 国内站点视角出口 IP
  claudeIp: '',      // claude.ai 视角出口 IP
  claudeLoc: '',     // /cdn-cgi/trace 返回的 loc 国家码
  cfGeo: '',
  claudeGeo: null,
  claudeRisk: null,
  mask: false,
  config: { flagCdn: 'https://flagcdn.com/24x18/{cc}.png', dnsTestHosts: [], portalUrl: '' },
};

/* Claude 明确不支持 / 重度风控的地区（与后端 trustscore.js 保持一致） */
const CLAUDE_RESTRICTED_CC = {
  CN: '中国大陆', HK: '中国香港', MO: '中国澳门',
  RU: '俄罗斯', KP: '朝鲜', IR: '伊朗', SY: '叙利亚',
  CU: '古巴', BY: '白俄罗斯', VE: '委内瑞拉',
};

/* ---------- 工具函数 ---------- */

const $ = (id) => document.getElementById(id);

/** 判断是否 IPv6（含冒号即视为 v6）。 */
function isIPv6(ip) {
  return typeof ip === 'string' && ip.indexOf(':') >= 0;
}

/**
 * IP 脱敏显示。
 * IPv4 保留 A.B.*.*，IPv6 保留前两段后整体遮蔽。
 * @param {string} ip 原始 IP
 * @returns {string} 脱敏后的 IP
 */
function maskIP(ip) {
  if (!ip) return ip;
  if (!isIPv6(ip)) {
    const p = ip.split('.');
    if (p.length !== 4) return ip;
    return `${p[0]}.${p[1]}.*.*`;
  }
  const p = ip.split(':');
  return p.slice(0, 2).join(':') + ':****:****:****:****';
}

/** 按掩码开关渲染 IP。 */
function displayIP(ip) {
  return state.mask ? maskIP(ip) : ip;
}

/**
 * 生成国旗 <img>。
 * @param {string} cc 两位国家码
 * @returns {string} HTML 片段
 */
function flagImg(cc) {
  if (!cc) return '';
  const low = String(cc).toLowerCase();
  const src = state.config.flagCdn.replace('{cc}', low);
  const alt = low === 'tw' ? '中国台湾省' : low === 'hk' ? '中国香港' : low === 'mo' ? '中国澳门' : low;
  return `<img class="flag" src="${src}" alt="${alt}" loading="lazy" onerror="this.style.display='none'">`;
}

/** 可点击复制的 IP 片段。 */
function linkIP(ip) {
  return `<span class="ip-copy" title="点击复制" style="cursor:pointer" data-ip="${ip}">${displayIP(ip)}</span>`;
}

/** 三态布尔标签。 */
function boolTag(val, trueText, falseText) {
  if (val === true) return `<span class="tag tag-danger">${trueText || '是'}</span>`;
  if (val === false) return `<span class="tag tag-safe">${falseText || '否'}</span>`;
  return `<span class="tag tag-neutral">未知</span>`;
}

/** 评分档位文案。 */
function scoreLabel(s) {
  if (s >= 95) return { text: '极度纯净', cls: 'tag-safe' };
  if (s >= 80) return { text: '纯净', cls: 'tag-safe' };
  if (s >= 50) return { text: '良好', cls: 'tag-info' };
  if (s >= 25) return { text: '中性', cls: 'tag-warn' };
  return { text: '可疑', cls: 'tag-danger' };
}

/** 受限地区名称，非受限返回 null。 */
function getRestrictedName() {
  const cc = ((state.claudeRisk && state.claudeRisk.countryCode) || '').toUpperCase();
  return cc ? CLAUDE_RESTRICTED_CC[cc] || null : null;
}

/** 点击复制 IP（事件委托）。 */
document.addEventListener('click', (e) => {
  const el = e.target.closest && e.target.closest('.ip-copy');
  if (!el) return;
  const ip = el.getAttribute('data-ip');
  if (ip && navigator.clipboard) navigator.clipboard.writeText(ip).catch(() => {});
});

/* ---------- 主题切换 ---------- */
(function initTheme() {
  const btn = $('ts-btn');
  const menu = $('ts-menu');
  if (!btn || !menu) return;

  const readCookie = () => {
    const m = document.cookie.match(/(?:^|; )cic_theme=([^;]*)/);
    return m ? decodeURIComponent(m[1]) : null;
  };
  const writeCookie = (v) => {
    document.cookie = `cic_theme=${encodeURIComponent(v)}; path=/; max-age=31536000; samesite=lax`;
  };
  const clearCookie = () => {
    document.cookie = 'cic_theme=; path=/; max-age=0';
  };
  const current = () => readCookie() || localStorage.getItem('theme') || 'auto';

  function paint() {
    const c = current();
    btn.querySelectorAll('[data-mode-icon]').forEach((el) => {
      el.style.display = el.getAttribute('data-mode-icon') === c ? 'block' : 'none';
    });
    menu.querySelectorAll('.ts-item').forEach((it) => {
      if (it.getAttribute('data-mode') === c) it.setAttribute('aria-current', 'true');
      else it.removeAttribute('aria-current');
    });
  }

  function setMode(m) {
    if (m === 'auto') {
      localStorage.removeItem('theme');
      clearCookie();
      document.documentElement.removeAttribute('data-theme');
    } else {
      localStorage.setItem('theme', m);
      writeCookie(m);
      document.documentElement.setAttribute('data-theme', m);
    }
    paint();
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
  });
  menu.querySelectorAll('.ts-item').forEach((it) => {
    it.addEventListener('click', () => {
      setMode(it.getAttribute('data-mode'));
      menu.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    });
  });
  document.addEventListener('click', (e) => {
    if (menu.classList.contains('open') && !(e.target.closest && e.target.closest('#ts-wrap'))) {
      menu.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }
  });
  paint();
})();

/* ---------- 隐藏 IP 开关 ---------- */
(function initMask() {
  const toggle = $('ipMaskToggle');
  if (!toggle) return;
  const saved = localStorage.getItem('ip_mask');
  if (saved === '1') {
    toggle.checked = true;
    state.mask = true;
  }
  toggle.addEventListener('change', () => {
    state.mask = toggle.checked;
    localStorage.setItem('ip_mask', state.mask ? '1' : '0');
    render();
    renderDeviceInfo();
  });
})();

/**
 * 应用门户链接配置。
 *
 * HTML 中已硬编码默认地址（保证 JS 加载失败时按钮依然可用），此处用
 * 后端 PORTAL_URL 覆盖；配置为空则隐藏按钮。
 *
 * @returns {void}
 */
function applyPortalConfig() {
  const url = state.config.portalUrl;
  const nav = $('portalLink');
  const foot = $('portalLinkFooter');
  if (!url) {
    if (nav) nav.classList.add('hidden');
    if (foot) foot.style.display = 'none';
    return;
  }
  if (nav) {
    nav.href = url;
    nav.classList.remove('hidden');
  }
  if (foot) {
    foot.href = url;
    foot.style.display = '';
  }
}

/* ---------- 出口 IP 采集 ---------- */

/**
 * 通过 Cloudflare trace 获取出口 IP。
 * @returns {Promise<string>} IP 或空串
 */
async function fetchCfIP() {
  try {
    const r = await fetch('https://1.1.1.1/cdn-cgi/trace', { signal: AbortSignal.timeout(5000) });
    const txt = await r.text();
    const m = txt.match(/ip=([^\n]+)/);
    if (m) return m[1].trim();
  } catch { /* 忽略 */ }
  return '';
}

/**
 * 通过 claude.ai trace 获取 Claude 视角出口 IP。
 * @returns {Promise<{ip: string, loc: string} | null>}
 */
async function fetchClaudeIP() {
  try {
    const r = await fetch('https://claude.ai/cdn-cgi/trace', {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const text = await r.text();
    const entries = Object.fromEntries(text.trim().split('\n').map((l) => l.split('=')));
    return { ip: entries.ip || '', loc: (entries.loc || '').toLowerCase() };
  } catch {
    return null;
  }
}

/**
 * 通过国内站点获取出口 IP（受 CORS 限制，失败返回 null 属正常）。
 * @returns {Promise<{ip: string, source: string} | null>}
 */
async function fetchCNIP() {
  const sources = [
    { url: 'https://my.ip.cn/', name: 'IP.cn' },
    { url: 'https://2026.ip138.com/', name: 'iP138' },
  ];
  for (const s of sources) {
    try {
      const r = await fetch(s.url, { signal: AbortSignal.timeout(5000) });
      const html = await r.text();
      const m = html.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
      if (m) return { ip: m[1], source: s.name };
    } catch { /* 换下一个源 */ }
  }
  return null;
}

/**
 * 拉取 IP 归属。
 * @param {string} ip 目标 IP
 * @returns {Promise<object|null>}
 */
async function getGeo(ip) {
  try {
    const r = await fetch(`/api/geoip/${encodeURIComponent(ip)}`, { signal: AbortSignal.timeout(6000) });
    if (r.ok) return await r.json();
  } catch { /* 忽略 */ }
  return null;
}

/** 显示 IPv6 提示条。 */
function showIPv6Warning() {
  const el = $('ipv6Warn');
  if (el) el.classList.add('show');
}

/**
 * 渲染单个出口 IP 卡片。
 * @param {string} addrId 地址元素 id
 * @param {string} geoId 归属元素 id
 * @param {string} ip IP
 * @param {string} locHint 国家码提示
 * @returns {Promise<void>}
 */
async function renderIPCard(addrId, geoId, ip, locHint) {
  const addrEl = $(addrId);
  const geoEl = $(geoId);
  if (!ip) {
    addrEl.textContent = '获取失败';
    geoEl.textContent = '';
    return;
  }
  if (isIPv6(ip)) showIPv6Warning();
  addrEl.innerHTML = `${flagImg(locHint || '')} ${linkIP(ip)}`;

  const g = await getGeo(ip);
  if (g && g.country) {
    const geo = [g.country_zh || g.country, g.region, g.city, g.isp].filter(Boolean).join(' ');
    const cc = (g.country_code || locHint || '').toLowerCase();
    addrEl.innerHTML = `${flagImg(cc)} ${linkIP(ip)}`;
    geoEl.textContent = geo;
    return g;
  }
  geoEl.textContent = locHint ? locHint.toUpperCase() : '';
  return null;
}

/* ---------- 主渲染 ---------- */

function render() {
  const cr = state.claudeRisk || {};
  const cg = state.claudeGeo || {};

  /* —— 信任评分 —— */
  const hasClaudeIp = !!state.claudeIp;
  const restrictedName = getRestrictedName();
  let trustScore = null;
  let restrictedText = null;

  if (!hasClaudeIp) {
    trustScore = null;
  } else if (restrictedName) {
    trustScore = 0;
    restrictedText = '处于不可访问区域，Claude 会严格风控';
  } else {
    trustScore = typeof cr.trust_score === 'number' ? cr.trust_score : null;
  }

  const pointer = $('gaugePointer');
  if (trustScore === null) {
    $('gaugeScore').innerHTML =
      '<span style="color:#9ca3af">—</span> <span class="tag tag-neutral" style="font-size:0.4em;vertical-align:middle">无数据</span>';
    pointer.style.left = '0%';
    pointer.style.opacity = '0.3';
    $('gaugeText').textContent = hasClaudeIp
      ? '该 IP 暂无评分数据'
      : '未获取到 Claude AI 出口 IP，无法评分';
  } else {
    const sl = restrictedName ? { text: '不可访问', cls: 'tag-danger' } : scoreLabel(trustScore);
    const color =
      trustScore >= 95 ? '#22c55e' : trustScore >= 80 ? '#16a34a'
        : trustScore >= 50 ? '#84cc16' : trustScore >= 25 ? '#eab308' : '#ef4444';
    $('gaugeScore').innerHTML =
      `<span style="color:${color}">${trustScore}</span> <span class="tag ${sl.cls}" style="font-size:0.4em;vertical-align:middle">${sl.text}</span>`;
    pointer.style.left = Math.min(trustScore, 100) + '%';
    pointer.style.opacity = '1';
    $('gaugeText').textContent =
      restrictedText ||
      (trustScore >= 95 ? '该IP信誉极好' : trustScore >= 80 ? '该 IP 信誉优异'
        : trustScore >= 50 ? '该 IP 存在轻微风险' : trustScore >= 25 ? '该 IP 存在一定风险' : '该 IP 风险极高');
  }

  /* —— 受限地区横幅 —— */
  const warn = $('regionWarn');
  if (restrictedName) {
    warn.innerHTML =
      '<span>⚠️</span> 当前 Claude 出口 IP 位于<strong>' +
      restrictedName + '</strong>，不建议尝试登录 Claude，容易触发封号风控！';
    warn.style.display = 'block';
  } else {
    warn.style.display = 'none';
  }

  /* —— Claude 支持地区行 —— */
  const row = $('claudeRegionSupportRow');
  const val = $('claudeRegionSupport');
  if (restrictedName) {
    row.style.display = 'none';
  } else {
    if (!hasClaudeIp || !cr.countryCode) val.innerHTML = '<span class="tag tag-neutral">未知</span>';
    else val.innerHTML = '<span class="tag tag-safe">正常</span>';
    row.style.display = '';
  }

  /* —— 扣分因子 —— */
  const fr = $('scoreFactorsRow');
  if (Array.isArray(cr.reasons) && cr.reasons.length) {
    $('scoreFactors').textContent = cr.reasons.join('、');
    fr.style.display = '';
  } else {
    fr.style.display = 'none';
  }

  /* —— IP 属性 —— */
  const isResidential = cr.isResidential;
  let propTag = '<span class="tag tag-neutral">未知</span>';
  if (isResidential === true) propTag = '<span class="tag tag-safe">家庭住宅IP</span>';
  else if (isResidential === false) propTag = '<span class="tag tag-warn">机房IP</span>';
  if (cr.company_type) {
    const typeMap = { hosting: 'Hosting', isp: 'ISP', business: 'Business', education: 'Education' };
    propTag += ` <span style="color:var(--text-muted);font-size:0.82em">(${typeMap[cr.company_type] || cr.company_type})</span>`;
  }

  $('propsContent').innerHTML = `
    <div class="risk-row"><span class="risk-label">地区</span><span class="risk-value">${cr.country_zh || cr.country || cg.country_zh || cg.country || '未知'}</span></div>
    <div class="risk-row"><span class="risk-label">城市</span><span class="risk-value">${cr.city || cg.city || '未知'}</span></div>
    <div class="risk-row"><span class="risk-label">IP 属性</span><span class="risk-value">${propTag}</span></div>
    <div class="risk-row"><span class="risk-label">ASN</span><span class="risk-value">${cr.asn ? 'AS' + cr.asn : '未知'}</span></div>
    <div class="risk-row"><span class="risk-label">运营商</span><span class="risk-value" style="font-size:0.85em">${cr.asOrganization || '未知'}</span></div>
    <div class="risk-row"><span class="risk-label">时区</span><span class="risk-value" style="font-size:0.85em">${cr.timezone || '未知'}</span></div>
  `;

  /* —— 安全检测 —— */
  $('securityContent').innerHTML = `
    <div class="risk-row"><span class="risk-label">VPN</span><span class="risk-value">${boolTag(cr.is_vpn, 'VPN', '未检测到')}</span></div>
    <div class="risk-row"><span class="risk-label">代理 (Proxy)</span><span class="risk-value">${boolTag(cr.is_proxy, '代理', '未检测到')}</span></div>
    <div class="risk-row"><span class="risk-label">Tor</span><span class="risk-value">${boolTag(cr.is_tor, 'Tor', '未检测到')}</span></div>
    <div class="risk-row"><span class="risk-label">机器人 (Crawler)</span><span class="risk-value">${boolTag(cr.is_crawler, '是', '否')}</span></div>
    <div class="risk-row"><span class="risk-label">滥用记录</span><span class="risk-value">${boolTag(cr.is_abuser, '有记录', '无记录')}</span></div>
    <div class="risk-row"><span class="risk-label">机房 / 数据中心</span><span class="risk-value">${boolTag(cr.is_datacenter, '机房IP', '非机房')}</span></div>
  `;
}

/* ---------- Claude 可用性检测 ---------- */

async function detectClaudeAvail() {
  const el = $('claudeAvailContent');
  el.innerHTML = `
    <div class="risk-row"><span class="risk-label">claude.ai</span><div class="loading-bar" style="width:80px"></div></div>
    <div class="risk-row"><span class="risk-label">anthropic.com</span><div class="loading-bar" style="width:80px"></div></div>`;

  const targets = [
    { name: 'claude.ai', url: 'https://claude.ai/cdn-cgi/trace' },
    { name: 'anthropic.com', url: 'https://www.anthropic.com/cdn-cgi/trace' },
  ];

  const results = await Promise.all(
    targets.map(async (t) => {
      const start = performance.now();
      try {
        await fetch(t.url, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(6000) });
        return { name: t.name, ms: Math.round(performance.now() - start), ok: true };
      } catch {
        return { name: t.name, ms: -1, ok: false };
      }
    })
  );

  const restricted = getRestrictedName();
  let rows = '';
  results.forEach((d) => {
    if (restricted) {
      rows += `<div class="risk-row"><span class="risk-label">${d.name}</span><span class="risk-value"><span class="tag tag-danger">不可访问</span></span></div>`;
    } else if (d.ok) {
      const cls = d.ms < 250 ? 'tag-safe-dark' : d.ms < 500 ? 'tag-safe' : 'tag-warn';
      const label = d.ms < 250 ? '正常' : d.ms < 500 ? '良好' : '较慢';
      rows += `<div class="risk-row"><span class="risk-label">${d.name}</span><span class="risk-value"><span class="tag ${cls}">${label}</span> <span style="color:var(--text-muted);font-size:0.85em">${d.ms}ms</span></span></div>`;
    } else {
      rows += `<div class="risk-row"><span class="risk-label">${d.name}</span><span class="risk-value"><span class="tag tag-danger">不可访问</span></span></div>`;
    }
  });
  el.innerHTML = rows;
}

/* ---------- DNS 出口一致性检测 ---------- */
/*
 * 实现说明：
 * 解析器级的 DNS 泄露检测需要在自建权威 NS 上记录「是哪个递归解析器来查过」，
 * Workers 无法做到。本版改为「出口一致性」探测：让浏览器分别请求
 * 中性域名（当前域名 / 配置的探测域名）与 claude.ai，比较两端看到的出口 IP。
 * 若不一致，说明分流规则或 DNS 出口配置存在问题（即事实上的泄露）。
 */
async function detectDNSLeak() {
  const el = $('dnsLeakContent');
  el.innerHTML = `
    <div class="risk-row"><span class="risk-label">状态</span><div class="loading-bar" style="width:80px"></div></div>
    <div class="risk-row"><span class="risk-label">DNS 出口 IP</span><div class="loading-bar" style="width:140px"></div></div>`;

  const hosts = state.config.dnsTestHosts && state.config.dnsTestHosts.length
    ? state.config.dnsTestHosts
    : [location.host];

  const probes = await Promise.all(
    hosts.slice(0, 4).map(async (h) => {
      const scheme = h.startsWith('http') ? '' : 'https://';
      try {
        const r = await fetch(`${scheme}${h}/api/echo?_=${Date.now()}`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(6000),
        });
        if (!r.ok) return null;
        return await r.json();
      } catch {
        return null;
      }
    })
  );

  const reached = probes.filter((p) => p && p.ip);
  if (!reached.length) {
    el.innerHTML = `
      <div class="risk-row"><span class="risk-label">状态</span><span class="risk-value"><span class="tag tag-neutral">无法检测</span></span></div>
      <div class="risk-row"><span class="risk-label">说明</span><span class="risk-value" style="font-size:0.82em;font-weight:400;color:var(--text-muted)">探测域名不可达，请检查 DNS_TEST_HOSTS 配置</span></div>`;
    return;
  }

  const claudeIp = state.claudeIp || '';
  const mismatch = claudeIp ? reached.find((p) => p.ip !== claudeIp) : null;
  const show = mismatch || reached[0];
  const isLeaked = !!mismatch;

  const g = await getGeo(show.ip).catch(() => null);
  let rows = `<div class="risk-row"><span class="risk-label">状态</span><span class="risk-value">${
    isLeaked
      ? '<span class="tag tag-warn">出口不一致</span>'
      : '<span class="tag tag-safe">未检测到泄露</span>'
  }</span></div>`;
  rows += `<div class="risk-row"><span class="risk-label">DNS 出口</span><span class="risk-value" style="font-size:0.85em">${flagImg(g && g.country_code)} ${linkIP(show.ip)} ${isLeaked ? '<span class="tag tag-warn" style="font-size:0.8em">异常</span>' : ''}</span></div>`;
  if (g && g.isp) {
    rows += `<div class="risk-row"><span class="risk-label">服务商</span><span class="risk-value" style="font-size:0.82em;font-weight:400;color:var(--text-muted)">${g.isp}</span></div>`;
  }
  if (!claudeIp) {
    rows += `<div class="risk-row"><span class="risk-label">说明</span><span class="risk-value" style="font-size:0.82em;font-weight:400;color:var(--text-muted)">未取得 Claude 出口 IP，仅展示探测结果</span></div>`;
  }
  el.innerHTML = rows;
}

/* ---------- WebRTC UDP 泄露检测 ---------- */

async function detectWebRTCLeak() {
  const el = $('udpLeakContent');
  el.innerHTML = `
    <div class="risk-row"><span class="risk-label">状态</span><div class="loading-bar" style="width:80px"></div></div>
    <div class="risk-row"><span class="risk-label">UDP 出口 IP</span><div class="loading-bar" style="width:140px"></div></div>`;

  const udpIPs = new Set();
  try {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
      ],
    });
    pc.createDataChannel('');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await new Promise((resolve) => {
      const timer = setTimeout(() => { pc.close(); resolve(); }, 5000);
      pc.onicecandidate = (e) => {
        if (!e.candidate) { clearTimeout(timer); pc.close(); resolve(); return; }
        const m = e.candidate.candidate.match(/([0-9]{1,3}\.){3}[0-9]{1,3}/);
        if (m) udpIPs.add(m[0]);
        const m6 = e.candidate.candidate.match(/([a-f0-9]{1,4}:){2,7}[a-f0-9]{1,4}/i);
        if (m6) udpIPs.add(m6[0]);
      };
    });
  } catch { /* WebRTC 不可用 */ }

  const allUdp = [...udpIPs];
  const isPrivate = (ip) =>
    ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.') ||
    ip.startsWith('198.18.') || ip.startsWith('198.19.') || ip.startsWith('100.64.') ||
    ip.startsWith('127.') || ip.startsWith('0.');
  const publicUdp = allUdp.filter((ip) => !isIPv6(ip) && !isPrivate(ip));

  if (publicUdp.length === 0) {
    el.innerHTML = `
      <div class="risk-row"><span class="risk-label">状态</span><span class="risk-value"><span class="tag tag-safe">${allUdp.length ? '未检测到泄露' : 'WebRTC 已禁用或无泄露'}</span></span></div>`;
    return;
  }

  const claudeIp = state.claudeIp || '';
  const leakIP = claudeIp ? publicUdp.find((ip) => ip !== claudeIp) : undefined;
  const showIP = leakIP || publicUdp.find((ip) => ip === claudeIp) || publicUdp[0];
  const isLeaked = !!leakIP;

  const g = await getGeo(showIP).catch(() => null);
  let rows = `<div class="risk-row"><span class="risk-label">状态</span><span class="risk-value">${
    isLeaked ? '<span class="tag tag-warn">可能泄露</span>' : '<span class="tag tag-safe">未检测到泄露</span>'
  }</span></div>`;
  rows += `<div class="risk-row"><span class="risk-label">UDP 出口</span><span class="risk-value" style="font-size:0.85em">${flagImg(g && g.country_code)} ${linkIP(showIP)} ${isLeaked ? '<span class="tag tag-warn" style="font-size:0.8em">异常</span>' : ''}</span></div>`;
  if (g && g.country) {
    rows += `<div class="risk-row"><span class="risk-label">归属地</span><span class="risk-value" style="font-size:0.82em;font-weight:400;color:var(--text-muted)">${g.country_zh || g.country}</span></div>`;
  }
  el.innerHTML = rows;
}

/* ---------- 设备信息 ---------- */

function renderDeviceInfo() {
  const localTz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || '未知';
  const localOffset = -(new Date().getTimezoneOffset() / 60);
  const localUtc = 'UTC' + (localOffset >= 0 ? '+' : '') + localOffset;

  /** 计算指定 IANA 时区当前的 UTC 偏移（分钟），考虑夏令时。 */
  function currentOffsetMinutes(tz) {
    if (!tz) return null;
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
        .formatToParts(new Date());
      const p = parts.find((x) => x.type === 'timeZoneName');
      if (!p) return null;
      if (p.value === 'GMT' || p.value === 'UTC') return 0;
      const m = p.value.match(/GMT([+-])(\d{1,2}):?(\d{0,2})/);
      if (!m) return null;
      const sign = m[1] === '+' ? 1 : -1;
      return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3] || '0', 10));
    } catch {
      return null;
    }
  }

  function fmtOffset(mins) {
    if (mins == null) return '';
    const sign = mins >= 0 ? '+' : '-';
    const abs = Math.abs(mins);
    return 'UTC' + sign + Math.floor(abs / 60) + (abs % 60 ? ':' + String(abs % 60).padStart(2, '0') : '');
  }

  const CC_TO_TZ = {
    CN: 'Asia/Shanghai', TW: 'Asia/Taipei', HK: 'Asia/Hong_Kong', MO: 'Asia/Macau',
    JP: 'Asia/Tokyo', KR: 'Asia/Seoul', SG: 'Asia/Singapore', MY: 'Asia/Kuala_Lumpur',
    TH: 'Asia/Bangkok', VN: 'Asia/Ho_Chi_Minh', ID: 'Asia/Jakarta', PH: 'Asia/Manila',
    IN: 'Asia/Kolkata', PK: 'Asia/Karachi', BD: 'Asia/Dhaka',
    IR: 'Asia/Tehran', IL: 'Asia/Jerusalem', AE: 'Asia/Dubai', SA: 'Asia/Riyadh',
    TR: 'Europe/Istanbul', RU: 'Europe/Moscow', UA: 'Europe/Kyiv',
    GB: 'Europe/London', IE: 'Europe/Dublin', FR: 'Europe/Paris', DE: 'Europe/Berlin',
    IT: 'Europe/Rome', ES: 'Europe/Madrid', PT: 'Europe/Lisbon', NL: 'Europe/Amsterdam',
    BE: 'Europe/Brussels', CH: 'Europe/Zurich', AT: 'Europe/Vienna',
    SE: 'Europe/Stockholm', NO: 'Europe/Oslo', DK: 'Europe/Copenhagen', FI: 'Europe/Helsinki',
    PL: 'Europe/Warsaw', CZ: 'Europe/Prague', GR: 'Europe/Athens', RO: 'Europe/Bucharest',
    US: 'America/Los_Angeles', CA: 'America/Toronto', MX: 'America/Mexico_City',
    BR: 'America/Sao_Paulo', AR: 'America/Argentina/Buenos_Aires', CL: 'America/Santiago',
    AU: 'Australia/Sydney', NZ: 'Pacific/Auckland',
    ZA: 'Africa/Johannesburg', EG: 'Africa/Cairo', NG: 'Africa/Lagos', KE: 'Africa/Nairobi',
  };

  const cr = state.claudeRisk || {};
  const cc = (cr.countryCode || '').toUpperCase();
  const claudeTz = cr.timezone || CC_TO_TZ[cc] || '';
  const tzIsExact = !!cr.timezone;
  const claudeOffMin = currentOffsetMinutes(claudeTz);
  const localOffMin = -new Date().getTimezoneOffset();

  const localIsCN = localTz === 'Asia/Shanghai' || localTz === 'Asia/Urumqi';
  let tzHtml;
  if (claudeTz && claudeOffMin != null) {
    const diff = Math.abs(claudeOffMin - localOffMin);
    const match = diff <= 60;
    const diffH = Math.round((claudeOffMin - localOffMin) / 60);
    const diffLabel = (claudeOffMin - localOffMin) === 0
      ? '偏移一致'
      : diffH === 0 ? '偏移略有差异' : diffH > 0 ? `Claude 快 ${diffH} 小时` : `Claude 慢 ${-diffH} 小时`;
    const label = tzIsExact ? claudeTz : `${claudeTz}（按地区估算）`;
    if (localIsCN) {
      tzHtml = `<span class="tag tag-warn">不推荐使用中国大陆时区</span><br>
        <span style="font-size:0.85em">本地: ${localTz} (${localUtc})<br>Claude出口: ${label} (${fmtOffset(claudeOffMin)}) — ${diffLabel}</span>`;
    } else if (match) {
      tzHtml = `<span class="tag tag-safe">时区一致</span> ${localTz} (${localUtc})`;
    } else {
      tzHtml = `<span class="tag tag-warn">时区不一致</span><br>
        <span style="font-size:0.85em">本地: ${localTz} (${localUtc})<br>Claude出口: ${label} (${fmtOffset(claudeOffMin)}) — ${diffLabel}</span>`;
    }
  } else {
    tzHtml = localIsCN
      ? `<span class="tag tag-warn">不推荐使用中国大陆时区</span> ${localTz} (${localUtc})`
      : `${localTz} (${localUtc})`;
  }

  /* 语言一致性 */
  const localLangs = navigator.languages || [navigator.language];
  const langsStr = localLangs.join(', ') || '未知';
  const primary = (localLangs[0] || '').split('-')[0].toLowerCase();
  const LANG_MAP = {
    CN: ['zh'], TW: ['zh'], HK: ['zh', 'en'], MO: ['zh', 'en'],
    JP: ['ja'], KR: ['ko'], TH: ['th'], VN: ['vi'],
    SG: ['en', 'zh', 'ms', 'ta'], MY: ['ms', 'en', 'zh', 'ta'],
    ID: ['id', 'en'], PH: ['en', 'tl', 'fil'], IN: ['en', 'hi'],
    US: ['en'], GB: ['en'], AU: ['en'], NZ: ['en', 'mi'], CA: ['en', 'fr'],
    DE: ['de'], AT: ['de'], CH: ['de', 'fr', 'it'], FR: ['fr'], IT: ['it'],
    ES: ['es', 'ca'], PT: ['pt'], NL: ['nl'], SE: ['sv'], NO: ['no'],
    DK: ['da'], FI: ['fi'], PL: ['pl'], CZ: ['cs'], RU: ['ru'],
    TR: ['tr'], IL: ['he', 'ar', 'en'], SA: ['ar'], AE: ['ar', 'en'],
    BR: ['pt'], AR: ['es'], MX: ['es'], ZA: ['en'],
  };
  const regionLangs = LANG_MAP[cc] || [];
  let langHtml = langsStr;
  if (primary && regionLangs.length) {
    if (regionLangs.includes(primary)) {
      langHtml = `<span class="tag tag-safe">语言一致</span> ${langsStr}`;
    } else {
      langHtml = `<span class="tag tag-warn">语言不一致</span><br>
        <span style="font-size:0.85em">本地: ${langsStr}<br>Claude出口所在地常用: ${regionLangs.join(' / ')}</span>`;
    }
  }

  /* UA 解析 */
  const ua = navigator.userAgent;
  let os = '未知', browser = '未知';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('Linux')) os = 'Linux';
  let m;
  if ((m = ua.match(/Edg\/([\d.]+)/))) browser = 'Edge ' + m[1];
  else if ((m = ua.match(/Chrome\/([\d.]+)/))) browser = 'Chrome ' + m[1];
  else if ((m = ua.match(/Firefox\/([\d.]+)/))) browser = 'Firefox ' + m[1];
  else if (!ua.includes('Chrome') && (m = ua.match(/Version\/([\d.]+)/))) browser = 'Safari ' + m[1];

  const isTouch = navigator.maxTouchPoints > 0;
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const netType = conn ? (conn.effectiveType || conn.type || '未知') : '不支持检测';
  const dnt = navigator.doNotTrack === '1' ? '已开启'
    : navigator.doNotTrack === '0' ? '已关闭' : '未设置';

  /* WebGL */
  let webglRenderer = '不支持';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) webglRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    }
  } catch { /* 忽略 */ }

  /* Canvas 指纹（FNV-1a 32 位哈希） */
  let canvasHash = '不支持';
  try {
    const c = document.createElement('canvas');
    c.width = 240; c.height = 60;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = '14px "Arial"';
      ctx.fillStyle = '#f60';
      ctx.fillRect(0, 0, 100, 30);
      ctx.fillStyle = '#069';
      ctx.fillText('Claude IP Check 🌐', 4, 20);
      ctx.strokeStyle = 'rgba(102,204,0,0.7)';
      ctx.strokeRect(60, 10, 80, 30);
      const data = c.toDataURL();
      let h = 0x811c9dc5;
      for (let i = 0; i < data.length; i++) {
        h ^= data.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      }
      canvasHash = h.toString(16).padStart(8, '0');
    }
  } catch { /* 忽略 */ }

  $('deviceContent').innerHTML = `
    <div class="risk-row"><span class="risk-label">时区</span><span class="risk-value" style="text-align:right">${tzHtml}</span></div>
    <div class="risk-row"><span class="risk-label">语言</span><span class="risk-value" style="text-align:right">${langHtml}</span></div>
    <div class="risk-row"><span class="risk-label">操作系统 / 浏览器</span><span class="risk-value">${os} / ${browser}</span></div>
    <div class="risk-row"><span class="risk-label">触屏</span><span class="risk-value">${isTouch ? '支持' : '不支持'}</span></div>
    <div class="risk-row"><span class="risk-label">网络类型</span><span class="risk-value">${netType}</span></div>
    <div class="risk-row"><span class="risk-label">Do Not Track</span><span class="risk-value">${dnt}</span></div>
    <div class="risk-row"><span class="risk-label">WebGL 渲染器</span><span class="risk-value" style="font-size:0.82em">${webglRenderer}</span></div>
    <div class="risk-row"><span class="risk-label">Canvas 指纹</span><span class="risk-value" style="font-family:ui-monospace,monospace">${canvasHash}</span></div>
  `;
}

/* ---------- IP 历史（localStorage） ---------- */

const HIST_KEY = 'claude_ip_history';
const HIST_MAX = 6;

function getHistory() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch { return []; }
}

function saveAndRenderHistory() {
  const ip = state.claudeIp;
  if (ip) {
    const history = getHistory();
    const now = new Date();
    const entry = {
      ip,
      cc: ((state.claudeRisk && state.claudeRisk.countryCode) || '').toLowerCase(),
      geo: (state.claudeRisk && (state.claudeRisk.city || state.claudeRisk.country_zh || state.claudeRisk.country)) || '',
      time: now.toISOString(),
    };
    const last = history[0];
    const hoursSince = last ? (now - new Date(last.time)) / 3600000 : Infinity;
    if (!last || last.ip !== ip || hoursSince >= 1) {
      history.unshift(entry);
      localStorage.setItem(HIST_KEY, JSON.stringify(history.slice(0, HIST_MAX)));
    }
  }
  renderHistory();
}

function renderHistory() {
  const el = $('ipHistoryContent');
  const history = getHistory();
  if (!history.length) {
    el.textContent = '暂无记录';
    return;
  }
  el.innerHTML = history
    .map((h) => {
      const d = new Date(h.time);
      const t = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return `<div class="history-item">
        <span class="history-time">${t}</span>
        ${flagImg(h.cc)}
        <span style="font-family:ui-monospace,monospace">${displayIP(h.ip)}</span>
        <span style="color:var(--text-muted);font-size:0.9em">${h.geo || ''}</span>
      </div>`;
    })
    .join('');
}

/* ---------- 启动 ---------- */

async function boot() {
  /* 读取前端配置 */
  try {
    const r = await fetch('/api/config', { signal: AbortSignal.timeout(4000) });
    if (r.ok) state.config = Object.assign(state.config, await r.json());
  } catch { /* 使用默认配置 */ }
  applyPortalConfig();

  const [cfIp, claude, cn] = await Promise.all([
    fetchCfIP(),
    fetchClaudeIP(),
    fetchCNIP(),
  ]);

  state.ip = cfIp || '';
  state.claudeIp = (claude && claude.ip) || '';
  state.claudeLoc = (claude && claude.loc) || '';
  state.cnIp = (cn && cn.ip) || '';

  /* Cloudflare 出口卡片 */
  const cfTask = (async () => {
    if (!state.ip) {
      $('ipAddr').textContent = '获取失败';
      $('ipGeo').textContent = '';
      return;
    }
    $('ipAddr').innerHTML = linkIP(state.ip);
    const g = await getGeo(state.ip);
    if (g && g.country) {
      state.cfGeo = [g.country_zh || g.country, g.region, g.city, g.isp].filter(Boolean).join(' ');
      $('ipAddr').innerHTML = `${flagImg(g.country_code)} ${linkIP(state.ip)}`;
      $('ipGeo').textContent = state.cfGeo;
    }
  })();

  /* Claude 出口卡片 + 风险数据 */
  const claudeTask = (async () => {
    if (!state.claudeIp) {
      $('ipAddrClaude').textContent = '获取失败';
      $('ipGeoClaude').textContent = '';
      return;
    }
    if (isIPv6(state.claudeIp)) showIPv6Warning();
    $('ipHeroClaude').classList.add('primary');
    $('ipAddrClaude').innerHTML = `${flagImg(state.claudeLoc)} ${linkIP(state.claudeIp)}`;

    const [riskRes, geo] = await Promise.all([
      fetch(`/api/iprisk/${encodeURIComponent(state.claudeIp)}`, { signal: AbortSignal.timeout(10000) })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      getGeo(state.claudeIp),
    ]);

    if (geo && geo.country) {
      state.claudeGeo = geo;
      $('ipAddrClaude').innerHTML = `${flagImg(geo.country_code || state.claudeLoc)} ${linkIP(state.claudeIp)}`;
      $('ipGeoClaude').textContent = [geo.country_zh || geo.country, geo.region, geo.city, geo.isp].filter(Boolean).join(' ');
    } else if (state.claudeLoc) {
      $('ipGeoClaude').textContent = state.claudeLoc.toUpperCase();
    }
    if (riskRes) state.claudeRisk = riskRes;
  })();

  await Promise.all([renderIPCard('ipAddrCN', 'ipGeoCN', state.cnIp, 'cn'), cfTask, claudeTask]);

  render();
  renderDeviceInfo();
  saveAndRenderHistory();
  Promise.all([detectClaudeAvail(), detectDNSLeak(), detectWebRTCLeak()]);
}

/* 绑定刷新按钮 */
window.addEventListener('DOMContentLoaded', () => {
  const bind = (id, fn) => {
    const el = $(id);
    if (el) el.addEventListener('click', fn);
  };
  bind('availRefresh', detectClaudeAvail);
  bind('dnsRefresh', detectDNSLeak);
  bind('udpRefresh', detectWebRTCLeak);
  bind('historyClear', () => {
    localStorage.removeItem(HIST_KEY);
    renderHistory();
  });
  boot();
});
