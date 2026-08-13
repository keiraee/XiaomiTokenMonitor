const crypto = require('crypto');
const { CookieJar } = require('./cookie-jar');
const {
  getLoginContext,
  buildSsoJsonUrl,
  parseSsoJson,
  ensureDeviceId,
  applyPollResult,
  followRedirectChain,
  refreshServiceToken,
} = require('./sso');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
const sessions = new Map();

function md5Upper(text) {
  return crypto.createHash('md5').update(String(text), 'utf8').digest('hex').toUpperCase();
}

function cleanupSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > 15 * 60 * 1000) sessions.delete(id);
  }
}

function createSession() {
  cleanupSessions();
  const jar = new CookieJar();
  ensureDeviceId(jar);
  jar.mergeAll([
    { name: 'pass_ua', value: 'web', domain: '.account.xiaomi.com', path: '/', expires: Date.now() / 1000 + 30 * 24 * 3600 },
    { name: 'sdkVersion', value: 'accountsdk-18.8.15', domain: '.xiaomi.com', path: '/', expires: Date.now() / 1000 + 30 * 24 * 3600 },
  ]);
  const id = crypto.randomUUID();
  const session = { id, jar, createdAt: Date.now(), bootstrap: null };
  sessions.set(id, session);
  return session;
}

function getSession(sessionId) {
  cleanupSessions();
  if (sessionId && sessions.has(sessionId)) return sessions.get(sessionId);
  return createSession();
}

async function fetchCaptcha(session) {
  const url = `https://account.xiaomi.com/pass/getCode?icodeType=login&t=${Date.now()}`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': UA, Cookie: session.jar.toHeader(), Accept: 'image/*,*/*' },
    signal: AbortSignal.timeout(15000),
  });
  session.jar.applyResponse(resp);
  if (!resp.ok) throw new Error(`获取图形验证码失败 (HTTP ${resp.status})`);
  const buf = Buffer.from(await resp.arrayBuffer());
  return {
    sessionId: session.id,
    captchaRequired: true,
    captchaImageBase64: buf.toString('base64'),
  };
}

async function bootstrapAuth(session) {
  const ctx = await getLoginContext();
  const ssoUrl = buildSsoJsonUrl(ctx.serviceLoginUrl);
  const resp = await fetch(ssoUrl, {
    redirect: 'manual',
    headers: { 'User-Agent': UA, Cookie: session.jar.toHeader(), Accept: '*/*' },
    signal: AbortSignal.timeout(15000),
  });
  session.jar.applyResponse(resp);
  const json = parseSsoJson(await resp.text());
  if (!json?._sign || !json?.qs || !json?.callback) {
    throw new Error(json?.description || '获取登录参数失败');
  }
  session.bootstrap = {
    sid: json.sid || ctx.sid,
    qs: json.qs,
    _sign: json._sign,
    callback: json.callback,
    serviceParam: json.serviceParam || JSON.stringify({ checkSafePhone: false, checkSafeAddress: false, lsrp_score: 0 }),
  };
  return session.bootstrap;
}

async function finalizeAuthResponse(session, json) {
  if (json.code === 87001 || json.captchaUrl) {
    const captcha = await fetchCaptcha(session);
    return { ...captcha, message: '需要图形验证码' };
  }
  if (json.notificationUrl) {
    return {
      sessionId: session.id,
      needsVerification: true,
      notificationUrl: json.notificationUrl.startsWith('http')
        ? json.notificationUrl
        : `https://account.xiaomi.com${json.notificationUrl}`,
      message: '账号需要二次验证，请改用扫码登录，或在浏览器完成验证后再试',
    };
  }
  if (json.code !== 0 || !json.location) {
    throw new Error(json.description || json.desc || json.tips || `登录失败 (code=${json.code})`);
  }

  applyPollResult(session.jar, json);
  await followRedirectChain(session.jar, json.location, UA);
  if (!session.jar.isServiceTokenValid()) {
    await refreshServiceToken(session.jar, UA);
  }
  if (!session.jar.isPassTokenValid()) {
    throw new Error('登录完成但未获得 passToken');
  }
  session.jar.save();
  sessions.delete(session.id);
  return { ok: true };
}

async function postAuth2(session, fields) {
  if (!session.bootstrap) await bootstrapAuth(session);
  const body = new URLSearchParams({
    _json: 'true',
    sid: session.bootstrap.sid,
    qs: session.bootstrap.qs,
    _sign: session.bootstrap._sign,
    callback: session.bootstrap.callback,
    serviceParam: session.bootstrap.serviceParam,
    _locale: 'zh_CN',
    ...fields,
  });

  const resp = await fetch('https://account.xiaomi.com/pass/serviceLoginAuth2', {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'User-Agent': UA,
      Cookie: session.jar.toHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: '*/*',
    },
    body,
    signal: AbortSignal.timeout(20000),
  });
  session.jar.applyResponse(resp);
  const json = parseSsoJson(await resp.text());
  if (!json) throw new Error('登录响应解析失败');
  return finalizeAuthResponse(session, json);
}

async function loginWithPassword({ user, password, sessionId, icode }) {
  if (!user || !password) throw new Error('请输入账号和密码');
  const session = getSession(sessionId);
  await bootstrapAuth(session);
  const fields = {
    user: String(user).trim(),
    hash: md5Upper(password),
  };
  if (icode) fields.icode = String(icode).trim();
  return postAuth2(session, fields);
}

async function sendPhoneCode({ phone, sessionId, icode }) {
  const cleaned = String(phone || '').trim().replace(/\s+/g, '');
  if (!/^1\d{10}$/.test(cleaned) && !/^\+86\d{11}$/.test(cleaned)) {
    throw new Error('请输入正确的大陆手机号');
  }
  const session = getSession(sessionId);
  await bootstrapAuth(session);

  const user = cleaned.startsWith('+') ? cleaned : cleaned;
  const body = new URLSearchParams({
    _json: 'true',
    user,
    phone: user,
    sid: session.bootstrap.sid,
    addressType: '2',
  });
  if (icode) body.set('icode', String(icode).trim());

  const resp = await fetch('https://account.xiaomi.com/pass/sendPhoneTicket', {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Cookie: session.jar.toHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: '*/*',
    },
    body,
    signal: AbortSignal.timeout(15000),
  });
  session.jar.applyResponse(resp);
  const json = parseSsoJson(await resp.text());
  if (!json) throw new Error('发送验证码失败');

  if (json.code === 87001 || json.captchaUrl) {
    const captcha = await fetchCaptcha(session);
    return { ...captcha, message: '需要图形验证码后再发送短信' };
  }
  if (json.code !== 0 && json.result !== 'ok') {
    throw new Error(json.tips || json.description || json.desc || `发送失败 (code=${json.code})`);
  }

  return {
    ok: true,
    sessionId: session.id,
    phone: user,
    message: '验证码已发送',
  };
}

async function loginWithPhone({ phone, ticket, sessionId, icode }) {
  if (!phone || !ticket) throw new Error('请输入手机号和短信验证码');
  const session = getSession(sessionId);
  await bootstrapAuth(session);
  const user = String(phone).trim();
  const fields = {
    user,
    ticket: String(ticket).trim(),
  };
  if (icode) fields.icode = String(icode).trim();
  return postAuth2(session, fields);
}

async function refreshCaptcha(sessionId) {
  const session = getSession(sessionId);
  return fetchCaptcha(session);
}

module.exports = {
  loginWithPassword,
  sendPhoneCode,
  loginWithPhone,
  refreshCaptcha,
};
