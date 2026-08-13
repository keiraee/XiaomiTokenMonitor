const { getUserAgent, ensureAuth, refreshAuth, AuthRequiredError, USAGE_URL } = require('./auth');
const { CookieJar } = require('./cookie-jar');

const REQUEST_TIMEOUT = 30_000;

async function requestUsage(cookies) {
  const jar = new CookieJar();
  jar.setAll(cookies);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(USAGE_URL, {
      signal: controller.signal,
      headers: {
        Cookie: jar.toHeader(),
        'User-Agent': getUserAgent(),
        Accept: '*/*',
        'Accept-Language': 'en',
        'Content-Type': 'application/json',
        Referer: 'https://platform.xiaomimimo.com/console/plan-manage',
        DNT: '1',
        'x-timezone': 'Asia/Shanghai',
      },
    });
    const data = response.ok ? await response.json() : null;
    return { status: response.status, ok: response.ok, data };
  } finally {
    clearTimeout(timeout);
  }
}

function formatUsage(raw) {
  const usage = raw?.data?.usage || raw?.usage || {};
  const items = Array.isArray(usage.items) ? usage.items : [];
  const planTotal = items.find(i => i.name === 'plan_total_token') || items[0] || {};
  const used = Number(planTotal.used || 0);
  const limit = Number(planTotal.limit || 0);
  const remaining = Math.max(limit - used, 0);
  const percent = Number.isFinite(usage.percent) ? usage.percent : (limit ? used / limit : 0);

  return {
    raw,
    summary: {
      used,
      limit,
      remaining,
      percent,
      percentText: `${(percent * 100).toFixed(1)}%`,
      usedCredits: used / 1e8,
      totalCredits: limit / 1e8,
      remainingCredits: remaining / 1e8,
      unit: 'Credits',
    },
    items: items.map(item => ({
      name: item.name,
      used: Number(item.used || 0),
      limit: Number(item.limit || 0),
      remaining: Math.max(Number(item.limit || 0) - Number(item.used || 0), 0),
      usedCredits: Number(item.used || 0) / 1e8,
      limitCredits: Number(item.limit || 0) / 1e8,
    })),
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchUsage({ onRefresh } = {}) {
  let cookies = await ensureAuth();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await requestUsage(cookies);

    if (response.status === 401 && attempt === 0) {
      cookies = await refreshAuth();
      if (typeof onRefresh === 'function') onRefresh(cookies);
      continue;
    }

    if (!response.ok) {
      throw new Error(`API 返回 HTTP ${response.status}`);
    }

    return formatUsage(response.data);
  }

  throw new Error('认证重试次数已用尽');
}

module.exports = {
  fetchUsage,
  formatUsage,
  AuthRequiredError,
};
