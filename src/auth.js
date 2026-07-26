const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const COOKIES_FILE = path.join(__dirname, '..', 'cookies.json');
const META_FILE = path.join(__dirname, '..', 'meta.json');
const PLATFORM_URL = 'https://platform.xiaomimimo.com';

// 常见 Chrome UA 池
const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
];

function getRandomUA() {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}

function saveMeta(ua) {
  fs.writeFileSync(META_FILE, JSON.stringify({ userAgent: ua }, null, 2));
}

function loadMeta() {
  if (!fs.existsSync(META_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf-8')); } catch { return null; }
}

function getUserAgent() {
  const meta = loadMeta();
  return meta?.userAgent || getRandomUA();
}

function isPassTokenValid(cookies) {
  const passToken = cookies.find(c => c.name === 'passToken');
  if (!passToken || passToken.expires <= 0) return false;
  return new Date(passToken.expires * 1000) > new Date();
}

async function headlessRefresh() {
  console.log('[Auth] 尝试无头刷新 serviceToken...');
  const ua = getUserAgent();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: ua });
  const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf-8'));
  await context.addCookies(cookies);

  const page = await context.newPage();
  await page.goto(PLATFORM_URL + '/api/v1/tokenPlan/usage', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  const newCookies = await context.cookies();
  const st = newCookies.find(c => c.name === 'api-platform_serviceToken');

  if (st) {
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(newCookies, null, 2));
    saveMeta(ua);
    console.log('[Auth] 无头刷新成功，serviceToken 已更新');
    await browser.close();
    return newCookies;
  }

  await browser.close();
  throw new Error('无头刷新失败，未获取到 serviceToken');
}

async function login() {
  const ua = getRandomUA();
  console.log('[Auth] 正在打开浏览器，请登录小米平台...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ userAgent: ua });
  const page = await context.newPage();

  try {
    await page.goto(PLATFORM_URL, { timeout: 60000 });
  } catch (e) {
    console.log('[Auth] 页面加载较慢，继续等待...');
  }

  await page.waitForURL('**/platform.xiaomimimo.com/**', { timeout: 300000 });
  console.log('[Auth] 登录成功，正在保存 Cookie...');

  const cookies = await context.cookies();
  fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
  saveMeta(ua);
  console.log('[Auth] Cookie 已保存');

  await browser.close();
  return cookies;
}

function loadCookies() {
  if (!fs.existsSync(COOKIES_FILE)) return null;
  return JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf-8'));
}

function cookiesToHeader(cookies) {
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

async function ensureAuth() {
  let cookies = loadCookies();

  if (!cookies) {
    console.log('[Auth] 无 Cookie，需要登录');
    return await login();
  }

  if (!isPassTokenValid(cookies)) {
    console.log('[Auth] passToken 已过期，需要重新登录');
    return await login();
  }

  try {
    return await headlessRefresh();
  } catch (e) {
    console.log('[Auth] 无头刷新失败:', e.message);
    return await login();
  }
}

module.exports = { login, headlessRefresh, loadCookies, cookiesToHeader, ensureAuth, isPassTokenValid, getUserAgent, COOKIES_FILE };
