const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');

const { ERROR_FORBIDDEN, resolveFileSystemAsset } = require('./lib/static-serving');

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

function streamFile(res, filePath, method, stats) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  const headers = { 'Content-Type': mime };
  if (stats && typeof stats.size === 'number') {
    headers['Content-Length'] = stats.size;
  }
  res.writeHead(200, headers);
  if (method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  stream.on('error', (err) => {
    console.error('Stream error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end('Internal server error');
  });
}

const server = http.createServer((req, res) => {
  try {
    const parsedUrl = new url.URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' || req.method === 'HEAD') {
      (async () => {
        const asset = await resolveFileSystemAsset(staticDir, parsedUrl.pathname);

        if (!asset.path) {
          if (asset.error) {
            const status = asset.error === ERROR_FORBIDDEN ? 403 : 400;
            res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(status === 403 ? 'Forbidden' : 'Bad request');
            return;
          }

          const fallback = await resolveFileSystemAsset(staticDir, '/');
          if (!fallback.path) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found');
            return;
          }

          streamFile(res, fallback.path, req.method, fallback.stats);
          return;
        }

        streamFile(res, asset.path, req.method, asset.stats);
      })().catch((err) => {
        console.error('Server error:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        }
        res.end('Internal server error');
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
