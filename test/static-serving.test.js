const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ERROR_FORBIDDEN,
  ERROR_INVALID,
  resolveFileSystemAsset,
  resolveStaticAssetPath,
} = require('../lib/static-serving');

const STATIC_DIR = path.join(__dirname, '..', 'site_fixed_patch');

function relativeToStatic(relative) {
  return path.resolve(STATIC_DIR, relative);
}

test('resolves root index requests', () => {
  const { path: resolved, error } = resolveStaticAssetPath(STATIC_DIR, '/');
  assert.equal(error, null);
  assert.equal(resolved, relativeToStatic('index.html'));
});

test('normalizes sub-path index routes', () => {
  const { path: resolved, error } = resolveStaticAssetPath(STATIC_DIR, '/docs/');
  assert.equal(error, null);
  assert.equal(resolved, relativeToStatic('docs/index.html'));
});

test('normalizes directory requests without trailing slash', () => {
  const { path: resolved, error } = resolveStaticAssetPath(STATIC_DIR, '/docs');
  assert.equal(error, null);
  assert.equal(resolved, relativeToStatic('docs'));
});

test('prevents directory traversal', () => {
  const attempt = resolveStaticAssetPath(STATIC_DIR, '/../server.js');
  assert.equal(attempt.error, ERROR_FORBIDDEN);
  assert.equal(attempt.path, null);
});

test('prevents encoded directory traversal', () => {
  const attempt = resolveStaticAssetPath(STATIC_DIR, '/%2e%2e/%2e%2e/etc/passwd');
  assert.equal(attempt.error, ERROR_FORBIDDEN);
  assert.equal(attempt.path, null);
});

test('rejects malformed encodings', () => {
  const attempt = resolveStaticAssetPath(STATIC_DIR, '/%ZZ');
  assert.equal(attempt.error, ERROR_INVALID);
  assert.equal(attempt.path, null);
});

test('allows normal file resolution', () => {
  const attempt = resolveStaticAssetPath(STATIC_DIR, '/logpage.html');
  assert.equal(attempt.error, null);
  assert.equal(attempt.path, relativeToStatic('logpage.html'));
});

test('resolveFileSystemAsset returns directory index when available', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-static-'));
  try {
    const nestedDir = path.join(tempRoot, 'docs');
    fs.mkdirSync(nestedDir, { recursive: true });
    const indexPath = path.join(nestedDir, 'index.html');
    fs.writeFileSync(indexPath, '<h1>Docs</h1>');

    const result = await resolveFileSystemAsset(tempRoot, '/docs');
    assert.equal(result.error, null);
    assert.equal(result.path, indexPath);
    assert.ok(result.stats && typeof result.stats.size === 'number');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveFileSystemAsset keeps extensionless files intact', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-static-'));
  try {
    const tokenPath = path.join(tempRoot, 'acme-challenge');
    fs.writeFileSync(tokenPath, 'token');

    const result = await resolveFileSystemAsset(tempRoot, '/acme-challenge');
    assert.equal(result.error, null);
    assert.equal(result.path, tokenPath);
    assert.ok(result.stats && result.stats.isFile());
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
