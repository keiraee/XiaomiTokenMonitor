const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'server.log');

function timestamp() {
  return new Date().toLocaleString('zh-CN', { hour12: false });
}

function formatMsg(level, msg) {
  return `[${timestamp()}] [${level}] ${msg}`;
}

function write(level, msg) {
  const line = formatMsg(level, msg);
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

module.exports = {
  info: (msg) => write('INFO', msg),
  warn: (msg) => write('WARN', msg),
  error: (msg) => write('ERROR', msg),
  LOG_FILE,
};
