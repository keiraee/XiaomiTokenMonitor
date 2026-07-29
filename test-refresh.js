/**
 * Test script: verify passToken → serviceToken refresh flow.
 * Usage: node test-refresh.js [--force]
 *   --force  Test refresh even if current serviceToken is still valid
 */
const {
  loadCookies,
  cookiesToHeader,
  isPassTokenValid,
  testRefresh,
  getUserAgent,
} = require('./src/auth');

const API_URL = 'https://platform.xiaomimimo.com/api/v1/tokenPlan/usage';
const force = process.argv.includes('--force');

async function callUsage(cookies) {
  const resp = await fetch(API_URL, {
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

  // Step 1: Check existing cookies
  const cookies = loadCookies();
  if (!cookies) {
    console.log('[FAIL] No cookies.json found. Please login first.');
    process.exit(1);
  }

  const passToken = cookies.find(c => c.name === 'passToken');
  const serviceToken = cookies.find(c => c.name === 'api-platform_serviceToken');

  console.log('--- Current Cookie Status ---');
  console.log(`passToken:      ${passToken ? 'present (expires: ' + new Date(passToken.expires * 1000).toLocaleString() + ')' : 'MISSING'}`);
  console.log(`serviceToken:   ${serviceToken ? 'present' : 'MISSING'}`);
  console.log(`passToken valid: ${isPassTokenValid(cookies)}`);
  console.log();

  // Step 2: Try calling API with current cookies
  if (!force) {
    console.log('--- Testing current serviceToken ---');
    try {
      const r1 = await callUsage(cookies);
      console.log(`API response: ${r1.status} (${r1.ok ? 'OK' : 'FAIL'})`);
      if (r1.ok) {
        console.log('\n[OK] Current serviceToken is still valid. No refresh needed.');
        console.log('     Use --force to test the refresh flow anyway.');
        process.exit(0);
      }
    } catch (e) {
      console.log(`API request failed: ${e.message}`);
    }
    console.log();
  } else {
    console.log('--- Skipping current token check (--force) ---\n');
  }

  // Step 3: Try refresh
  console.log('--- Attempting token refresh ---');
  const refreshResult = await testRefresh();
  console.log(`Refresh result: ${refreshResult.ok ? 'SUCCESS' : 'FAILED'}`);
  console.log(`Method: ${refreshResult.method || 'none'}`);
  if (refreshResult.error) console.log(`Errors: ${refreshResult.error}`);
  if (refreshResult.serviceToken) console.log(`New serviceToken: ${refreshResult.serviceToken}`);
  console.log();

  if (!refreshResult.ok) {
    console.log('[FAIL] All refresh methods failed. Manual login required.');
    process.exit(1);
  }

  // Step 4: Verify new token works
  console.log('--- Verifying new serviceToken ---');
  const newCookies = loadCookies();
  try {
    const r2 = await callUsage(newCookies);
    console.log(`API response: ${r2.status} (${r2.ok ? 'OK' : 'FAIL'})`);
    if (r2.ok) {
      console.log('\n[PASS] Refresh successful and new serviceToken works!');
    } else {
      console.log(`\n[FAIL] Refresh succeeded but API returned ${r2.status}`);
      process.exit(1);
    }
  } catch (e) {
    console.log(`\n[FAIL] API request failed after refresh: ${e.message}`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Test crashed:', e);
  process.exit(1);
});
