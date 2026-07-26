const { exec } = require('child_process');

function notify(title, message) {
  const text = `${title}\n\n${message}`;
  exec(`msg ${process.env.USERNAME || '*'} /TIME:10 "${text}"`, (err) => {
    if (err) console.error('通知发送失败:', err.message);
    else console.log(`通知已发送: ${title}`);
  });
}

module.exports = { notify };
