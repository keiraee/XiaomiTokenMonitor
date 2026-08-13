export async function api(path, options = {}) {
  const resp = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(data.message || data.error || `HTTP ${resp.status}`);
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const getStatus = () => api('/api/status');
export const getUsage = () => api('/api/usage');
export const refreshAuth = () => api('/api/refresh', { method: 'POST', body: '{}' });
export const logout = () => api('/api/logout', { method: 'POST', body: '{}' });
export const startQr = () => api('/api/login/qr/start', { method: 'POST', body: '{}' });
export const qrStatus = (id) => api(`/api/login/qr/status/${id}`);
export const cancelQr = (sessionId) => api('/api/login/qr/cancel', {
  method: 'POST',
  body: JSON.stringify({ sessionId }),
});
export const loginPassword = (payload) => api('/api/login/password', {
  method: 'POST',
  body: JSON.stringify(payload),
});
export const sendPhoneCode = (payload) => api('/api/login/phone/send', {
  method: 'POST',
  body: JSON.stringify(payload),
});
export const verifyPhone = (payload) => api('/api/login/phone/verify', {
  method: 'POST',
  body: JSON.stringify(payload),
});
export const refreshCaptcha = (sessionId) => api('/api/login/captcha/refresh', {
  method: 'POST',
  body: JSON.stringify({ sessionId }),
});
