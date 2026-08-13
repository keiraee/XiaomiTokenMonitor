const express = require('express');
const path = require('path');
const fs = require('fs');
const {
  logout,
  refreshAuth,
  reloadJar,
  getAuthStatus,
  checkPassTokenHealth,
  AuthRequiredError,
} = require('./auth');
const { fetchUsage } = require('./usage');
const { startQrLogin, getQrLoginStatus, cancelQrLogin } = require('./qr-login');
const { DIST_DIR, PORT, HOST, DATA_DIR, ensureDataDir } = require('./config');
const log = require('./logger');

const REFRESH_AHEAD_MS = 5 * 60 * 1000;
const SERVICE_TOKEN_FALLBACK_MS = 24 * 60 * 60 * 1000;
const HEALTH_CHECK_INTERVAL = 60 * 60 * 1000;

let lastRefresh = null;
let refreshTimer = null;
let nextRefreshAt = null;
let lastUsage = null;
let authState = 'unknown';

function panelBaseUrl(req) {
  const host = req?.headers?.host || `${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`;
  return `http://${host}`;
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
      scheduleNextRefresh();
      return;
    }

    await refreshAuth();
    lastRefresh = new Date();
    authState = 'authenticated';
    log.info('自动刷新成功');
    scheduleNextRefresh();
  } catch (e) {
    authState = e instanceof AuthRequiredError ? 'relogin_required' : 'refresh_failed';
    log.error(`自动刷新失败: ${e.message}`);
    if (refreshTimer) clearTimeout(refreshTimer);
    nextRefreshAt = new Date(Date.now() + 5 * 60_000);
    refreshTimer = setTimeout(refreshCookies, 5 * 60_000);
  } finally {
    log.info('===== 自动刷新结束 =====');
  }
}

function buildStatusPayload(req) {
  const auth = getAuthStatus();
  const base = panelBaseUrl(req);
  return {
    auth: {
      ...auth,
      state: authState,
      lastRefresh: lastRefresh ? lastRefresh.toISOString() : null,
      nextRefresh: nextRefreshAt ? nextRefreshAt.toISOString() : null,
      panelUrl: `${base}/`,
      usageUrl: `${base}/usage`,
    },
    usage: lastUsage?.summary || null,
  };
}

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));
app.use(express.static(DIST_DIR));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, dataDir: DATA_DIR, port: PORT });
});

app.get('/api/status', (req, res) => {
  res.json(buildStatusPayload(req));
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

app.post('/api/login/qr/start', async (_req, res) => {
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
    log.info('扫码登录成功');
  }
  res.json(status);
});

app.post('/api/login/qr/cancel', (req, res) => {
  const sessionId = req.body?.sessionId;
  if (sessionId) cancelQrLogin(sessionId);
  res.json({ ok: true });
});

app.post('/api/refresh', async (_req, res) => {
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

app.post('/api/logout', async (_req, res) => {
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
  } else {
    log.info('[健康检查] passToken 正常');
  }
}

let healthCheckTimer = null;

ensureDataDir();

const server = app.listen(PORT, HOST, () => {
  const index = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(index)) {
    log.error('前端未构建，镜像应包含 web/dist；本地请先 npm run build');
    process.exitCode = 1;
    return;
  }

  log.info(`小米 Token 监控服务启动: http://${HOST}:${PORT}`);
  log.info(`数据目录: ${DATA_DIR}`);

  reloadJar();
  const auth = getAuthStatus();
  authState = auth.loggedIn ? (auth.serviceTokenValid ? 'authenticated' : 'needs_refresh') : 'unauthenticated';
  scheduleNextRefresh();
  healthCheckTimer = setInterval(runHealthCheck, HEALTH_CHECK_INTERVAL);
});

async function shutdown() {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (healthCheckTimer) clearInterval(healthCheckTimer);
  try { await new Promise((resolve) => server.close(resolve)); } catch {}
}

process.once('SIGINT', () => shutdown());
process.once('SIGTERM', () => shutdown());
