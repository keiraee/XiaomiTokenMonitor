const crypto = require('crypto');

const PLATFORM_URL = 'https://platform.xiaomimimo.com';
const SID = 'api-platform';
const DEFAULT_PATH = '/console/plan-manage';

function parseSsoJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

async function getLoginContext(currentPath = DEFAULT_PATH) {
  const resp = await fetch(
    `${PLATFORM_URL}/api/v1/genLoginUrl?${new URLSearchParams({ currentPath })}`,
    { redirect: 'manual', signal: AbortSignal.timeout(15000) },
  );
  const location = resp.headers.get('location');
  if (!location) throw new Error('genLoginUrl 未返回登录地址');

  const url = new URL(location);
  return {
    sid: url.searchParams.get('sid') || SID,
    callback: url.searchParams.get('callback'),
    serviceLoginUrl: location,
    followup: currentPath,
  };
}

function buildSsoJsonUrl(serviceLoginUrl) {
  const url = new URL(serviceLoginUrl);
  url.searchParams.set('_json', 'true');
  url.searchParams.set('_locale', 'zh_CN');
  return url.toString();
}

function ensureDeviceId(jar) {
  if (jar.findValid('deviceId')) return;
  jar.mergeAll([{
    name: 'deviceId',
    value: `wb_${crypto.randomUUID()}`,
    domain: '.account.xiaomi.com',
    path: '/',
    expires: Date.now() / 1000 + 365 * 24 * 3600,
    secure: true,
    sameSite: 'None',
  }]);
}

function applyPollResult(jar, data) {
  const now = Date.now() / 1000 + 30 * 24 * 3600;
  const entries = [
    ['passToken', data.passToken, '.account.xiaomi.com'],
    ['userId', data.userId, '.account.xiaomi.com'],
    ['cUserId', data.cUserId, '.xiaomi.com'],
    ['pass_ua', 'web', '.account.xiaomi.com'],
    ['passInfo', 'login-end', '.account.xiaomi.com'],
  ];
  for (const [name, value, domain] of entries) {
    if (!value) continue;
    jar.mergeAll([{
      name,
      value: String(value),
      domain,
      path: '/',
      expires: name === 'passInfo' ? -1 : now,
    }]);
  }
}

async function followRedirectChain(jar, startUrl, userAgent, maxHops = 15) {
  let url = startUrl;
  let gotServiceToken = false;

  for (let i = 0; i < maxHops; i += 1) {
    const resp = await fetch(url, {
      redirect: 'manual',
      headers: {
        Cookie: jar.toHeader(),
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,application/json,*/*',
      },
      signal: AbortSignal.timeout(15000),
    });

    jar.applyResponse(resp);
    if (jar.isServiceTokenValid()) gotServiceToken = true;

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location');
      if (!location) break;
      url = location.startsWith('http') ? location : new URL(location, url).href;
      continue;
    }
    break;
  }

  return gotServiceToken || jar.isServiceTokenValid();
}

async function refreshServiceToken(jar, userAgent) {
  if (!jar.isPassTokenValid()) {
    throw new Error('passToken 无效');
  }

  const ctx = await getLoginContext();
  const ssoUrl = buildSsoJsonUrl(ctx.serviceLoginUrl);
  const resp = await fetch(ssoUrl, {
    redirect: 'manual',
    headers: { Cookie: jar.toHeader(), 'User-Agent': userAgent },
    signal: AbortSignal.timeout(15000),
  });
  const json = parseSsoJson(await resp.text());
  if (!json) throw new Error('SSO 响应解析失败');
  if (json.code === 70016) throw new Error('passToken 已被服务端拒绝');
  if (json.code !== 0 || !json.location) {
    throw new Error(`SSO 拒绝刷新 (code=${json.code}, ${json.description || ''})`);
  }

  const ok = await followRedirectChain(jar, json.location, userAgent);
  if (!ok && !jar.isServiceTokenValid()) {
    throw new Error('刷新未获得有效 serviceToken');
  }
  return jar.cookies;
}

module.exports = {
  PLATFORM_URL,
  SID,
  DEFAULT_PATH,
  parseSsoJson,
  getLoginContext,
  buildSsoJsonUrl,
  ensureDeviceId,
  applyPollResult,
  followRedirectChain,
  refreshServiceToken,
};
