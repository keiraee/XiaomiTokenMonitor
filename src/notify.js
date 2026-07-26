const { execFile } = require('child_process');

function notify(title, message) {
  const recipient = process.env.USERNAME || '*';
  execFile('msg', [recipient, '/TIME:10', `${title}\n\n${message}`], (err) => {
    if (err) console.error('通知发送失败:', err.message);
    else console.log(`通知已发送: ${title}`);
  });
}

module.exports = { notify };
