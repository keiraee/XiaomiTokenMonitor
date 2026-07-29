const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const COOKIES_FILE = path.join(__dirname, '..', 'cookies.json');
const META_FILE = path.join(__dirname, '..', 'meta.json');
const PLATFORM_URL = 'https://platform.xiaomimimo.com';
const USAGE_URL = PLATFORM_URL + '/api/v1/tokenPlan/usage';
const SERVICE_TOKEN_NAME = 'api-platform_serviceToken';
const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
];
const MAX_HEADLESS_RETRIES = 2;
let authInFlight = null;

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

function isPassTokenValid(cookies) {
  if (!Array.isArray(cookies)) return false;
  const passToken = cookies.find(c => c.name === 'passToken');
  return Boolean(passToken && Number.isFinite(passToken.expires) &&
    passToken.expires > 0 && passToken.expires * 1000 > Date.now());
}

function isServiceTokenValid(cookies) {
  if (!Array.isArray(cookies)) return false;
  const token = cookies.find(c => c.name === SERVICE_TOKEN_NAME);
  return Boolean(token?.value && Number.isFinite(token.expires) &&
    token.expires > 0 && token.expires * 1000 > Date.now());
}

function parseSetCookie(setCookie) {
  const parts = setCookie.split(';').map(part => part.trim());
  const [name, ...valueParts] = parts[0].split('=');
  if (!name || valueParts.length === 0) return null;
  const cookie = { name, value: valueParts.join('=') };
  for (const attribute of parts.slice(1)) {
    const separator = attribute.indexOf('=');
    const key = (separator === -1 ? attribute : attribute.slice(0, separator)).toLowerCase();
    const value = separator === -1 ? '' : attribute.slice(separator + 1);
    if (key === 'expires') {
      const expires = Date.parse(value);
      if (Number.isFinite(expires)) cookie.expires = expires / 1000;
    } else if (key === 'max-age') {
      const maxAge = Number(value);
      if (Number.isFinite(maxAge)) cookie.expires = Date.now() / 1000 + maxAge;
    } else if (key === 'domain') cookie.domain = value;
    else if (key === 'path') cookie.path = value;
  }
  return cookie;
}

function applySetCookies(cookies, setCookies) {
  for (const raw of setCookies) {
    const incoming = parseSetCookie(raw);
    if (!incoming) continue;
    const existing = cookies.find(c => c.name === incoming.name &&
      (!incoming.domain || !c.domain || c.domain === incoming.domain));
    if (existing) Object.assign(existing, incoming);
    else cookies.push({ domain: '.platform.xiaomimimo.com', path: '/', ...incoming });
  }
}

function withAuthLock(operation) {
  if (authInFlight) return authInFlight;
  authInFlight = Promise.resolve().then(operation).finally(() => {
    authInFlight = null;
  });
  return authInFlight;
}

/**
 * Pure HTTP refresh: follow SSO redirects manually, no browser needed.
 * Works when passToken is still valid server-side.
 */
async function performHttpRefresh() {
  console.log('[Auth] trying HTTP serviceToken refresh...');
  const cookies = loadCookies();
  if (!cookies) throw new Error('Cookie file is missing or invalid');

  const ua = getUserAgent();
  // Step 1: Hit the platform with existing cookies, follow redirects manually
  let url = USAGE_URL;
  let resp;
  let gotNewServiceToken = false;
  for (let i = 0; i < 10; i++) {
    resp = await fetch(url, {
      redirect: 'manual',
      headers: {
        // Rebuild the header after every response so SSO cookies set on a
        // redirect are available to the next request.
        Cookie: cookiesToHeader(cookies),
        'User-Agent': ua,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location');
      if (!location) break;
      url = location.startsWith('http') ? location : new URL(location, url).href;
      // Collect any Set-Cookie from redirect responses
      const setCookies = resp.headers.getSetCookie?.() || [];
      applySetCookies(cookies, setCookies);
      gotNewServiceToken ||= setCookies.some(c => parseSetCookie(c)?.name === SERVICE_TOKEN_NAME);
      continue;
    }
    break;
  }

  // Step 2: Check if we ended up back on the platform with a new serviceToken
  // The final response Set-Cookie may contain the new serviceToken
  const finalSetCookies = resp.headers.getSetCookie?.() || [];
  applySetCookies(cookies, finalSetCookies);
  gotNewServiceToken ||= finalSetCookies.some(c => parseSetCookie(c)?.name === SERVICE_TOKEN_NAME);

  if (!gotNewServiceToken) {
    throw new Error('HTTP refresh did not produce serviceToken (status=' + resp.status + ')');
  }

  fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
  saveMeta(ua);
  console.log('[Auth] HTTP refresh succeeded');
  return cookies;
}

/**
 * Headless browser refresh: let the browser handle SSO redirects natively.
 * Includes retry logic.
 */
async function performHeadlessRefresh() {
  console.log('[Auth] trying headless serviceToken refresh...');
  const ua = getUserAgent();
  let lastError;

  for (let attempt = 1; attempt <= MAX_HEADLESS_RETRIES; attempt++) {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ userAgent: ua });
      const cookies = loadCookies();
      if (!cookies) throw new Error('Cookie file is missing or invalid');
      await context.addCookies(cookies);

      const page = await context.newPage();

      // Navigate to the main platform page (not API) — better for SSO redirect
      await page.goto(PLATFORM_URL, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      const newCookies = await context.cookies();
      if (!newCookies.some(c => c.name === SERVICE_TOKEN_NAME)) {
        throw new Error('headless refresh did not produce serviceToken');
      }

      fs.writeFileSync(COOKIES_FILE, JSON.stringify(newCookies, null, 2));
      saveMeta(ua);
      console.log('[Auth] headless refresh succeeded');
      return newCookies;
    } catch (e) {
      lastError = e;
      console.log(`[Auth] headless refresh attempt ${attempt}/${MAX_HEADLESS_RETRIES} failed: ${e.message}`);
      if (attempt < MAX_HEADLESS_RETRIES) await new Promise(r => setTimeout(r, 2000));
    } finally {
      await browser.close().catch(() => {});
    }
  }

  throw lastError || new Error('headless refresh failed');
}

async function headlessRefresh() {
  return withAuthLock(performHeadlessRefresh);
}

async function performLogin() {
  const ua = getRandomUA();
  console.log('[Auth] opening browser for Xiaomi SSO login...');
  const browser = await chromium.launch({ headless: false });

  try {
    const context = await browser.newContext({ userAgent: ua });
    const page = await context.newPage();

    try {
      await page.goto(PLATFORM_URL, { timeout: 60000 });
    } catch {
      console.log('[Auth] page load is slow; continuing to wait for login...');
    }

    await page.waitForURL('**/platform.xiaomimimo.com/**', { timeout: 300000 });
    const cookies = await context.cookies();
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
    saveMeta(ua);
    console.log('[Auth] login succeeded and Cookie was saved');
    return cookies;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function login() {
  return withAuthLock(performLogin);
}

function loadCookies() {
  if (!fs.existsSync(COOKIES_FILE)) return null;
  try {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf-8'));
    return Array.isArray(cookies) ? cookies : null;
  } catch {
    return null;
  }
}

function cookiesToHeader(cookies) {
  if (!Array.isArray(cookies)) return '';
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

async function ensureAuth() {
  return withAuthLock(async () => {
    const cookies = loadCookies();
    if (!cookies || !isPassTokenValid(cookies)) {
      console.log('[Auth] Cookie missing or passToken expired; login required');
      return performLogin();
    }

    if (isServiceTokenValid(cookies)) {
      console.log('[Auth] existing serviceToken is still valid');
      return cookies;
    }

    try {
      return await performHttpRefresh();
    } catch (e) {
      console.log('[Auth] HTTP refresh failed:', e.message);
    }

    try {
      return await performHeadlessRefresh();
    } catch (e) {
      console.log('[Auth] headless refresh failed:', e.message);
    }

    return performLogin();
  });
}

async function refreshAuth() {
  return withAuthLock(async () => {
    try {
      return await performHttpRefresh();
    } catch (e) {
      console.log('[Auth] HTTP refresh failed:', e.message);
    }

    try {
      return await performHeadlessRefresh();
    } catch (e) {
      console.log('[Auth] headless refresh failed:', e.message);
    }

    return performLogin();
  });
}

/**
 * Test the full refresh flow: HTTP → Headless → report result.
 * Does NOT fall back to manual login. Returns { ok, method, error, cookies }.
 */
async function testRefresh() {
  const result = { ok: false, method: null, error: null, serviceToken: null };

  // Tier 1: HTTP
  try {
    const cookies = await performHttpRefresh();
    result.ok = true;
    result.method = 'http';
    result.serviceToken = cookies.find(c => c.name === 'api-platform_serviceToken')?.value?.slice(0, 30) + '...';
    return result;
  } catch (e) {
    result.error = 'HTTP: ' + e.message;
  }

  // Tier 2: Headless
  try {
    const cookies = await performHeadlessRefresh();
    result.ok = true;
    result.method = 'headless';
    result.error = null;
    result.serviceToken = cookies.find(c => c.name === 'api-platform_serviceToken')?.value?.slice(0, 30) + '...';
    return result;
  } catch (e) {
    result.error += ' | Headless: ' + e.message;
  }

  return result;
}

module.exports = {
  login,
  headlessRefresh,
  refreshAuth,
  loadCookies,
  cookiesToHeader,
  ensureAuth,
  isPassTokenValid,
  isServiceTokenValid,
  getUserAgent,
  performHttpRefresh,
  performHeadlessRefresh,
  testRefresh,
  COOKIES_FILE,
};
