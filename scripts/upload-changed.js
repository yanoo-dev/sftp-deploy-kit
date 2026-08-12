import 'dotenv/config';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.js';
import { loadDeployManifest } from './lib/manifest.js';
import { bumpCacheBusting } from './lib/cache-bust.js';

// PROJECT_ROOT: 사용자 프로젝트(process.cwd()) — deploy/, git status 전부 사용자 쪽 기준
// PACKAGE_ROOT: 이 스크립트 자신의 위치 — 형제 스크립트(git-track.js 등)를 spawn 하기 위한 기준
const PROJECT_ROOT = process.cwd();
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const deployDir = join(PROJECT_ROOT, 'deploy');

/**
 * 워킹트리 기준으로 "지금 바뀐 파일"만 자동으로 골라 업로드한다
 *
 * 사용:
 *   npm run upload:changed
 *   npm run upload:changed -- gj-lms   (manifest가 여러 개일 때 지정)
 *
 * 커밋은 "완료된 것"만 남기는 용도라 업로드 트리거로 안 쓴다. 대신
 * git status(스테이징+비스테이징+신규, 삭제 제외)로 지금 바뀐 파일을 구하고,
 * 배포 매니페스트에 실제 포함된 것만 걸러 --only= 로 기존 업로드 체인
 * (track → check → backup → deploy)에 그대로 넘긴다.
 */
function main() {
  const manifests = getManifestNames();
  const argv = process.argv.slice(2);
  const positional = argv.find((a) => !a.startsWith('--'));
  const force = argv.includes('--force');
  const page = resolveManifestName(manifests, positional);
  const cfg = loadConfig();

  const manifest = loadDeployManifest(join(deployDir, `${page}.deploy.json`), cfg.localRoot, { quiet: true });
  const manifestFiles = new Set(manifest.files);
  const localRoot = manifest.localRoot.replace(/\\/g, '/').replace(/\/+$/, '');

  const changed = getWorkingTreeChangedFiles();
  const target = changed
    .map((repoRelPath) => toManifestRelative(repoRelPath, localRoot))
    .filter((relPath) => relPath && manifestFiles.has(relPath));

  let unique = [...new Set(target)];

  if (unique.length === 0) {
    console.log('[upload:changed] 업로드할 변경 파일 없음 (매니페스트에 해당하는 변경 없음)');
    return;
  }

  // 캐시버스팅 자동 갱신 — 바뀐 CSS/JS를 참조하는 HTML의 ?time= 값을 자동으로 오늘 시각으로 바꾸고
  // 그 HTML도 업로드 대상에 같이 넣는다(안 넣으면 서버 HTML은 예전 버전 번호 그대로 남음).
  const { touched, version } = bumpCacheBusting(manifest.localRoot, manifest.files, unique);
  if (touched.length > 0) {
    console.log(`[upload:changed] 캐시버스팅 자동 갱신(${version}): ${touched.join(', ')}`);
    unique = [...new Set([...unique, ...touched])];
  }

  console.log(`[upload:changed] 배포 묶음: ${page}`);
  console.log(`[upload:changed] 변경 파일 ${unique.length}개:`);
  unique.forEach((f) => console.log(`  - ${f}`));
  console.log('[upload:changed] 순서: track → check → backup → deploy\n');

  const onlyArg = `--only=${unique.join(',')}`;
  const forceArgs = force ? ['--force'] : [];

  runNodeScript('scripts/git-track.js');
  runNodeScript('scripts/deploy-check.js', `--page=${page}`, onlyArg, '--quiet');
  runNodeScript('scripts/deploy-backup.js', `--page=${page}`, onlyArg, '--quiet', ...forceArgs);
  runNodeScript('scripts/deploy.js', `--page=${page}`, onlyArg, '--quiet');

  console.log(`\n[upload:changed] 완료: ${page} (${unique.length}개)`);
}

function getManifestNames() {
  return readdirSync(deployDir)
    .filter((name) => name.endsWith('.deploy.json'))
    .map((name) => name.replace(/\.deploy\.json$/, ''))
    .sort();
}

function resolveManifestName(manifests, requested) {
  if (manifests.length === 0) {
    throw new Error('deploy/*.deploy.json manifest가 없습니다.');
  }
  if (requested) {
    if (!manifests.includes(requested)) {
      throw new Error(`manifest를 찾을 수 없습니다: ${requested}\n사용 가능: ${manifests.join(', ')}`);
    }
    return requested;
  }
  if (manifests.length === 1) {
    return manifests[0];
  }
  throw new Error(
    `manifest가 여러 개입니다. npm run upload:changed -- <이름>\n사용 가능: ${manifests.join(', ')}`,
  );
}

/**
 * git status(워킹트리, 스테이징+비스테이징+신규)로 바뀐 파일 경로를 구한다.
 * 순수 삭제(D)는 업로드 대상이 아니므로 제외한다.
 */
function getWorkingTreeChangedFiles() {
  const output = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
  });

  const files = [];

  for (const line of output.split('\n')) {
    if (!line) continue;

    const status = line.slice(0, 2);
    let path = line.slice(3);

    if (path.includes(' -> ')) {
      path = path.split(' -> ')[1];
    }

    if (status.includes('D')) continue;

    files.push(path.trim());
  }

  return files;
}

function toManifestRelative(repoRelPath, localRoot) {
  const normalized = repoRelPath.replace(/\\/g, '/');
  const prefix = `${localRoot}/`;

  if (!normalized.startsWith(prefix)) {
    return null;
  }

  return normalized.slice(prefix.length);
}

function runNodeScript(script, ...args) {
  const result = spawnSync(process.execPath, [join(ROOT, script), ...args], {
    cwd: ROOT,
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

main();
