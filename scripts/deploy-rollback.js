import { join, relative, sep } from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { uploadFiles } from './lib/sftp.js';
import { loadConfig } from './lib/config.js';
import { parseFlags, firstPositional } from './lib/args.js';
import { filterOnly, resolvePageName } from './lib/manifest.js';
import { confirmUpload } from './lib/confirm-upload.js';

/**
 * 디렉토리 하위의 모든 파일 절대경로를 재귀로 모은다
 *
 * 디렉토리는 결과에 넣지 않고 파일만 반환한다.
 */
function collectFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

/**
 * 백업본을 운영 서버로 되돌린다
 *
 * backups/{backupId}/ 의 모든 파일을 deploy/{page}.deploy.json 의 remoteRoot 기준
 * 동일 상대경로로 업로드한다. --backup 미지정 시 backups/ 의 가장 최근 폴더를 쓴다.
 */
async function main() {
  const v = parseFlags(['page', 'backup', 'only']);
  v.page = resolvePageName(v.page || firstPositional(),
    'npx sftp-kit deploy:rollback --page=sample-page [--backup=YYYYMMDD_HHMMSS] [--only=path1,path2]');

  const baseDir = 'backups';
  if (!existsSync(baseDir)) {
    console.error('백업 폴더(backups/)가 없습니다.');
    process.exit(1);
  }

  // --backup 미지정 시 폴더명 사전순 최댓값 = 가장 최근(타임스탬프 포맷이 정렬가능)
  const ids = readdirSync(baseDir).filter((n) => statSync(join(baseDir, n)).isDirectory()).sort();
  const backupId = v.backup || ids[ids.length - 1];
  if (!backupId) {
    console.error('복원할 백업 스냅샷이 없습니다.');
    process.exit(1);
  }

  const snapshotDir = join(baseDir, backupId);
  if (!existsSync(snapshotDir)) {
    console.error(`지정한 백업이 없습니다: ${snapshotDir}`);
    process.exit(1);
  }

  const manifestPath = join('deploy', `${v.page}.deploy.json`);
  if (!existsSync(manifestPath)) {
    console.error(`manifest 없음: ${manifestPath}`);
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const cfg = loadConfig();
  const remoteRoot = String(manifest.remoteRoot || cfg.remoteRoot || '').replace(/\/+$/, '');
  if (!remoteRoot) {
    console.error('remoteRoot 를 찾을 수 없습니다 (manifest 또는 sftp.json/.env).');
    process.exit(1);
  }

  // 스냅샷 디렉토리 재귀 수집
  const allFiles = collectFiles(snapshotDir).map((abs) => relative(snapshotDir, abs).split(sep).join('/'));
  const files = filterOnly(allFiles, v.only);

  await confirmUpload(files, remoteRoot, '복원');

  const entries = files.map((rel) => ({
    local: join(snapshotDir, rel),
    remote: `${remoteRoot}/${rel}`,
  }));
  const restored = [];
  await uploadFiles(entries, (local, remote) => {
    console.log(`  복원: ${local} → ${remote}`);
    restored.push(remote);
  });

  console.log(`\n✅ 복원 완료 (backupId ${backupId}, ${restored.length}개)`);
  restored.forEach((remote) => console.log(`  - ${remote}`));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
