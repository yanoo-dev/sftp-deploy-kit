import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { uploadFiles } from './lib/sftp.js';
import { loadConfig } from './lib/config.js';
import { parseFlags, requireFlags, firstPositional } from './lib/args.js';
import { loadDeployManifest, filterOnly } from './lib/manifest.js';
import { confirmUpload } from './lib/confirm-upload.js';

/**
 * manifest 에 명시된 파일만 운영 서버로 업로드한다
 *
 * 반드시 로컬 소스 폴더(cfg.localRoot, .vscode/sftp.json 의 context 로 설정) 안의
 * 파일만 대상으로 하며, 업로드 전 모든 로컬 파일 존재를 먼저 검증한다(부분 업로드 방지).
 */
async function main() {
  const v = parseFlags(['page', 'only', 'quiet']);
  v.page = v.page || firstPositional();
  requireFlags(v, ['page'],
    'npx sftp-kit deploy --page=sample-page [--only=path1,path2]');

  const manifestPath = join('deploy', `${v.page}.deploy.json`);
  if (!existsSync(manifestPath)) {
    console.error(`manifest 없음: ${manifestPath}`);
    process.exit(1);
  }

  const cfg = loadConfig();
  const manifest = loadDeployManifest(manifestPath, cfg.localRoot, { quiet: v.quiet !== undefined });
  manifest.files = filterOnly(manifest.files, v.only);
  // localRoot/remoteRoot 는 manifest 에 있으면 우선, 없으면 sftp.json(.env) 에서
  const localRoot = manifest.localRoot;

  // 사전 검증 — 하나라도 없으면 업로드 시작 안 함
  const missing = manifest.files.filter((rel) => !existsSync(join(localRoot, rel)));
  if (missing.length > 0) {
    console.error(`로컬에 없는 파일이 있어 중단합니다:\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }

  const remoteRoot = String(manifest.remoteRoot || cfg.remoteRoot || '').replace(/\/+$/, '');
  if (!remoteRoot) {
    console.error('remoteRoot 를 찾을 수 없습니다 (manifest 또는 sftp.json/.env).');
    process.exit(1);
  }

  await confirmUpload(manifest.files, remoteRoot);

  const entries = manifest.files.map((rel) => ({
    local: join(localRoot, rel),
    remote: `${remoteRoot}/${rel}`,
  }));
  const uploaded = [];
  await uploadFiles(entries, (local, remote) => {
    console.log(`  올림: ${local} → ${remote}`);
    uploaded.push(remote);
  });

  // 업로드 직후 "마지막으로 실제 배포한 내용"을 별도 기준점에 저장한다.
  // deploy-backup.js의 드리프트 체크가 이 기준점과 비교하므로, 우리가 방금 올린
  // 내용 자체가 "원격이 바뀐 것"으로 오탐되는 문제를 막는다(직전 스냅샷은 배포 전
  // 상태라 배포 성공 직후엔 항상 달라 보이는 문제가 있었음).
  const lastDeployedRoot = join('backups', '.last-deployed');
  for (const rel of manifest.files) {
    const src = join(localRoot, rel);
    const dest = join(lastDeployedRoot, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }

  console.log(`\n✅ 업로드 완료 (${uploaded.length}개)`);
  uploaded.forEach((remote) => console.log(`  - ${remote}`));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
