import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { withSftp } from './lib/sftp.js';
import { loadConfig, resolveUploadRoot } from './lib/config.js';
import { parseFlags, firstPositional } from './lib/args.js';
import { loadDeployManifest, filterOnly, resolvePageName } from './lib/manifest.js';

/**
 * 정렬 가능한 타임스탬프(YYYYMMDD_HHMMSS) 생성
 *
 * 백업 스냅샷 식별자(backupId) = backups/ 아래 폴더명으로 쓰인다.
 * 사전순 정렬 = 시간순 정렬이 되도록 0 패딩한다.
 */
function makeStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * 배포 전 원격 원본을 backups/{backupId}/ 로 내려받는다
 *
 * deploy/{page}.deploy.json 의 files 각각을 remoteRoot 기준으로 받아
 * backups/{backupId}/ 아래 동일 상대경로로 저장한다. 롤백 기준이 된다.
 * backupId 는 기본 자동 생성하며, --backup 으로 폴더명을 직접 지정할 수 있다(테스트/수동).
 *
 * "마지막으로 실제 배포한 내용"(backups/.last-deployed/, deploy.js가 업로드 성공 직후 기록)과
 * 비교해, 우리가 모르는 사이 원격이 바뀐 파일(=다른 사람이 이미 올림)이 있으면 배포를 막는다.
 * (예전엔 직전 백업 스냅샷과 비교했는데, 그 스냅샷은 "배포 전" 상태라 우리가 방금 성공적으로
 * 배포한 직후엔 항상 달라 보이는 오탐이 있었음 — 그래서 별도의 "배포 후" 기준점을 둠)
 * --force 로만 경고를 무시하고 계속 진행할 수 있다.
 * 완료 후에는 이전 deploy 백업을 정리해 최신 1개만 남긴다 (initial_/backup_/.last-deployed 는 보존).
 */
async function main() {
  const v = parseFlags(['page', 'backup', 'force', 'only', 'quiet']);
  v.page = resolvePageName(v.page || firstPositional(),
    'npx sftp-kit deploy:backup --page=sample-page [--backup=YYYYMMDD_HHMMSS] [--force] [--only=path1,path2]');

  const force = v.force !== undefined;
  const backupId = v.backup || makeStamp();

  const manifestPath = join('deploy', `${v.page}.deploy.json`);
  if (!existsSync(manifestPath)) {
    console.error(`manifest 없음: ${manifestPath}`);
    process.exit(1);
  }

  const cfg = loadConfig();
  const manifest = loadDeployManifest(manifestPath, cfg.localRoot, { quiet: v.quiet !== undefined });
  manifest.files = filterOnly(manifest.files, v.only);
  const remoteRoot = resolveUploadRoot(manifest, cfg);
  if (!remoteRoot) {
    console.error('remoteRoot 를 찾을 수 없습니다 (manifest 또는 sftp.json/.env).');
    process.exit(1);
  }
  const backupsRoot = 'backups';
  const backupDir = join(backupsRoot, backupId);
  const lastDeployedRoot = join(backupsRoot, '.last-deployed');

  let saved = 0;
  const drifted = [];
  await withSftp(async (client) => {
    for (const rel of manifest.files) {
      const remote = `${remoteRoot}/${rel}`;
      const local = join(backupDir, rel);
      const exists = await client.exists(remote);
      if (!exists) {
        console.log(`  - 원격에 없음(신규 파일로 간주): ${remote}`);
        continue;
      }
      mkdirSync(dirname(local), { recursive: true });
      await client.fastGet(remote, local);
      console.log(`  백업: ${remote} → ${local}`);
      saved += 1;

      const lastDeployedFile = join(lastDeployedRoot, rel);
      if (existsSync(lastDeployedFile) && !readFileSync(lastDeployedFile).equals(readFileSync(local))) {
        drifted.push(rel);
      }
    }
  });

  if (drifted.length > 0) {
    console.error('\n⚠️  원격이 우리가 마지막으로 배포한 내용 이후 바뀐 파일이 있습니다 — 다른 사람이 이미 올렸을 수 있습니다:');
    drifted.forEach((rel) => console.error(`   - ${rel}`));
    if (!force) {
      console.error(`\n내용을 확인한 뒤 계속하려면: npx sftp-kit deploy:backup --page=${v.page} --force`);
      process.exit(1);
    }
    console.error('\n--force 지정됨 — 경고만 남기고 계속 진행합니다.');
  }

  // 이전 deploy 백업 정리 — 최신 1개만 남긴다 (initial_/backup_/.gitkeep/.last-deployed 는 보존)
  const stalePrevious = readdirSync(backupsRoot).filter(
    (name) => name !== backupId && name !== '.gitkeep' && name !== '.last-deployed'
      && !name.startsWith('initial_') && !name.startsWith('backup_'),
  );
  for (const name of stalePrevious) {
    rmSync(join(backupsRoot, name), { recursive: true, force: true });
  }

  console.log(`\n✅ backupId: ${backupId}  (page: ${v.page})`);
  console.log(`   위치: ${backupDir}`);
  console.log(`   저장: ${saved}개 (원격 부재 제외)`);
  if (stalePrevious.length > 0) {
    console.log(`   정리: 이전 deploy 백업 ${stalePrevious.length}개 삭제`);
  }
  console.log(`   롤백: npx sftp-kit deploy:rollback --page=${v.page} --backup=${backupId}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
