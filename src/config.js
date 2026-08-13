const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, 'data');

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function dataPath(...parts) {
  ensureDataDir();
  return path.join(DATA_DIR, ...parts);
}

const PORT = (() => {
  const n = Number.parseInt(process.env.PORT || '9990', 10);
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : 9990;
})();

const HOST = process.env.HOST || '0.0.0.0';

module.exports = {
  ROOT,
  DATA_DIR,
  PORT,
  HOST,
  ensureDataDir,
  dataPath,
  DIST_DIR: path.join(ROOT, 'web', 'dist'),
  COOKIES_FILE: () => dataPath('cookies.json'),
  META_FILE: () => dataPath('meta.json'),
  LOG_FILE: () => dataPath('server.log'),
};
