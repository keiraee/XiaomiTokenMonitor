const fs = require('fs');
const path = require('path');

const COOKIES_FILE = path.join(__dirname, '..', 'cookies.json');
const PASS_TOKEN_NAME = 'passToken';
const SERVICE_TOKEN_NAME = 'api-platform_serviceToken';
const DEFAULT_SESSION_MAXAGE = 7 * 24 * 60 * 60;

function normalizeDomain(domain) {
  return (domain || '').replace(/^\./, '').toLowerCase();
}

function domainsMatch(a, b) {
  return normalizeDomain(a) === normalizeDomain(b);
}

function isExpired(cookie, nowSec = Date.now() / 1000) {
  if (!Number.isFinite(cookie.expires) || cookie.expires <= 0) return false;
  return cookie.expires <= nowSec;
}

function isTombstone(cookie, nowSec = Date.now() / 1000) {
  return !cookie.value || (isExpired(cookie, nowSec) && !cookie.value);
}

function cookieKey(cookie) {
  return `${cookie.name}|${normalizeDomain(cookie.domain)}|${cookie.path || '/'}`;
}

function parseSetCookie(setCookie) {
  const parts = setCookie.split(';').map(part => part.trim());
  const [name, ...valueParts] = parts[0].split('=');
  if (!name) return null;

  const cookie = {
    name,
    value: valueParts.length ? valueParts.join('=') : '',
    path: '/',
  };

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
    } else if (key === 'domain') {
      cookie.domain = value;
    } else if (key === 'path') {
      cookie.path = value || '/';
    } else if (key === 'httponly') {
      cookie.httpOnly = true;
    } else if (key === 'secure') {
      cookie.secure = true;
    } else if (key === 'samesite') {
      cookie.sameSite = value || 'Lax';
    }
  }

  if (!Number.isFinite(cookie.expires) && cookie.value) {
    cookie.expires = Date.now() / 1000 + DEFAULT_SESSION_MAXAGE;
  }

  return cookie;
}

function normalizeIncomingCookie(cookie) {
  if (!cookie?.name) return null;
  return {
    domain: cookie.domain || '.platform.xiaomimimo.com',
    path: cookie.path || '/',
    ...cookie,
    value: String(cookie.value ?? ''),
  };
}

class CookieJar {
  constructor() {
    this.cookies = [];
  }

  static load() {
    const jar = new CookieJar();
    jar.cookies = jar.prune(loadRawCookies());
    return jar;
  }

  prune(list = this.cookies) {
    const nowSec = Date.now() / 1000;
    const kept = [];
    const best = new Map();

    for (const raw of list) {
      const cookie = normalizeIncomingCookie(raw);
      if (!cookie) continue;
      if (isTombstone(cookie, nowSec)) continue;

      const key = cookieKey(cookie);
      const prev = best.get(key);
      if (!prev || (cookie.expires || 0) > (prev.expires || 0)) {
        best.set(key, cookie);
      }
    }

    for (const cookie of best.values()) kept.push(cookie);
    this.cookies = kept;
    return kept;
  }

  save() {
    this.prune();
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(this.cookies, null, 2));
  }

  clear() {
    this.cookies = [];
    try { fs.unlinkSync(COOKIES_FILE); } catch {}
  }

  setAll(cookies) {
    this.cookies = this.prune(Array.isArray(cookies) ? cookies : []);
    return this.cookies;
  }

  replaceAll(cookies) {
    this.setAll(cookies);
    this.save();
    return this.cookies;
  }

  mergeAll(cookies) {
    for (const raw of Array.isArray(cookies) ? cookies : []) {
      const cookie = normalizeIncomingCookie(raw);
      if (!cookie || isTombstone(cookie)) continue;
      const key = cookieKey(cookie);
      const idx = this.cookies.findIndex(c => cookieKey(c) === key);
      if (idx >= 0) this.cookies[idx] = { ...this.cookies[idx], ...cookie };
      else this.cookies.push(cookie);
    }
    this.prune();
    this.save();
    return this.cookies;
  }

  applySetCookies(setCookies) {
    if (!Array.isArray(setCookies)) return;
    const nowSec = Date.now() / 1000;

    for (const raw of setCookies) {
      const incoming = parseSetCookie(raw);
      if (!incoming) continue;

      const key = cookieKey(incoming);
      const deleteCookie = !incoming.value || (Number.isFinite(incoming.expires) && incoming.expires <= nowSec);

      if (deleteCookie) {
        this.cookies = this.cookies.filter(c => cookieKey(c) !== key);
        continue;
      }

      const idx = this.cookies.findIndex(c => cookieKey(c) === key);
      if (idx >= 0) this.cookies[idx] = { ...this.cookies[idx], ...incoming };
      else this.cookies.push(incoming);
    }

    this.prune();
  }

  applyResponse(response) {
    const setCookies = response.headers.getSetCookie?.() || [];
    this.applySetCookies(setCookies);
  }

  findValid(name) {
    const nowSec = Date.now() / 1000;
    return this.cookies
      .filter(c => c.name === name && c.value && !isExpired(c, nowSec))
      .sort((a, b) => (b.expires || 0) - (a.expires || 0))[0] || null;
  }

  toHeader() {
    const nowSec = Date.now() / 1000;
    const latest = new Map();

    for (const cookie of this.cookies) {
      if (!cookie.name || !cookie.value || isExpired(cookie, nowSec)) continue;
      const prev = latest.get(cookie.name);
      if (!prev || (cookie.expires || 0) > (prev.expires || 0)) {
        latest.set(cookie.name, cookie);
      }
    }

    return [...latest.values()].map(c => `${c.name}=${c.value}`).join('; ');
  }

  isPassTokenValid() {
    return Boolean(this.findValid(PASS_TOKEN_NAME));
  }

  isServiceTokenValid() {
    return Boolean(this.findValid(SERVICE_TOKEN_NAME));
  }

  getAuthStatus() {
    const passToken = this.findValid(PASS_TOKEN_NAME);
    const serviceToken = this.findValid(SERVICE_TOKEN_NAME);
    return {
      loggedIn: Boolean(passToken),
      passTokenExpires: passToken?.expires ? passToken.expires * 1000 : null,
      serviceTokenValid: Boolean(serviceToken),
      serviceTokenExpires: serviceToken?.expires ? serviceToken.expires * 1000 : null,
      cookieCount: this.cookies.length,
    };
  }
}

function loadRawCookies() {
  if (!fs.existsSync(COOKIES_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function parseCookieHeader(header) {
  if (!header || typeof header !== 'string') return [];
  return header.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const idx = part.indexOf('=');
    if (idx <= 0) return null;
    return {
      name: part.slice(0, idx).trim(),
      value: part.slice(idx + 1).trim(),
      domain: '.xiaomi.com',
      path: '/',
      expires: Date.now() / 1000 + DEFAULT_SESSION_MAXAGE,
    };
  }).filter(Boolean);
}

function parseCookieInput(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('[')) {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) throw new Error('Cookie JSON 必须是数组');
      return parsed;
    }
    return parseCookieHeader(trimmed);
  }
  throw new Error('不支持的 Cookie 格式');
}

module.exports = {
  CookieJar,
  COOKIES_FILE,
  PASS_TOKEN_NAME,
  SERVICE_TOKEN_NAME,
  parseCookieInput,
  parseSetCookie,
  domainsMatch,
  normalizeIncomingCookie,
  cookieKey,
};
