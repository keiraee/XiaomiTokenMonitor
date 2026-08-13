const express = require('express');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const {
  importCookies,
  browserLogin,
  logout,
  refreshAuth,
  reloadJar,
  getAuthStatus,
  checkPassTokenHealth,
  AuthRequiredError,
  COOKIES_FILE,
} = require('./auth');
const { fetchUsage } = require('./usage');
const { startQrLogin, getQrLoginStatus, cancelQrLogin } = require('./qr-login');
const {
  loginWithPassword,
  sendPhoneCode,
  loginWithPhone,
  refreshCaptcha,
} = require('./credential-login');
const { notify } = require('./notify');
const log = require('./logger');

const ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'web', 'dist');
const PORT_CONF = path.join(ROOT, 'port.conf');
const HOST = '127.0.0.1';
const REFRESH_AHEAD_MS = 5 * 60 * 1000;
const SERVICE_TOKEN_FALLBACK_MS = 24 * 60 * 60 * 1000;
const HEALTH_CHECK_INTERVAL = 60 * 60 * 1000;

let lastRefresh = null;
let refreshTimer = null;
let nextRefreshAt = null;
let lastUsage = null;
let authState = 'unknown';

function ensureFrontendBuilt() {
  const index = path.join(DIST_DIR, 'index.html');
  if (fs.existsSync(index)) return;
  log.warn('前端未构建，正在自动执行 npm run build ...');
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
  if (!fs.existsSync(index)) {
    throw new Error('前端构建失败，请手动运行 npm run build');
  }
}

function getPort() {
  try {
    const port = Number.parseInt(fs.readFileSync(PORT_CONF, 'utf8').trim(), 10);
    if (port > 0 && port < 65536) return port;
  } catch {}
  return 9999;
}

function isLoopback(req) {
  return req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
}

function guardLocal(req, res) {
  if (!isLoopback(req)) {
    res.status(403).json({ error: '仅允许本机操作' });
    return false;
  }
  return true;
}

function scheduleNextRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  reloadJar();
  const status = getAuthStatus();

  if (!status.loggedIn) {
    nextRefreshAt = null;
    authState = 'unauthenticated';
    return;
  }

  const expiresAt = status.serviceTokenExpires || (Date.now() + SERVICE_TOKEN_FALLBACK_MS);
  const delay = Math.max(expiresAt - Date.now() - REFRESH_AHEAD_MS, 60_000);
  nextRefreshAt = new Date(Date.now() + delay);
  authState = status.serviceTokenValid ? 'authenticated' : 'needs_refresh';
  log.info(`下次刷新: ${nextRefreshAt.toLocaleString('zh-CN')}`);
  refreshTimer = setTimeout(refreshCookies, delay);
}

async function refreshCookies() {
  log.info('===== 自动刷新开始 =====');
  try {
    const health = await checkPassTokenHealth();
    if (!health.valid) {
      authState = 'relogin_required';
      log.warn(`passToken 失效: ${health.reason}`);
      notify('小米平台 - 需要重新登录', '请打开本地面板完成登录');
      scheduleNextRefresh();
      return;
    }

    await refreshAuth();
    lastRefresh = new Date();
    authState = 'authenticated';
    log.info('自动刷新成功');
    notify('小米平台 - Token 已刷新', `下次刷新: ${nextRefreshAt?.toLocaleString('zh-CN') || '约 24 小时内'}`);
    scheduleNextRefresh();
  } catch (e) {
    authState = e instanceof AuthRequiredError ? 'relogin_required' : 'refresh_failed';
    log.error(`自动刷新失败: ${e.message}`);
    notify('小米平台 - 刷新失败', e.message);
    if (refreshTimer) clearTimeout(refreshTimer);
    nextRefreshAt = new Date(Date.now() + 5 * 60_000);
    refreshTimer = setTimeout(refreshCookies, 5 * 60_000);
  } finally {
    log.info('===== 自动刷新结束 =====');
  }
}

function buildStatusPayload() {
  const auth = getAuthStatus();
  return {
    auth: {
      ...auth,
      state: authState,
      lastRefresh: lastRefresh ? lastRefresh.toISOString() : null,
      nextRefresh: nextRefreshAt ? nextRefreshAt.toISOString() : null,
      panelUrl: `http://${HOST}:${getPort()}/`,
      usageUrl: `http://${HOST}:${getPort()}/usage`,
    },
    usage: lastUsage?.summary || null,
  };
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.text({ type: ['text/*', 'application/json'], limit: '2mb' }));
app.use(express.static(DIST_DIR));

app.get('/api/status', (_req, res) => {
  res.json(buildStatusPayload());
});

app.get('/api/usage', async (_req, res) => {
  try {
    const usage = await fetchUsage({
      onRefresh: () => {
        lastRefresh = new Date();
        scheduleNextRefresh();
      },
    });
    lastUsage = usage;
    authState = 'authenticated';
    res.json(usage);
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      authState = 'relogin_required';
      return res.status(401).json({ code: 'AUTH_REQUIRED', message: e.message, auth: getAuthStatus() });
    }
    log.error(`[/api/usage] ${e.message}`);
    res.status(500).json({ code: -1, message: e.message });
  }
});

app.post('/api/login/qr/start', async (req, res) => {
  if (!guardLocal(req, res)) return;
  try {
    const data = await startQrLogin();
    res.json({ ok: true, ...data });
  } catch (e) {
    log.error(`[/api/login/qr/start] ${e.message}`);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/login/qr/status/:sessionId', (req, res) => {
  const status = getQrLoginStatus(req.params.sessionId);
  if (status.justCompleted) {
    reloadJar();
    lastRefresh = new Date();
    authState = 'authenticated';
    scheduleNextRefresh();
    notify('小米平台 - 扫码登录成功', 'Cookie 已保存');
  }
  res.json(status);
});

app.post('/api/login/qr/cancel', async (req, res) => {
  if (!guardLocal(req, res)) return;
  const sessionId = req.body?.sessionId;
  if (sessionId) cancelQrLogin(sessionId);
  res.json({ ok: true });
});

function markLoggedIn(res, extra = {}) {
  reloadJar();
  lastRefresh = new Date();
  authState = 'authenticated';
  scheduleNextRefresh();
  notify('小米平台 - 登录成功', 'Cookie 已保存');
  res.json({ ok: true, auth: getAuthStatus(), ...extra });
}

app.post('/api/login/password', async (req, res) => {
  if (!guardLocal(req, res)) return;
  try {
    const result = await loginWithPassword(req.body || {});
    if (result.ok) return markLoggedIn(res);
    res.json(result);
  } catch (e) {
    log.error(`[/api/login/password] ${e.message}`);
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/login/phone/send', async (req, res) => {
  if (!guardLocal(req, res)) return;
  try {
    const result = await sendPhoneCode(req.body || {});
    res.json(result);
  } catch (e) {
    log.error(`[/api/login/phone/send] ${e.message}`);
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/login/phone/verify', async (req, res) => {
  if (!guardLocal(req, res)) return;
  try {
    const result = await loginWithPhone(req.body || {});
    if (result.ok) return markLoggedIn(res);
    res.json(result);
  } catch (e) {
    log.error(`[/api/login/phone/verify] ${e.message}`);
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/login/captcha/refresh', async (req, res) => {
  if (!guardLocal(req, res)) return;
  try {
    const result = await refreshCaptcha(req.body?.sessionId);
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/login/cookies', async (req, res) => {
  if (!guardLocal(req, res)) return;
  try {
    const input = req.body?.cookies ?? req.body;
    await importCookies(input);
    lastRefresh = new Date();
    authState = 'authenticated';
    scheduleNextRefresh();
    notify('小米平台 - Cookie 导入成功', '已保存登录信息');
    res.json({ ok: true, auth: getAuthStatus() });
  } catch (e) {
    log.error(`[/api/login/cookies] ${e.message}`);
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/login/browser', async (req, res) => {
  if (!guardLocal(req, res)) return;
  try {
    await browserLogin();
    lastRefresh = new Date();
    authState = 'authenticated';
    scheduleNextRefresh();
    notify('小米平台 - 浏览器登录成功', 'Cookie 已更新');
    res.json({ ok: true, auth: getAuthStatus() });
  } catch (e) {
    log.error(`[/api/login/browser] ${e.message}`);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/refresh', async (req, res) => {
  if (!guardLocal(req, res)) return;
  try {
    await refreshAuth();
    lastRefresh = new Date();
    authState = 'authenticated';
    scheduleNextRefresh();
    res.json({ ok: true, auth: getAuthStatus() });
  } catch (e) {
    const code = e instanceof AuthRequiredError ? 401 : 500;
    if (e instanceof AuthRequiredError) authState = 'relogin_required';
    res.status(code).json({ ok: false, error: e.message });
  }
});

app.post('/api/logout', async (req, res) => {
  if (!guardLocal(req, res)) return;
  await logout();
  lastUsage = null;
  lastRefresh = null;
  authState = 'unauthenticated';
  if (refreshTimer) clearTimeout(refreshTimer);
  nextRefreshAt = null;
  res.json({ ok: true });
});

app.get('/usage', async (_req, res) => {
  try {
    const usage = await fetchUsage({
      onRefresh: () => {
        lastRefresh = new Date();
        scheduleNextRefresh();
      },
    });
    lastUsage = usage;
    res.json(usage.raw || usage);
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      return res.status(401).json({ code: 'AUTH_REQUIRED', message: e.message });
    }
    res.status(500).json({ code: -1, message: e.message });
  }
});

app.post('/relogin', async (req, res) => {
  if (!guardLocal(req, res)) return;
  try {
    if (fs.existsSync(COOKIES_FILE)) fs.unlinkSync(COOKIES_FILE);
    reloadJar();
    await browserLogin();
    lastRefresh = new Date();
    authState = 'authenticated';
    scheduleNextRefresh();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (_req, res) => {
  const index = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(index)) {
    return res.status(500).send('前端未构建，请先运行 npm run build');
  }
  res.sendFile(index);
});

async function runHealthCheck() {
  const health = await checkPassTokenHealth();
  if (!health.valid) {
    authState = 'relogin_required';
    log.warn(`[健康检查] passToken 失效: ${health.reason}`);
    notify('小米平台 - passToken 已失效', '请打开本地面板重新登录');
  } else {
    log.info(`[健康检查] passToken 正常`);
  }
}

const PORT = getPort();
let healthCheckTimer = null;

const server = app.listen(PORT, HOST, () => {
  try {
    ensureFrontendBuilt();
  } catch (e) {
    log.error(`前端构建失败: ${e.message}`);
    process.exitCode = 1;
    return;
  }

  log.info(`小米 Token 监控服务启动: http://${HOST}:${PORT}`);
  fs.writeFileSync(path.join(ROOT, 'server.pid'), String(process.pid));

  reloadJar();
  const auth = getAuthStatus();
  authState = auth.loggedIn ? (auth.serviceTokenValid ? 'authenticated' : 'needs_refresh') : 'unauthenticated';
  scheduleNextRefresh();
  healthCheckTimer = setInterval(runHealthCheck, HEALTH_CHECK_INTERVAL);
  notify('小米平台监控已启动', `打开面板: http://${HOST}:${PORT}/`);
});

async function shutdown(exitCode = 0) {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (healthCheckTimer) clearInterval(healthCheckTimer);
  try { await new Promise(resolve => server.close(resolve)); } catch {}
  try { fs.unlinkSync(path.join(ROOT, 'server.pid')); } catch {}
  if (exitCode) process.exitCode = exitCode;
}

process.once('SIGINT', () => shutdown());
process.once('SIGTERM', () => shutdown());
