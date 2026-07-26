const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const COOKIES_FILE = path.join(__dirname, '..', 'cookies.json');
const META_FILE = path.join(__dirname, '..', 'meta.json');
const PLATFORM_URL = 'https://platform.xiaomimimo.com';
const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
];
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

function withAuthLock(operation) {
  if (authInFlight) return authInFlight;
  authInFlight = Promise.resolve().then(operation).finally(() => {
    authInFlight = null;
  });
  return authInFlight;
}

async function performHeadlessRefresh() {
  console.log('[Auth] trying headless serviceToken refresh...');
  const ua = getUserAgent();
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({ userAgent: ua });
    const cookies = loadCookies();
    if (!cookies) throw new Error('Cookie file is missing or invalid');
    await context.addCookies(cookies);

    const page = await context.newPage();
    await page.goto(PLATFORM_URL + '/api/v1/tokenPlan/usage', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    const newCookies = await context.cookies();
    if (!newCookies.some(c => c.name === 'api-platform_serviceToken')) {
      throw new Error('headless refresh did not produce serviceToken');
    }

    fs.writeFileSync(COOKIES_FILE, JSON.stringify(newCookies, null, 2));
    saveMeta(ua);
    console.log('[Auth] headless refresh succeeded');
    return newCookies;
  } finally {
    await browser.close().catch(() => {});
  }
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

    try {
      return await performHeadlessRefresh();
    } catch (e) {
      console.log('[Auth] headless refresh failed:', e.message);
      return performLogin();
    }
  });
}

async function refreshAuth() {
  return withAuthLock(async () => {
    try {
      return await performHeadlessRefresh();
    } catch (e) {
      console.log('[Auth] headless refresh failed:', e.message);
      return performLogin();
    }
  });
}

module.exports = {
  login,
  headlessRefresh,
  refreshAuth,
  loadCookies,
  cookiesToHeader,
  ensureAuth,
  isPassTokenValid,
  getUserAgent,
  COOKIES_FILE,
};

