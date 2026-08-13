const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const {
  CookieJar,
  COOKIES_FILE,
  SERVICE_TOKEN_NAME,
  parseCookieInput,
} = require('./cookie-jar');
const {
  getLoginContext,
  buildSsoJsonUrl,
  parseSsoJson,
  refreshServiceToken,
} = require('./sso');

const META_FILE = path.join(__dirname, '..', 'meta.json');
const PLATFORM_URL = 'https://platform.xiaomimimo.com';
const USAGE_URL = `${PLATFORM_URL}/api/v1/tokenPlan/usage`;
const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
];
const MAX_HEADLESS_RETRIES = 2;

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

function saveMeta(ua) {
  fs.writeFileSync(META_FILE, JSON.stringify({ userAgent: ua }, null, 2));
}

function loadMeta() {
  if (!fs.existsSync(META_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(META_FILE, 'utf-8'));
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
    throw new AuthRequiredError('passToken 无效，请在面板重新登录');
  }

  await refreshServiceToken(jar, getUserAgent());
  jar.save();
  console.log('[Auth] HTTP refresh succeeded');
  return jar.cookies;
}

async function performHeadlessRefresh() {
  console.log('[Auth] headless serviceToken refresh...');
  reloadJar();
  if (!jar.isPassTokenValid()) {
    throw new AuthRequiredError('passToken 无效，请在面板重新登录');
  }

  const ua = getUserAgent();
  let lastError;

  for (let attempt = 1; attempt <= MAX_HEADLESS_RETRIES; attempt += 1) {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ userAgent: ua });
      await context.addCookies(jar.cookies);
      const page = await context.newPage();
      await page.goto(PLATFORM_URL, { waitUntil: 'networkidle', timeout: 30000 });
      jar.mergeAll(await context.cookies());

      if (!jar.isServiceTokenValid()) {
        throw new Error('无头刷新未获得有效 serviceToken');
      }

      saveMeta(ua);
      console.log('[Auth] headless refresh succeeded');
      return jar.cookies;
    } catch (e) {
      lastError = e;
      console.log(`[Auth] headless attempt ${attempt}/${MAX_HEADLESS_RETRIES} failed: ${e.message}`);
      if (attempt < MAX_HEADLESS_RETRIES) await new Promise(r => setTimeout(r, 2000));
    } finally {
      await browser.close().catch(() => {});
    }
  }

  throw lastError || new Error('无头刷新失败');
}

async function performBrowserLogin() {
  const ua = getRandomUA();
  console.log('[Auth] opening browser for user login...');
  const browser = await chromium.launch({ headless: false });

  try {
    const context = await browser.newContext({ userAgent: ua });
    const page = await context.newPage();

    try {
      await page.goto(PLATFORM_URL, { timeout: 60000 });
    } catch {
      console.log('[Auth] page load slow; waiting for login...');
    }

    await page.waitForURL('**/platform.xiaomimimo.com/**', { timeout: 300000 });
    jar.replaceAll(await context.cookies());
    saveMeta(ua);

    if (!jar.isPassTokenValid()) {
      throw new Error('登录完成但未获取 passToken');
    }

    if (!jar.isServiceTokenValid()) {
      try {
        await performHttpRefresh();
      } catch (e) {
        console.log('[Auth] post-login HTTP refresh failed:', e.message);
      }
    }

    console.log('[Auth] browser login succeeded');
    return jar.cookies;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function importCookies(input) {
  return withAuthLock(async () => {
    const parsed = parseCookieInput(input);
    jar.replaceAll(parsed);

    if (!jar.isPassTokenValid()) {
      jar.clear();
      throw new Error('导入的 Cookie 中缺少有效 passToken');
    }

    if (!jar.isServiceTokenValid()) {
      try {
        await performHttpRefresh();
      } catch (e) {
        console.log('[Auth] import后 HTTP 刷新失败:', e.message);
        if (!jar.isServiceTokenValid()) {
          throw new Error('Cookie 已保存，但 serviceToken 刷新失败，请稍后手动刷新或浏览器登录');
        }
      }
    }

    return jar.cookies;
  });
}

async function browserLogin() {
  return withAuthLock(performBrowserLogin);
}

async function ensureAuth() {
  return withAuthLock(async () => {
    reloadJar();
    if (!jar.isPassTokenValid()) {
      throw new AuthRequiredError('未登录，请打开面板完成登录');
    }
    if (jar.isServiceTokenValid()) return jar.cookies;

    try {
      return await performHttpRefresh();
    } catch (e) {
      if (e instanceof AuthRequiredError) throw e;
      console.log('[Auth] HTTP refresh failed:', e.message);
    }

    try {
      return await performHeadlessRefresh();
    } catch (e) {
      if (e instanceof AuthRequiredError) throw e;
      console.log('[Auth] headless refresh failed:', e.message);
    }

    throw new AuthRequiredError('serviceToken 已失效，请在面板重新登录或点击刷新');
  });
}

async function refreshAuth() {
  return withAuthLock(async () => {
    reloadJar();
    if (!jar.isPassTokenValid()) {
      throw new AuthRequiredError('passToken 无效，请在面板重新登录');
    }

    try {
      return await performHttpRefresh();
    } catch (e) {
      if (e instanceof AuthRequiredError) throw e;
      console.log('[Auth] HTTP refresh failed:', e.message);
    }

    return performHeadlessRefresh();
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

  if (!result.ok) {
    try {
      await performHeadlessRefresh();
      result.ok = true;
      result.method = 'headless';
      result.error = null;
    } catch (e) {
      result.error += ` | Headless: ${e.message}`;
    }
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
  importCookies,
  browserLogin,
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
  performHeadlessRefresh,
  COOKIES_FILE,
  USAGE_URL,
  getLoginContext,
};
