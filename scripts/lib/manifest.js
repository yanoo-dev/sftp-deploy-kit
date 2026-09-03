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
    blocked,
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
 * --page 없이 호출됐을 때 deploy/ 안 manifest가 하나뿐이면 자동으로 그걸 쓴다
 *
 * upload.js/upload-changed.js는 원래 이 자동 해석을 갖고 있었는데
 * deploy/deploy-check/deploy-backup/deploy-rollback 4개는 --page를 항상
 * 강제해서 매니페스트가 하나뿐인 프로젝트에서도 매번 --page를 붙여야 했다.
 * 그 불일치를 없애기 위해 공통으로 뺀 것 — requested가 있으면 존재 여부만
 * 검증하고, 없으면 개수에 따라 자동/에러 처리한다.
 */
export function resolvePageName(requested, usage) {
  const deployDir = 'deploy';
  if (!existsSync(deployDir)) {
    console.error(`deploy 폴더 없음: ${deployDir}`);
    process.exit(1);
  }

  const manifests = readdirSync(deployDir)
    .filter((name) => name.endsWith('.deploy.json'))
    .map((name) => name.replace(/\.deploy\.json$/, ''))
    .sort();

  if (requested) {
    if (!manifests.includes(requested)) {
      console.error(`manifest를 찾을 수 없습니다: ${requested}\n사용 가능: ${manifests.join(', ')}`);
      process.exit(1);
    }
    return requested;
  }

  if (manifests.length === 1) {
    return manifests[0];
  }

  if (manifests.length === 0) {
    console.error('deploy/*.deploy.json manifest가 없습니다.');
  } else {
    console.error(`manifest가 여러 개입니다. --page로 지정하세요.\n사용법: ${usage}\n사용 가능: ${manifests.join(', ')}`);
  }
  process.exit(1);
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
