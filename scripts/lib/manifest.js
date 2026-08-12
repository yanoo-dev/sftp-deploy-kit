import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import {
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { loadNoUploadPatterns, isBlocked } from './no-upload.js';

/**
 * 운영 배포 manifest를 읽고 files + directories를 실제 파일 목록으로 확장한다.
 *
 * directories는 localRoot 기준 상대경로이며, 내부 파일을 재귀로 모두 포함한다.
 * 반환되는 files는 중복 제거 후 POSIX 경로(`/`)로 정렬된다.
 */
export function loadDeployManifest(manifestPath, fallbackLocalRoot, options = {}) {
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest 없음: ${manifestPath}`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const localRoot = manifest.localRoot || fallbackLocalRoot;
  const files = new Set();

  for (const file of manifest.files || []) {
    files.add(normalizeRelativePath(file));
  }

  for (const directory of manifest.directories || []) {
    const relDir = normalizeRelativePath(directory);
    const absoluteDir = resolveInsideRoot(localRoot, relDir);

    if (!existsSync(absoluteDir)) {
      throw new Error(`manifest directory 없음: ${relDir} (${absoluteDir})`);
    }
    if (!statSync(absoluteDir).isDirectory()) {
      throw new Error(`manifest directory가 폴더가 아님: ${relDir}`);
    }

    for (const absoluteFile of collectFiles(absoluteDir)) {
      files.add(toPosix(relative(resolve(localRoot), absoluteFile)));
    }
  }

  const patterns = loadNoUploadPatterns();
  const resolved = [...files].sort();
  const blocked = resolved.filter((f) => isBlocked(f, patterns));
  const safeFiles = resolved.filter((f) => !isBlocked(f, patterns));

  if (blocked.length > 0 && !options.quiet) {
    console.warn(`\n⛔ 배포 제외 — 다른 사람이 작업 중입니다 (deploy/no-upload.txt, ${blocked.length}개)`);
    blocked.forEach((f) => console.warn(`  ⛔ ${f}`));
    console.warn('');
  }

  return {
    ...manifest,
    localRoot,
    files: safeFiles,
  };
}

function collectFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory).sort()) {
    const absolute = join(directory, entry);
    const stat = statSync(absolute);

    if (stat.isDirectory()) {
      files.push(...collectFiles(absolute));
    } else if (stat.isFile()) {
      files.push(absolute);
    }
  }

  return files;
}

function normalizeRelativePath(value) {
  const normalized = toPosix(String(value || '').trim()).replace(/^\/+/, '');

  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`manifest 경로가 안전하지 않음: ${value}`);
  }

  return normalized;
}

function resolveInsideRoot(localRoot, relativePath) {
  const root = resolve(localRoot);
  const target = resolve(root, relativePath);

  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error(`localRoot 밖의 경로는 사용할 수 없음: ${relativePath}`);
  }

  return target;
}

function toPosix(value) {
  return value.split(sep).join('/');
}

/**
 * --only 로 지정된 부분집합만 남긴다
 *
 * 콤마로 구분된 상대경로 목록을 받아 manifest 파일 목록 중 그것만 남긴다.
 * only 가 없으면 원본 그대로 반환. manifest 에 없는 경로를 요청하면 에러(오타 방지).
 */
export function filterOnly(files, only) {
  if (!only) {
    return files;
  }

  const requested = only.split(',').map((s) => s.trim()).filter(Boolean);
  const fileSet = new Set(files);
  const unknown = requested.filter((rel) => !fileSet.has(rel));

  if (unknown.length > 0) {
    throw new Error(`manifest 에 없는 경로: ${unknown.join(', ')}`);
  }

  return requested;
}
