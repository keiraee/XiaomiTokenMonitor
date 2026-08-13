const crypto = require('crypto');
const { CookieJar } = require('./cookie-jar');
const {
  getLoginContext,
  ensureDeviceId,
  applyPollResult,
  followRedirectChain,
  refreshServiceToken,
  parseSsoJson,
} = require('./sso');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

/** @type {Map<string, any>} */
const sessions = new Map();

function cleanupSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.startedAt > (session.timeout + 30) * 1000) {
      sessions.delete(id);
    }
  }
}

async function fetchQrImageBase64(qrUrl, jar) {
  const resp = await fetch(qrUrl, {
    headers: { 'User-Agent': UA, Cookie: jar.toHeader(), Accept: 'image/*,*/*' },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`获取二维码失败 (HTTP ${resp.status})`);
  const buf = Buffer.from(await resp.arrayBuffer());
  return buf.toString('base64');
}

async function startQrLogin() {
  cleanupSessions();
  const ctx = await getLoginContext();
  const jar = new CookieJar();
  jar.persist = false;
  ensureDeviceId(jar);

  const qs = encodeURIComponent(
    `?callback=${encodeURIComponent(ctx.callback)}&sid=${ctx.sid}&_group=DEFAULT&_json=true&_locale=zh_CN`,
  );
  const params = new URLSearchParams({
    _qrsize: '240',
    qs,
    callback: ctx.callback,
    _hasLogo: 'false',
    sid: ctx.sid,
    serviceParam: JSON.stringify({ checkSafePhone: false, checkSafeAddress: false, lsrp_score: 0 }),
    _locale: 'zh_CN',
    _dc: String(Date.now()),
  });

  const initResp = await fetch(`https://account.xiaomi.com/longPolling/loginUrl?${params}`, {
    headers: { 'User-Agent': UA, Cookie: jar.toHeader(), Accept: '*/*' },
    signal: AbortSignal.timeout(15000),
  });
  jar.applyResponse(initResp);
  const initData = parseSsoJson(await initResp.text());
  if (!initData?.lp || !initData?.qr) {
    throw new Error(initData?.description || initData?.desc || '二维码初始化失败');
  }

  const sessionId = crypto.randomUUID();
  const session = {
    id: sessionId,
    status: 'pending',
    jar,
    ctx,
    lp: initData.lp,
    timeout: initData.timeout || 300,
    qrTips: initData.qrTips || '请使用小米手机/平板扫码登录',
    startedAt: Date.now(),
    error: null,
  };
  sessions.set(sessionId, session);

  const qrImageBase64 = await fetchQrImageBase64(initData.qr, jar);
  startBackgroundPoll(sessionId);

  return {
    sessionId,
    qrImageBase64,
    qrTips: session.qrTips,
    expiresIn: session.timeout,
  };
}

function startBackgroundPoll(sessionId) {
  pollLoop(sessionId).catch((err) => {
    const session = sessions.get(sessionId);
    if (!session || session.status !== 'pending') return;
    session.status = 'error';
    session.error = err.message;
  });
}

async function pollLoop(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  const deadline = session.startedAt + session.timeout * 1000;
  while (Date.now() < deadline && session.status === 'pending') {
    let resp;
    try {
      resp = await fetch(session.lp, {
        headers: { 'User-Agent': UA, Cookie: session.jar.toHeader(), Accept: '*/*' },
        signal: AbortSignal.timeout(35000),
      });
    } catch (e) {
      if (e.name === 'TimeoutError' || e.name === 'AbortError') continue;
      throw e;
    }

    if (resp.status !== 200) continue;

    const data = parseSsoJson(await resp.text());
    if (!data?.location) {
      throw new Error('扫码成功但未返回跳转地址');
    }

    session.jar.applyResponse(resp);
    applyPollResult(session.jar, data);
    await followRedirectChain(session.jar, data.location, UA);

    if (!session.jar.isServiceTokenValid()) {
      await refreshServiceToken(session.jar, UA);
    }

    if (!session.jar.isPassTokenValid()) {
      throw new Error('登录完成但未获得 passToken');
    }

    session.jar.persist = true;
    session.jar.save();
    session.status = 'success';
    session.completedAt = Date.now();
    return;
  }

  if (session.status === 'pending') {
    session.status = 'expired';
    session.error = '二维码已过期，请刷新';
  }
}

function getQrLoginStatus(sessionId) {
  cleanupSessions();
  const session = sessions.get(sessionId);
  if (!session) {
    return { status: 'missing', error: '会话不存在或已过期' };
  }

  const justCompleted = session.status === 'success' && !session.announced;
  if (justCompleted) session.announced = true;

  return {
    status: session.status,
    error: session.error,
    qrTips: session.qrTips,
    justCompleted,
    expiresIn: Math.max(0, Math.floor((session.startedAt + session.timeout * 1000 - Date.now()) / 1000)),
  };
}

function consumeQrLogin(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.status === 'success') {
    sessions.delete(sessionId);
    return { ok: true };
  }
  return { ok: false, status: session.status, error: session.error };
}

function cancelQrLogin(sessionId) {
  sessions.delete(sessionId);
}

module.exports = {
  startQrLogin,
  getQrLoginStatus,
  consumeQrLogin,
  cancelQrLogin,
};
