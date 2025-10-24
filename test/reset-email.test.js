const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');

function createFakeSmtpServer() {
  const messages = [];
  const waiters = [];
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    socket.write('220 localhost ESMTP\r\n');
    let buffer = '';
    let inData = false;

    function enqueue(message) {
      if (waiters.length) {
        waiters.shift()(message);
      } else {
        messages.push(message);
      }
    }

    socket.on('data', (chunk) => {
      buffer += chunk;
      while (true) {
        if (!inData) {
          const newlineIndex = buffer.indexOf('\n');
          if (newlineIndex === -1) {
            break;
          }
          let line = buffer.slice(0, newlineIndex + 1);
          buffer = buffer.slice(newlineIndex + 1);
          line = line.replace(/\r?\n$/, '');
          if (!line) {
            continue;
          }
          const upper = line.toUpperCase();
          if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
            socket.write('250 localhost\r\n');
          } else if (upper.startsWith('MAIL FROM')) {
            socket.write('250 OK\r\n');
          } else if (upper.startsWith('RCPT TO')) {
            socket.write('250 OK\r\n');
          } else if (upper.startsWith('DATA')) {
            socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
            inData = true;
          } else if (upper.startsWith('QUIT')) {
            socket.write('221 Bye\r\n');
            socket.end();
            break;
          } else {
            socket.write('250 OK\r\n');
          }
        } else {
          const endIndex = buffer.indexOf('\r\n.\r\n');
          if (endIndex === -1) {
            break;
          }
          const message = buffer.slice(0, endIndex);
          buffer = buffer.slice(endIndex + 5);
          inData = false;
          enqueue(message);
          socket.write('250 Accepted\r\n');
        }
      }
    });
  });

  function listen(port = 0) {
    return new Promise((resolve, reject) => {
      const onError = (err) => {
        server.removeListener('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        resolve(server.address());
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    });
  }

  function close() {
    return new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  function nextMessage() {
    if (messages.length) {
      return Promise.resolve(messages.shift());
    }
    return new Promise((resolve) => {
      waiters.push(resolve);
    });
  }

  return { listen, close, nextMessage, server };
}

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const tempServer = net.createServer();
    tempServer.listen(0, '127.0.0.1', () => {
      const { port } = tempServer.address();
      tempServer.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    tempServer.on('error', reject);
  });
}

async function waitForHttpServer(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { method: 'HEAD' });
      if (response.ok || response.status === 404) {
        return;
      }
    } catch {}
    await delay(100);
  }
  throw new Error('Server did not start in time');
}

test('reset request without token generates and emails a code', async (t) => {
  const smtp = createFakeSmtpServer();
  const address = await smtp.listen();
  const smtpPort = address.port;

  t.after(() => smtp.close());

  const httpPort = await getAvailablePort();
  const projectRoot = path.resolve(__dirname, '..');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(httpPort),
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtpPort),
      SMTP_ALLOW_INSECURE: 'true',
      EMAIL_FROM: 'no-reply@example.com'
    },
    stdio: ['ignore', 'ignore', 'ignore']
  });

  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      try {
        await once(child, 'exit');
      } catch {}
    }
  });

  await waitForHttpServer(httpPort, 8000);

  const response = await fetch(`http://127.0.0.1:${httpPort}/api/reset/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'integration@example.com' })
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload, { ok: true });

  const message = await Promise.race([
    smtp.nextMessage(),
    delay(5000).then(() => { throw new Error('Timed out waiting for SMTP message'); })
  ]);

  assert.match(message, /Your reset code is:/);
  const tokenMatch = message.match(/Your reset code is:\s*([A-Za-z0-9_-]+)/);
  assert.ok(tokenMatch && tokenMatch[1].length >= 8, 'reset token should be included in email');
  assert.match(message, /integration@example.com/);
});
