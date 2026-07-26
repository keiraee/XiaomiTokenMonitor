const express = require('express');
const path = require('path');
const { ensureAuth, cookiesToHeader, login, headlessRefresh, getUserAgent, COOKIES_FILE } = require('./auth');
const { notify } = require('./notify');
const log = require('./logger');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

const app = express();
const PORT = 9999;
const API_URL = 'https://platform.xiaomimimo.com/api/v1/tokenPlan/usage';
const REFRESH_INTERVAL = 12 * 60 * 60 * 1000;

let currentCookies = null;
let lastRefresh = null;

async function fetchUsage(cookies) {
  log.info(`请求 API: ${API_URL}`);
  const start = Date.now();
  const res = await fetch(API_URL, {
    headers: {
      Cookie: cookiesToHeader(cookies),
      'User-Agent': getUserAgent(),
      'Accept': '*/*',
      'Accept-Language': 'en',
      'Content-Type': 'application/json',
      'Referer': 'https://platform.xiaomimimo.com/console/plan-manage',
      'DNT': '1',
      'x-timezone': 'Asia/Shanghai',
    },
  });
  const elapsed = Date.now() - start;
  log.info(`API 响应: ${res.status} (${elapsed}ms)`);

  if (res.status === 401) {
    log.warn('Cookie 已过期，尝试自动刷新...');
    try {
      // 先尝试无头刷新
      currentCookies = await headlessRefresh();
      lastRefresh = new Date();
      log.info('无头刷新成功，重试请求...');
      return fetchUsage(currentCookies);
    } catch (e) {
      log.warn('无头刷新失败，弹窗登录...');
      try {
        currentCookies = await login();
        lastRefresh = new Date();
        log.info('弹窗登录成功');
        return fetchUsage(currentCookies);
      } catch (e2) {
        log.error(`重新登录失败: ${e2.message}`);
        notify('小米平台 - 登录失败', 'SSO 登录超时，请手动重新登录');
        throw new Error('需要重新登录，请打开 http://localhost:' + PORT + ' 完成登录');
      }
    }
  }
  if (!res.ok) {
    log.error(`API 请求失败: HTTP ${res.status}`);
    throw new Error(`API 返回 ${res.status}`);
  }

  const data = await res.json();
  log.info(`API 数据获取成功，耗时 ${elapsed}ms`);
  return data;
}

async function refreshCookies() {
  log.info('===== 定时刷新 Cookie 开始 =====');
  try {
    // 先尝试无头刷新（静默，不弹窗）
    currentCookies = await headlessRefresh();
    lastRefresh = new Date();
    log.info('无头刷新成功，serviceToken 已更新');
    notify('小米平台 - Token 已刷新', '下次刷新: 12小时后');
  } catch (e) {
    log.warn(`无头刷新失败: ${e.message}，尝试弹窗登录...`);
    try {
      currentCookies = await login();
      lastRefresh = new Date();
      log.info('弹窗登录成功');
      notify('小米平台 - Token 已刷新', '下次刷新: 12小时后');
    } catch (e2) {
      log.error(`定时刷新失败: ${e2.message}`);
      notify('小米平台 - 刷新失败', 'SSO 登录失败，请手动重新登录');
    }
  }
  log.info('===== 定时刷新 Cookie 结束 =====');
}

app.get('/usage', async (req, res) => {
  log.info(`[/usage] 请求来自 ${req.ip}`);
  try {
    if (!currentCookies) {
      log.info('Cookie 为空，执行首次认证...');
      currentCookies = await ensureAuth();
    }
    const data = await fetchUsage(currentCookies);
    res.json(data);
    log.info(`[/usage] 响应成功`);
  } catch (e) {
    log.error(`[/usage] 响应失败: ${e.message}`);
    res.status(500).json({ code: -1, message: e.message });
  }
});

app.get('/relogin', async (req, res) => {
  log.info(`[/relogin] 触发重新登录`);
  try {
    if (fs.existsSync(COOKIES_FILE)) fs.unlinkSync(COOKIES_FILE);
    currentCookies = await login();
    lastRefresh = new Date();
    log.info('重新登录成功');
    notify('小米平台 - 重新登录成功', 'Cookie 已更新');
    res.json({ ok: true });
  } catch (e) {
    log.error(`重新登录失败: ${e.message}`);
    notify('小米平台 - 登录失败', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/', async (req, res) => {
  log.info(`[/] 页面访问`);
  let display = '等待数据...';
  let time = '暂无';
  try {
    if (!currentCookies) currentCookies = await ensureAuth();
    const data = await fetchUsage(currentCookies);
    display = JSON.stringify(data, null, 2);
    time = new Date().toLocaleString('zh-CN');
  } catch (e) {
    display = '错误: ' + e.message;
    log.error(`[/] 页面数据获取失败: ${e.message}`);
  }
  const refreshTime = lastRefresh ? lastRefresh.toLocaleString('zh-CN') : '未刷新';
  res.send(`
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"><title>小米 Token 用量</title>
    <style>
      body { font-family: -apple-system, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; background: #f5f5f5; }
      h1 { color: #333; }
      .card { background: #fff; border-radius: 8px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
      pre { background: #f0f0f0; padding: 16px; border-radius: 6px; overflow-x: auto; }
      .time { color: #888; font-size: 14px; }
      button { background: #ff6700; color: #fff; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; }
      button:hover { background: #e55d00; }
    </style></head><body>
    <h1>小米 Token 用量监控</h1>
    <div class="card">
      <p class="time">请求时间: ${time}</p>
      <p class="time">Cookie 上次刷新: ${refreshTime}</p>
      <p class="time">下次自动刷新: 12小时后</p>
      <pre>${display}</pre>
      <br>
      <button onclick="location.reload()">刷新</button>
      <button onclick="fetch('/relogin').then(()=>location.reload())">重新登录</button>
    </div>
    </body></html>
  `);
});

app.listen(PORT, async () => {
  log.info('========================================');
  log.info('小米 Token 用量监控服务启动');
  log.info(`端口: ${PORT}`);
  log.info(`代理接口: http://localhost:${PORT}/usage`);
  log.info(`Cookie 刷新间隔: ${REFRESH_INTERVAL / 3600000} 小时`);
  log.info(`PID: ${process.pid}`);
  log.info('========================================');

  // 写 PID 文件供 main.bat 使用
  fs.writeFileSync(path.join(ROOT, 'server.pid'), String(process.pid));

  try {
    currentCookies = await ensureAuth();
    lastRefresh = new Date();
    log.info('首次认证成功');
    notify('小米平台监控已启动', `代理地址: http://localhost:${PORT}/usage`);
    setInterval(refreshCookies, REFRESH_INTERVAL);
  } catch (e) {
    log.error(`首次认证失败: ${e.message}`);
    notify('小米平台 - 启动失败', e.message);
    process.exit(1);
  }
});
