#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 이 CLI 파일 자신의 위치 — 패키지 안 실제 스크립트를 찾기 위한 기준.
// 명령을 실행하는 사용자 프로젝트(process.cwd())와는 별개다.
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const COMMANDS = {
  pull: 'scripts/sftp-pull.js',
  upload: 'scripts/upload.js',
  'upload:changed': 'scripts/upload-changed.js',
  track: 'scripts/git-track.js',
  'deploy:check': 'scripts/deploy-check.js',
  'deploy:backup': 'scripts/deploy-backup.js',
  deploy: 'scripts/deploy.js',
  'deploy:rollback': 'scripts/deploy-rollback.js',
  'remove-git': 'scripts/remove-git.js',
  'sftp:auto': 'scripts/sftp-auto.js',
};

const [, , cmd, ...rest] = process.argv;

if (!cmd || !COMMANDS[cmd]) {
  console.error('사용법: sftp-deploy-kit <명령어> [옵션]\n');
  console.error('사용 가능한 명령어:');
  for (const name of Object.keys(COMMANDS)) {
    console.error(`  ${name}`);
  }
  process.exit(1);
}

// 자식 프로세스: 실행 파일은 패키지 안에서 찾되(PACKAGE_ROOT),
// 작업 디렉토리는 명령을 실행한 사용자 프로젝트(process.cwd())를 그대로 물려준다.
const result = spawnSync(
  process.execPath,
  [join(PACKAGE_ROOT, COMMANDS[cmd]), ...rest],
  { stdio: 'inherit', env: process.env },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
