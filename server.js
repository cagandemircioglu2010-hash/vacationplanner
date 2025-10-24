const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const url = require('url');
const net = require('net');
const tls = require('tls');
const { once } = require('events');

const {
  ERROR_FORBIDDEN,
  resolveStaticAssetPath,
} = require('./lib/static-serving');

const fetchFn = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;

function loadEnvFromFile() {
  const envPath = path.join(__dirname, '.env');
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return;
      }
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) {
        return;
      }
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    });
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('Unable to load .env file:', err.message);
    }
  }
}

loadEnvFromFile();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

const port = Number(process.env.PORT) || 3000;
const staticDir = path.join(__dirname, 'site_fixed_patch');
const fallbackIndexPath = path.join(staticDir, 'index.html');
const FALLBACK_TOKEN_TTL_MS = 30 * 60 * 1000;

function sanitizeHeader(value) {
  return String(value || '').replace(/\r/g, '').replace(/\n/g, ' ').trim();
}

function normalizeNewlines(content) {
  return content.replace(/\r?\n/g, '\r\n');
}

function dotStuff(content) {
  return content.replace(/(^|\r\n)\./g, '$1..');
}

function buildMimeMessage({ from, to, subject, text, html }) {
  const headers = [];
  headers.push(`From: ${sanitizeHeader(from)}`);
  headers.push(`To: ${sanitizeHeader(Array.isArray(to) ? to.join(', ') : to)}`);
  headers.push(`Subject: ${sanitizeHeader(subject)}`);
  headers.push(`Message-ID: <${Date.now()}-${Math.random().toString(16).slice(2)}@vacationplanner>`);
  headers.push(`Date: ${new Date().toUTCString()}`);
  headers.push('MIME-Version: 1.0');

  let body = '';
  if (text && html) {
    const boundary = `----=_Part_${Math.random().toString(16).slice(2)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const plainPart = normalizeNewlines(text);
    const htmlPart = normalizeNewlines(html);
    body = `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${plainPart}\r\n` +
      `--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${htmlPart}\r\n` +
      `--${boundary}--`;
  } else if (html) {
    headers.push('Content-Type: text/html; charset=utf-8');
    headers.push('Content-Transfer-Encoding: 7bit');
    body = normalizeNewlines(html);
  } else {
    headers.push('Content-Type: text/plain; charset=utf-8');
    headers.push('Content-Transfer-Encoding: 7bit');
    body = normalizeNewlines(text || '');
  }

  const message = `${headers.join('\r\n')}\r\n\r\n${body}`;
  return dotStuff(message);
}

function createResponseReader(socket) {
  let buffer = '';
  let lines = [];
  const queue = [];
  let closed = false;

  const failPending = (err) => {
    while (queue.length) {
      queue.shift().reject(err);
    }
  };

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    processBuffer();
  });

  socket.on('error', (err) => {
    failPending(err);
  });

  socket.on('close', () => {
    if (!closed) {
      failPending(new Error('SMTP connection closed'));
      closed = true;
    }
  });

  function processBuffer() {
    while (true) {
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) {
        return;
      }
      const line = buffer.slice(0, newlineIndex + 1);
      buffer = buffer.slice(newlineIndex + 1);
      lines.push(line);
      if (line.length >= 4 && line[3] === ' ') {
        const response = lines.join('');
        lines = [];
        if (queue.length) {
          queue.shift().resolve(response);
        }
      }
    }
  }

  return () => new Promise((resolve, reject) => {
    queue.push({ resolve, reject });
    processBuffer();
  });
}

async function sendCommand(socket, command) {
  await new Promise((resolve, reject) => {
    socket.write(command, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function sendSmtpMail(options) {
  const host = options.host;
  const port = Number(options.port) || (options.secure ? 465 : 587);
  const preferTls = options.secure || port === 465;
  const allowInsecure = options.allowInsecure || false;
  const clientName = options.clientName || os.hostname() || 'localhost';

  let socket = preferTls
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port });

  await once(socket, preferTls ? 'secureConnect' : 'connect');
  let activeSocket = socket;
  let reader = createResponseReader(activeSocket);

  try {
    let response = await reader();
    if (!response.startsWith('220')) {
      throw new Error(`SMTP greeting failed: ${response.trim()}`);
    }

    await sendCommand(activeSocket, `EHLO ${clientName}\r\n`);
    response = await reader();
    const capabilities = response.toUpperCase();

    if (!preferTls) {
      if (capabilities.includes('STARTTLS')) {
        await sendCommand(activeSocket, 'STARTTLS\r\n');
        response = await reader();
        if (!response.startsWith('220')) {
          throw new Error(`STARTTLS failed: ${response.trim()}`);
        }
        activeSocket.removeAllListeners();
        activeSocket = tls.connect({ socket: activeSocket, servername: host });
        await once(activeSocket, 'secureConnect');
        reader = createResponseReader(activeSocket);
        await sendCommand(activeSocket, `EHLO ${clientName}\r\n`);
        response = await reader();
      } else if (!allowInsecure) {
        throw new Error('SMTP server does not support STARTTLS and insecure delivery is disabled.');
      }
    }

    if (options.user && options.pass) {
      await sendCommand(activeSocket, 'AUTH LOGIN\r\n');
      response = await reader();
      if (!response.startsWith('334')) {
        throw new Error(`SMTP AUTH not accepted: ${response.trim()}`);
      }
      await sendCommand(activeSocket, `${Buffer.from(options.user).toString('base64')}\r\n`);
      response = await reader();
      if (!response.startsWith('334')) {
        throw new Error(`SMTP username rejected: ${response.trim()}`);
      }
      await sendCommand(activeSocket, `${Buffer.from(options.pass).toString('base64')}\r\n`);
      response = await reader();
      if (!response.startsWith('235')) {
        throw new Error(`SMTP password rejected: ${response.trim()}`);
      }
    }

    await sendCommand(activeSocket, `MAIL FROM:<${sanitizeHeader(options.fromAddress)}>\r\n`);
    response = await reader();
    if (!response.startsWith('250')) {
      throw new Error(`MAIL FROM rejected: ${response.trim()}`);
    }

    const recipients = Array.isArray(options.to) ? options.to : [options.to];
    for (const rcpt of recipients) {
      await sendCommand(activeSocket, `RCPT TO:<${sanitizeHeader(rcpt)}>\r\n`);
      response = await reader();
      if (!response.startsWith('250')) {
        throw new Error(`RCPT TO rejected: ${response.trim()}`);
      }
    }

    await sendCommand(activeSocket, 'DATA\r\n');
    response = await reader();
    if (!response.startsWith('354')) {
      throw new Error(`DATA command rejected: ${response.trim()}`);
    }

    const message = buildMimeMessage({
      from: options.from,
      to: recipients,
      subject: options.subject,
      text: options.text,
      html: options.html
    });

    await sendCommand(activeSocket, `${message}\r\n.\r\n`);
    response = await reader();
    if (!response.startsWith('250')) {
      throw new Error(`Message not accepted: ${response.trim()}`);
    }

    await sendCommand(activeSocket, 'QUIT\r\n');
    await reader();
  } finally {
    if (activeSocket && !activeSocket.destroyed) {
      activeSocket.end();
    }
  }
}

function getEmailConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || (process.env.SMTP_SECURE === 'true' ? 465 : 587));
  const secureEnv = (process.env.SMTP_SECURE || '').toLowerCase();
  const secure = secureEnv === 'true' || (!secureEnv && port === 465);
  const allowInsecure = (process.env.SMTP_ALLOW_INSECURE || '').toLowerCase() === 'true';
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  const from = process.env.EMAIL_FROM || '';
  const fromName = process.env.EMAIL_FROM_NAME || '';
  if (!host || !port || !from) {
    return null;
  }
  if ((user && !pass) || (!user && pass)) {
    throw new Error('Both SMTP_USER and SMTP_PASS must be provided together.');
  }
  return { host, port, secure, allowInsecure, user, pass, from, fromName };
}

function getSupabaseConfig() {
  const url = (process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_KEY
    || process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_ANON_KEY
    || '').trim();
  if (!url || !key) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return { url: `${parsed.origin}${parsed.pathname.replace(/\/?$/, '')}`, key };
  } catch (err) {
    console.error('Invalid Supabase URL configuration:', err);
    return null;
  }
}

function createFallbackResetRecord(email, token, reason) {
  const record = {
    email,
    token,
    expires_at: new Date(Date.now() + FALLBACK_TOKEN_TTL_MS).toISOString(),
    __source: 'fallback'
  };
  if (reason) {
    record.__reason = reason;
  }
  return record;
}

async function fetchResetTokenRecord(email, token) {
  const config = getSupabaseConfig();
  if (!config) {
    console.warn('Supabase configuration missing; using fallback reset token validation.');
    return createFallbackResetRecord(email, token, 'config-missing');
  }

  if (!fetchFn) {
    console.warn('Fetch API unavailable; using fallback reset token validation.');
    return createFallbackResetRecord(email, token, 'fetch-missing');
  }

  const params = new URLSearchParams({
    select: 'email,token,expires_at',
    email: `eq.${email}`,
    token: `eq.${token}`,
    limit: '1'
  });

  const endpoint = `${config.url}/rest/v1/reset_tokens?${params.toString()}`;

  let response;
  try {
    response = await fetchFn(endpoint, {
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        Accept: 'application/json',
        Prefer: 'return=representation'
      }
    });
  } catch (err) {
    console.warn('Unable to contact Supabase for reset token validation:', err);
    return createFallbackResetRecord(email, token, 'request-failed');
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.warn(`Supabase token lookup failed (status ${response.status}). Proceeding with fallback validation.`, text);
    return createFallbackResetRecord(email, token, `status-${response.status}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (err) {
    console.warn('Unable to parse Supabase token response. Proceeding with fallback validation.');
    return createFallbackResetRecord(email, token, 'response-invalid');
  }

  if (!Array.isArray(payload) || payload.length === 0) {
    return null;
  }
  return payload[0];
}

function getPreferredProto(req) {
  const forwarded = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (forwarded === 'http' || forwarded === 'https') {
    return forwarded;
  }
  return (req.socket?.encrypted || req.connection?.encrypted) ? 'https' : 'http';
}

function getPreferredHost(req) {
  const forwarded = (req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwarded || (req.headers.host || '').trim();
  if (!host) {
    return null;
  }
  const sanitized = host.replace(/[^A-Za-z0-9.:\[\]-]/g, '');
  if (!sanitized) {
    return null;
  }
  return sanitized;
}

function getResetLinkBase(req) {
  const configured = (process.env.RESET_LINK_BASE_URL || process.env.PUBLIC_APP_ORIGIN || '').trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch (err) {
      console.warn('Invalid RESET_LINK_BASE_URL/PUBLIC_APP_ORIGIN value. Falling back to request host.');
    }
  }
  const host = getPreferredHost(req);
  if (!host) {
    return null;
  }
  const proto = getPreferredProto(req);
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch (err) {
    console.error('Unable to construct reset link origin:', err);
    return null;
  }
}

function buildResetLink(req, email, token) {
  const base = getResetLinkBase(req);
  if (!base) {
    return null;
  }
  const pathSetting = (process.env.RESET_LINK_PATH || '/logpage.html').trim();
  const pathValue = pathSetting.startsWith('/') ? pathSetting : `/${pathSetting}`;
  try {
    const resetUrl = new URL(pathValue, `${base}/`);
    resetUrl.searchParams.set('email', email);
    resetUrl.searchParams.set('token', token);
    return resetUrl.toString();
  } catch (err) {
    console.error('Unable to build password reset link:', err);
    return null;
  }
}

function normalizeProvidedResetUrl(candidate, email, token, builtLink) {
  if (typeof candidate !== 'string') {
    return null;
  }
  const trimmed = candidate.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (builtLink) {
      try {
        const allowed = new URL(builtLink);
        if (parsed.origin !== allowed.origin) {
          return null;
        }
      } catch {}
    }
    if (email) {
      parsed.searchParams.set('email', email);
    }
    if (token) {
      parsed.searchParams.set('token', token);
    }
    return parsed.toString();
  } catch (err) {
    return null;
  }
}

function normalizeResetRequestPath(pathname) {
  if (typeof pathname !== 'string') {
    return '';
  }
  const suffix = '/api/reset/request';
  const trimmed = pathname.replace(/\/+$/, '') || '/';
  if (trimmed === suffix) {
    return suffix;
  }
  if (trimmed.endsWith(suffix)) {
    return suffix;
  }
  return trimmed;
}

async function sendResetEmail(email, token, resetUrl) {
  const config = getEmailConfig();
  if (!config) {
    const error = new Error('Email service is not configured.');
    error.code = 'EMAIL_NOT_CONFIGURED';
    throw error;
  }
  const fromHeader = config.fromName ? `${config.fromName} <${config.from}>` : config.from;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  const formattedExpiry = expiresAt.toUTCString();
  let safeResetUrl = null;
  if (typeof resetUrl === 'string') {
    try {
      const parsed = new URL(resetUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        safeResetUrl = parsed.toString();
      }
    } catch {}
  }
  const textBody = `You requested to reset your Vacation Planner password.\n\n` +
    `Your reset code is: ${token}\n\n` +
    `Enter this code within 30 minutes to choose a new password.${safeResetUrl ? `\n\nYou can also reset your password using this link: ${safeResetUrl}` : ''}\n\n` +
    `If you did not request this change, you can ignore this email.`;
  const htmlBody = `<p>You requested to reset your <strong>Vacation Planner</strong> password.</p>` +
    `<p><strong>Your reset code:</strong> <code style="font-size:1.1rem;">${token}</code></p>` +
    `<p>Enter this code within 30 minutes to choose a new password.</p>` +
    `${safeResetUrl ? `<p>You can also <a href="${safeResetUrl}">reset your password using this link</a>.</p>` : ''}` +
    `<p>If you did not request this change, you can ignore this email.</p>` +
    `<p><small>This code expires at ${formattedExpiry}.</small></p>`;

  await sendSmtpMail({
    host: config.host,
    port: config.port,
    secure: config.secure,
    allowInsecure: config.allowInsecure,
    user: config.user,
    pass: config.pass,
    from: fromHeader,
    fromAddress: config.from,
    to: email,
    subject: 'Vacation Planner password reset',
    text: textBody,
    html: htmlBody
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function serveStaticFile(res, filePath, method) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stats.size });
    if (method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('error', () => {
      res.end();
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new url.URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const normalizedResetPath = normalizeResetRequestPath(parsedUrl.pathname);
    if (req.method === 'POST' && normalizedResetPath === '/api/reset/request') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        sendJson(res, 400, { message: 'Invalid request body.' });
        return;
      }
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      const token = typeof body?.token === 'string' ? body.token.trim() : '';
      if (!email || !token) {
        sendJson(res, 400, { message: 'Email and token are required.' });
        return;
      }
      try {
        const record = await fetchResetTokenRecord(email, token);
        if (!record) {
          sendJson(res, 400, { message: 'Reset token is invalid or does not exist.' });
          return;
        }
        const recordEmail = typeof record.email === 'string' && record.email.trim()
          ? record.email.trim().toLowerCase()
          : email;
        const effectiveToken = typeof record.token === 'string' && record.token.trim()
          ? record.token.trim()
          : token;
        if (!/^[A-Za-z0-9_-]{8,}$/.test(effectiveToken)) {
          sendJson(res, 400, { message: 'Reset token is invalid or does not exist.' });
          return;
        }
        const expiresAtMs = record.expires_at ? Date.parse(record.expires_at) : NaN;
        if (Number.isNaN(expiresAtMs) || expiresAtMs < Date.now()) {
          sendJson(res, 400, { message: 'Reset token has expired. Please request a new one.' });
          return;
        }

        const builtResetLink = buildResetLink(req, recordEmail, effectiveToken);
        const providedResetUrl = normalizeProvidedResetUrl(body?.resetUrl, recordEmail, effectiveToken, builtResetLink);
        const resetLink = providedResetUrl || builtResetLink;
        await sendResetEmail(recordEmail, effectiveToken, resetLink);
        sendJson(res, 200, { ok: true });
      } catch (err) {
        if (err.code === 'EMAIL_NOT_CONFIGURED') {
          sendJson(res, 503, { message: err.message });
        } else {
          console.error('Unable to send reset email:', err);
          sendJson(res, 500, { message: 'Unable to send reset email.' });
        }
      }
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      const { path: safePath, error } = resolveStaticAssetPath(staticDir, parsedUrl.pathname);
      if (!safePath) {
        const status = error === ERROR_FORBIDDEN ? 403 : 400;
        res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(status === 403 ? 'Forbidden' : 'Bad request');
        return;
      }

      fs.access(safePath, fs.constants.F_OK, (err) => {
        if (err) {
          serveStaticFile(res, fallbackIndexPath, req.method);
        } else {
          serveStaticFile(res, safePath, req.method);
        }
      });
      return;
    }

    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed');
  } catch (err) {
    console.error('Server error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end('Internal server error');
  }
});

server.listen(port, () => {
  console.log(`Vacation Planner server listening on port ${port}`);
});
