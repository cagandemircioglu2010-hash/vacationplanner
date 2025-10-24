const test = require('node:test');
const assert = require('node:assert/strict');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

function createSmtpServer({ key, cert, interactions }) {
  const server = tls.createServer({ key, cert }, (socket) => {
    socket.write('220 test.smtp.local ESMTP\r\n');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      while (true) {
        const idx = buffer.indexOf('\r\n');
        if (idx === -1) break;
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        interactions.push(line);
        if (line.startsWith('EHLO')) {
          socket.write('250-test.smtp.local greets you\r\n');
          socket.write('250 AUTH LOGIN\r\n');
        } else if (line.startsWith('AUTH LOGIN')) {
          socket.write('334 VXNlcm5hbWU6\r\n');
        } else if (line === Buffer.from('apikey').toString('base64')) {
          socket.write('334 UGFzc3dvcmQ6\r\n');
        } else if (line === Buffer.from('secret').toString('base64')) {
          socket.write('235 Authentication successful\r\n');
        } else if (line.startsWith('MAIL FROM')) {
          socket.write('250 OK\r\n');
        } else if (line.startsWith('RCPT TO')) {
          socket.write('250 Accepted\r\n');
        } else if (line === 'DATA') {
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (line === '.') {
          socket.write('250 Stored\r\n');
        } else if (line === 'QUIT') {
          socket.write('221 Bye\r\n');
          socket.end();
        }
      }
    });
  });
  return server;
}

test('password reset emails can opt-out of TLS validation for development SMTP servers', async (t) => {
  const keyPath = path.join(__dirname, 'fixtures', 'selfsigned-key.pem');
  const certPath = path.join(__dirname, 'fixtures', 'selfsigned-cert.pem');
  const key = fs.readFileSync(keyPath);
  const cert = fs.readFileSync(certPath);
  const interactions = [];
  const smtpServer = createSmtpServer({ key, cert, interactions });
  await new Promise((resolve) => smtpServer.listen(0, '127.0.0.1', resolve));
  t.after(() => smtpServer.close());

  const smtpPort = smtpServer.address().port;
  const serverEnv = {
    ...process.env,
    PORT: '3300',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(smtpPort),
    SMTP_SECURE: 'true',
    SMTP_TLS_REJECT_UNAUTHORIZED: 'false',
    SMTP_USER: 'apikey',
    SMTP_PASS: 'secret',
    EMAIL_FROM: 'no-reply@example.com',
    EMAIL_FROM_NAME: 'Tester',
  };

  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: serverEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());

  await new Promise((resolve, reject) => {
    const onData = (chunk) => {
      if (chunk.toString().includes('listening')) {
        child.stdout.off('data', onData);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk) => {
      // Surface server errors to the test output to ease debugging.
      process.stderr.write(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`server exited with code ${code}`)));
  });

  const payload = JSON.stringify({ email: 'user@example.com', token: 'abcd1234' });
  const response = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: Number(serverEnv.PORT),
      path: '/api/reset/request',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true });
  assert.ok(interactions.includes('AUTH LOGIN'));
});
