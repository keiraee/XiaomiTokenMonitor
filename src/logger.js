const fs = require('fs');
const { LOG_FILE, ensureDataDir } = require('./config');

const BOM = '\uFEFF';

function ensureLogFile() {
  ensureDataDir();
  const file = LOG_FILE();
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, BOM);
  }
  return file;
}

function timestamp() {
  return new Date().toLocaleString('zh-CN', { hour12: false });
}

function write(level, msg) {
  const line = `[${timestamp()}] [${level}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(ensureLogFile(), `${line}\n`);
  } catch (e) {
    console.error(`写日志失败: ${e.message}`);
  }
}

module.exports = {
  info: (msg) => write('INFO', msg),
  warn: (msg) => write('WARN', msg),
  error: (msg) => write('ERROR', msg),
  get LOG_FILE() {
    return LOG_FILE();
  },
};
