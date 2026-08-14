import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
} from 'node:fs';
import {
  dirname,
  join,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.js';
import { loadDeployManifest } from './lib/manifest.js';
import { bumpCacheBusting } from './lib/cache-bust.js';

// PROJECT_ROOT: 사용자 프로젝트(process.cwd()) — deploy/ 등 사용자 파일 기준
// PACKAGE_ROOT: 이 스크립트 자신의 위치 — 형제 스크립트(git-track.js 등)를 spawn 하기 위한 기준
// npm 패키지로 설치되면 이 둘이 서로 다른 경로가 되므로 반드시 분리해야 한다.
const PROJECT_ROOT = process.cwd();
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const deployDir = join(PROJECT_ROOT, 'deploy');

/**
 * manifest 기반 안전 업로드
 *
 * 사용:
 *   npx sftp-kit upload
 *   npx sftp-kit upload my-page
 *   npx sftp-kit upload my-page --only=css/theme.css,js/widget.js
 *
 * manifest가 하나면 이름을 생략할 수 있다.
 * 여러 개면 배포 묶음 이름을 명시해야 한다.
 * --only 를 주면 manifest 전체가 아니라 그 파일들만 배포한다(안전하게 소량씩 검증할 때).
 *
 * 실행 순서:
 *   git-track → deploy-check → deploy-backup → deploy
 */
function main() {
  const manifests = getManifestNames();
  const argv = process.argv.slice(2);
  const onlyArg = argv.find((a) => a.startsWith('--only='));
  const positional = argv.find((a) => !a.startsWith('--'));
  const requested = normalizeName(positional);
  const page = resolveManifestName(manifests, requested);
  const cfg = loadConfig();

  validateSftpConfig(cfg);

  console.log(`[upload] 배포 묶음: ${page}`);
  console.log(`[upload] 설정: ${cfg.source}`);
  if (onlyArg) {
    console.log(`[upload] ${onlyArg}`);
  }

  // 캐시버스팅 자동 갱신 — 업로드 대상 CSS/JS를 참조하는 HTML의 ?time= 값을 자동으로 오늘 시각으로 바꾼다.
  const manifest = loadDeployManifest(join(deployDir, `${page}.deploy.json`), cfg.localRoot);
  const targetList = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()) : manifest.files;
  const { touched, version } = bumpCacheBusting(manifest.localRoot, manifest.files, targetList);

  let onlyArgs = onlyArg ? [onlyArg] : [];
  if (touched.length > 0) {
    console.log(`[upload] 캐시버스팅 자동 갱신(${version}): ${touched.join(', ')}`);
    if (onlyArg) {
      const expanded = [...new Set([...targetList, ...touched])];
      onlyArgs = [`--only=${expanded.join(',')}`];
    }
  }

  const steps = cfg.skipGitTrack ? 'check → backup → deploy' : 'track → check → backup → deploy';
  console.log(`[upload] 순서: ${steps}\n`);

  if (!cfg.skipGitTrack) {
    runNodeScript('scripts/git-track.js');
  }
  runNodeScript('scripts/deploy-check.js', `--page=${page}`, ...onlyArgs);
  runNodeScript('scripts/deploy-backup.js', `--page=${page}`, ...onlyArgs);
  runNodeScript('scripts/deploy.js', `--page=${page}`, ...onlyArgs);

  console.log(`\n[upload] 완료: ${page}${onlyArg ? ' (일부만)' : ''}`);
}

function getManifestNames() {
  if (!existsSync(deployDir)) {
    throw new Error(`deploy 폴더 없음: ${deployDir}`);
  }

  return readdirSync(deployDir)
    .filter((name) => name.endsWith('.deploy.json'))
    .map((name) => name.replace(/\.deploy\.json$/, ''))
    .sort();
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .replace(/^--page=/, '')
    .replace(/\.deploy\.json$/, '');
}

function resolveManifestName(manifests, requested) {
  if (manifests.length === 0) {
    throw new Error('deploy/*.deploy.json manifest가 없습니다.');
  }

  if (requested) {
    if (!manifests.includes(requested)) {
      throw new Error(
        `manifest를 찾을 수 없습니다: ${requested}\n사용 가능: ${manifests.join(', ')}`,
      );
    }
    return requested;
  }

  if (manifests.length === 1) {
    return manifests[0];
  }

  throw new Error(
    `manifest가 여러 개입니다. 업로드할 묶음을 지정하세요.\n` +
    `사용법: npx sftp-kit upload <이름>\n` +
    `사용 가능: ${manifests.join(', ')}`,
  );
}

function validateSftpConfig(cfg) {
  const missing = [];

  if (!cfg.host) {
    missing.push('host');
  }
  if (!cfg.user) {
    missing.push('username');
  }
  if (!cfg.remoteRoot) {
    missing.push('remotePath');
  }
  if (!cfg.privateKeyPath && !cfg.password) {
    missing.push('password 또는 privateKeyPath');
  }

  if (missing.length > 0) {
    throw new Error(`SFTP 설정 부족 (${cfg.source}): ${missing.join(', ')}`);
  }
}

function runNodeScript(script, ...args) {
  const result = spawnSync(process.execPath, [join(PACKAGE_ROOT, script), ...args], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

try {
  main();
} catch (error) {
  console.error(`[upload] 중단: ${error.message}`);
  process.exit(1);
}
