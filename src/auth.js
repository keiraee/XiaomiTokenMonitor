const fs = require('fs');
const {
  CookieJar,
  SERVICE_TOKEN_NAME,
} = require('./cookie-jar');
const {
  getLoginContext,
  buildSsoJsonUrl,
  parseSsoJson,
  refreshServiceToken,
} = require('./sso');
const { META_FILE } = require('./config');

const PLATFORM_URL = 'https://platform.xiaomimimo.com';
const USAGE_URL = `${PLATFORM_URL}/api/v1/tokenPlan/usage`;
const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
];

let authInFlight = null;
let jar = CookieJar.load();

class AuthRequiredError extends Error {
  constructor(message = '需要登录') {
    super(message);
    this.name = 'AuthRequiredError';
    this.code = 'AUTH_REQUIRED';
  }
}

function getRandomUA() {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}

function loadMeta() {
  const file = META_FILE();
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function getUserAgent() {
  return loadMeta()?.userAgent || getRandomUA();
}

function reloadJar() {
  jar = CookieJar.load();
  return jar;
}

function getJar() {
  return jar;
}

function withAuthLock(operation) {
  if (authInFlight) return authInFlight;
  authInFlight = Promise.resolve().then(operation).finally(() => {
    authInFlight = null;
  });
  return authInFlight;
}

function buildHeaders(extra = {}) {
  return {
    Cookie: jar.toHeader(),
    'User-Agent': getUserAgent(),
    ...extra,
  };
}

async function performHttpRefresh() {
  console.log('[Auth] HTTP serviceToken refresh...');
  reloadJar();

  if (!jar.isPassTokenValid()) {
    throw new AuthRequiredError('passToken 无效，请在面板重新扫码登录');
  }

  await refreshServiceToken(jar, getUserAgent());
  jar.save();
  console.log('[Auth] HTTP refresh succeeded');
  return jar.cookies;
}

async function ensureAuth() {
  return withAuthLock(async () => {
    reloadJar();
    if (!jar.isPassTokenValid()) {
      throw new AuthRequiredError('未登录，请打开面板扫码登录');
    }
    if (jar.isServiceTokenValid()) return jar.cookies;

    try {
      return await performHttpRefresh();
    } catch (e) {
      if (e instanceof AuthRequiredError) throw e;
      console.log('[Auth] HTTP refresh failed:', e.message);
    }

    throw new AuthRequiredError('serviceToken 已失效，请在面板重新扫码登录');
  });
}

async function refreshAuth() {
  return withAuthLock(async () => {
    reloadJar();
    if (!jar.isPassTokenValid()) {
      throw new AuthRequiredError('passToken 无效，请在面板重新扫码登录');
    }
    return performHttpRefresh();
  });
}

async function logout() {
  jar.clear();
  reloadJar();
}

async function checkPassTokenHealth() {
  reloadJar();
  if (!jar.isPassTokenValid()) {
    return { valid: false, reason: 'passToken missing or locally expired' };
  }

  try {
    const ctx = await getLoginContext();
    const resp = await fetch(buildSsoJsonUrl(ctx.serviceLoginUrl), {
      redirect: 'manual',
      headers: buildHeaders(),
      signal: AbortSignal.timeout(10000),
    });
    const data = parseSsoJson(await resp.text()) || {};
    if (data.code === 70016) {
      return { valid: false, reason: 'SSO rejected passToken (code 70016)' };
    }
    if (data.code === 0) {
      return { valid: true, reason: 'SSO accepted passToken' };
    }
    return { valid: true, reason: `SSO code ${data.code}` };
  } catch (e) {
    return { valid: false, reason: `health check failed: ${e.message}` };
  }
}

async function testRefresh() {
  const result = { ok: false, method: null, error: null, serviceToken: null };
  try {
    await performHttpRefresh();
    result.ok = true;
    result.method = 'http';
  } catch (e) {
    result.error = `HTTP: ${e.message}`;
  }

  if (result.ok) {
    const token = jar.findValid(SERVICE_TOKEN_NAME);
    result.serviceToken = token?.value ? `${token.value.slice(0, 30)}...` : null;
  }
  return result;
}

function cookiesToHeader(cookies) {
  const temp = new CookieJar();
  temp.setAll(cookies);
  return temp.toHeader();
}

function getAuthStatus() {
  reloadJar();
  const status = jar.getAuthStatus();
  return {
    ...status,
    passTokenExpiresText: status.passTokenExpires ? new Date(status.passTokenExpires).toLocaleString('zh-CN') : null,
    serviceTokenExpiresText: status.serviceTokenExpires ? new Date(status.serviceTokenExpires).toLocaleString('zh-CN') : null,
  };
}

module.exports = {
  AuthRequiredError,
  logout,
  ensureAuth,
  refreshAuth,
  getJar,
  reloadJar,
  cookiesToHeader,
  getUserAgent,
  getAuthStatus,
  checkPassTokenHealth,
  testRefresh,
  performHttpRefresh,
  get COOKIES_FILE() {
    return require('./cookie-jar').COOKIES_FILE;
  },
  USAGE_URL,
  getLoginContext,
};
