/**
 * Test script: verify passToken → serviceToken refresh flow.
 * Usage: node test-refresh.js [--force]
 */
const {
  getJar,
  reloadJar,
  getAuthStatus,
  testRefresh,
  getUserAgent,
  cookiesToHeader,
  USAGE_URL,
} = require('./src/auth');

const force = process.argv.includes('--force');

async function callUsage(cookies) {
  const resp = await fetch(USAGE_URL, {
    headers: {
      Cookie: cookiesToHeader(cookies),
      'User-Agent': getUserAgent(),
      Accept: '*/*',
      'Content-Type': 'application/json',
      Referer: 'https://platform.xiaomimimo.com/console/plan-manage',
    },
    signal: AbortSignal.timeout(15000),
  });
  return { status: resp.status, ok: resp.ok };
}

async function main() {
  console.log('=== Xiaomi Token Refresh Test ===\n');
  reloadJar();
  const jar = getJar();
  const status = getAuthStatus();

  if (!status.loggedIn) {
    console.log('[FAIL] 未登录。请打开面板扫码登录。');
    process.exit(1);
  }

  console.log('--- Current Cookie Status ---');
  console.log(`passToken valid: ${status.loggedIn}`);
  console.log(`serviceToken valid: ${status.serviceTokenValid}`);
  console.log();

  if (!force) {
    console.log('--- Testing current serviceToken ---');
    try {
      const r1 = await callUsage(jar.cookies);
      console.log(`API response: ${r1.status} (${r1.ok ? 'OK' : 'FAIL'})`);
      if (r1.ok) {
        console.log('\n[OK] Current serviceToken is still valid.');
        process.exit(0);
      }
    } catch (e) {
      console.log(`API request failed: ${e.message}`);
    }
    console.log();
  }

  console.log('--- Attempting token refresh ---');
  const refreshResult = await testRefresh();
  console.log(`Refresh result: ${refreshResult.ok ? 'SUCCESS' : 'FAILED'}`);
  console.log(`Method: ${refreshResult.method || 'none'}`);
  if (refreshResult.error) console.log(`Errors: ${refreshResult.error}`);

  if (!refreshResult.ok) {
    console.log('[FAIL] Refresh failed. Please login via panel.');
    process.exit(1);
  }

  reloadJar();
  const r2 = await callUsage(getJar().cookies);
  console.log(`Verify API: ${r2.status} (${r2.ok ? 'OK' : 'FAIL'})`);
  process.exit(r2.ok ? 0 : 1);
}

main().catch(e => {
  console.error('Test crashed:', e);
  process.exit(1);
});
