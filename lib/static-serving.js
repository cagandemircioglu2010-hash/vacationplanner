const path = require('path');

const ERROR_INVALID = 'invalid';
const ERROR_FORBIDDEN = 'forbidden';

function normalizeRequestPath(requestPath) {
  if (typeof requestPath !== 'string') {
    return null;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch (err) {
    return null;
  }
  let normalized = decoded;
  if (normalized.endsWith('/')) {
    normalized += 'index.html';
  }
  if (normalized === '/index') {
    normalized = '/index.html';
  }
  return normalized;
}

function resolveStaticAssetPath(baseDir, requestPath) {
  if (!baseDir || typeof baseDir !== 'string') {
    throw new TypeError('baseDir must be a non-empty string');
  }
  const normalizedRequest = normalizeRequestPath(requestPath);
  if (!normalizedRequest) {
    return { path: null, error: ERROR_INVALID };
  }
  const relativePath = normalizedRequest.replace(/^\/+/, '');
  const normalizedBase = path.resolve(baseDir);
  const candidatePath = path.resolve(normalizedBase, relativePath);
  if (candidatePath === normalizedBase || candidatePath.startsWith(`${normalizedBase}${path.sep}`)) {
    return { path: candidatePath, error: null };
  }
  return { path: null, error: ERROR_FORBIDDEN };
}

module.exports = {
  ERROR_FORBIDDEN,
  ERROR_INVALID,
  normalizeRequestPath,
  resolveStaticAssetPath,
};
