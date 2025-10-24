const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  ERROR_FORBIDDEN,
  ERROR_INVALID,
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
