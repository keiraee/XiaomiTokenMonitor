const express = require('express');
const path = require('path');
const fs = require('fs');
const {
  ensureAuth,
  cookiesToHeader,
  login,
  refreshAuth,
  getUserAgent,
  COOKIES_FILE,
} = require('./auth');
const { notify } = require('./notify');
const log = require('./logger');

const ROOT = path.join(__dirname, '..');
const PORT_CONF = path.join(ROOT, 'port.conf');
const HOST = '127.0.0.1';
const API_URL = 'https://platform.xiaomimimo.com/api/v1/tokenPlan/usage';
const REFRESH_INTERVAL = 12 * 60 * 60 * 1000;
const REQUEST_TIMEOUT = 30_000;

function getPort() {
  try {
    const port = Number.parseInt(fs.readFileSync(PORT_CONF, 'utf8').trim(), 10);
    if (port > 0 && port < 65536) return port;
  } catch {}
  return 9999;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function isLoopback(req) {
  return req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
}

const app = express();
const PORT = getPort();
let currentCookies = null;
let lastRefresh = null;
let refreshTimer = null;

async function requestUsage(cookies) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  const start = Date.now();

  try {
    log.info(`请求 API: ${API_URL}`);
    const response = await fetch(API_URL, {
      signal: controller.signal,
      headers: {
        Cookie: cookiesToHeader(cookies),
        'User-Agent': getUserAgent(),
        Accept: '*/*',
        'Accept-Language': 'en',
        'Content-Type': 'application/json',
        Referer: 'https://platform.xiaomimimo.com/console/plan-manage',
        DNT: '1',
        'x-timezone': 'Asia/Shanghai',
      },
    });
    log.info(`API 响应: ${response.status} (${Date.now() - start}ms)`);
    const data = response.ok ? await response.json() : null;
    return { status: response.status, ok: response.ok, data };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchUsage(cookies) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await requestUsage(cookies);

    if (response.status === 401 && attempt === 0) {
      log.warn('Cookie 已过期，尝试刷新认证...');
      currentCookies = await refreshAuth();
      cookies = currentCookies;
      lastRefresh = new Date();
      continue;
    }

    if (!response.ok) {
      throw new Error(`API 返回 HTTP ${response.status}`);
    }

    return response.data;
  }

  throw new Error('认证重试次数已用尽');
}

async function refreshCookies() {
  log.info('===== 定时刷新 Cookie 开始 =====');
  try {
    currentCookies = await refreshAuth();
    lastRefresh = new Date();
    log.info('定时刷新成功');
    notify('小米平台 - Token 已刷新', '下次刷新将在 12 小时后');
  } catch (e) {
    log.error(`定时刷新失败: ${e.message}`);
    notify('小米平台 - 刷新失败', 'SSO 登录失败，请手动重新登录');
  } finally {
    log.info('===== 定时刷新 Cookie 结束 =====');
  }
}

async function getUsage() {
  if (!currentCookies) currentCookies = await ensureAuth();
  return fetchUsage(currentCookies);
}

app.get('/usage', async (req, res) => {
  try {
    const data = await getUsage();
    res.json(data);
  } catch (e) {
    log.error(`[/usage] 响应失败: ${e.message}`);
    res.status(500).json({ code: -1, message: e.message });
  }
});

app.post('/relogin', async (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: '仅允许本机操作' });

  try {
    if (fs.existsSync(COOKIES_FILE)) fs.unlinkSync(COOKIES_FILE);
    currentCookies = await login();
    lastRefresh = new Date();
    notify('小米平台 - 重新登录成功', 'Cookie 已更新');
    res.json({ ok: true });
  } catch (e) {
    log.error(`[/relogin] 登录失败: ${e.message}`);
    notify('小米平台 - 登录失败', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/', async (req, res) => {
  let display = '等待数据...';
  let time = '暂无';
  try {
    const data = await getUsage();
    display = JSON.stringify(data, null, 2);
    time = new Date().toLocaleString('zh-CN');
  } catch (e) {
    display = '错误: ' + e.message;
    log.error(`[/] 页面数据获取失败: ${e.message}`);
  }

  const refreshTime = lastRefresh ? lastRefresh.toLocaleString('zh-CN') : '未刷新';
  res.send(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>小米 Token 用量</title>
<style>body{font-family:system-ui;max-width:800px;margin:40px auto;padding:20px;background:#f5f5f5}.card{background:#fff;border-radius:8px;padding:20px;box-shadow:0 2px 8px #0002}pre{background:#f0f0f0;padding:16px;border-radius:6px;overflow:auto}button{background:#ff6700;color:#fff;border:0;padding:10px 20px;border-radius:6px;cursor:pointer;margin-right:8px}.time{color:#888;font-size:14px}</style></head>
<body><h1>小米 Token 用量监控</h1><div class="card">
<p class="time">请求时间: ${escapeHtml(time)}</p>
<p class="time">Cookie 上次刷新: ${escapeHtml(refreshTime)}</p>
<p class="time">下次自动刷新: 12 小时后</p>
<pre>${escapeHtml(display)}</pre>
<button onclick="location.reload()">刷新</button>
<button onclick="fetch('/relogin',{method:'POST'}).then(()=>location.reload())">重新登录</button>
</div></body></html>`);
});

const server = app.listen(PORT, HOST, async () => {
  log.info(`小米 Token 监控服务启动，地址: http://${HOST}:${PORT}`);
  fs.writeFileSync(path.join(ROOT, 'server.pid'), String(process.pid));

  try {
    currentCookies = await ensureAuth();
    lastRefresh = new Date();
    notify('小米平台监控已启动', `代理地址: http://${HOST}:${PORT}/usage`);
    refreshTimer = setInterval(refreshCookies, REFRESH_INTERVAL);
  } catch (e) {
    log.error(`首次认证失败: ${e.message}`);
    notify('小米平台 - 启动失败', e.message);
    await shutdown(1);
  }
});

async function shutdown(exitCode = 0) {
  if (refreshTimer) clearInterval(refreshTimer);
  try { await new Promise(resolve => server.close(resolve)); } catch {}
  try { fs.unlinkSync(path.join(ROOT, 'server.pid')); } catch {}
  if (exitCode) process.exitCode = exitCode;
}

process.once('SIGINT', () => shutdown());
process.once('SIGTERM', () => shutdown());
