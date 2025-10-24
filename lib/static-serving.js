const fs = require('fs');
const path = require('path');

const fsPromises = fs.promises;

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

async function resolveFileSystemAsset(baseDir, requestPath, defaultDocument = 'index.html') {
  const { path: candidatePath, error } = resolveStaticAssetPath(baseDir, requestPath);
  if (!candidatePath) {
    return { path: null, error, stats: null };
  }

  try {
    const stats = await fsPromises.stat(candidatePath);
    if (stats.isDirectory()) {
      const indexPath = path.join(candidatePath, defaultDocument);
      try {
        const indexStats = await fsPromises.stat(indexPath);
        if (indexStats.isFile()) {
          return { path: indexPath, error: null, stats: indexStats };
        }
        return { path: null, error: null, stats: null };
      } catch (indexErr) {
        if (indexErr && indexErr.code === 'ENOENT') {
          return { path: null, error: null, stats: null };
        }
        throw indexErr;
      }
    }

    if (stats.isFile()) {
      return { path: candidatePath, error: null, stats };
    }

    return { path: null, error: null, stats: null };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { path: null, error: null, stats: null };
    }
    throw err;
  }
}

module.exports = {
  ERROR_FORBIDDEN,
  ERROR_INVALID,
  normalizeRequestPath,
  resolveFileSystemAsset,
  resolveStaticAssetPath,
};
