#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 이 CLI 파일 자신의 위치 — 패키지 안 실제 스크립트를 찾기 위한 기준.
// 명령을 실행하는 사용자 프로젝트(process.cwd())와는 별개다.
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const COMMANDS = {
  init: 'scripts/init.js',
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
  'hook:install': 'scripts/hook-install.js',
};

const USAGE = {
  init: '설정 파일(.vscode/sftp.json, deploy/*.deploy.json, .env) 대화형 생성',
  pull: 'remoteRoot 전체 미러링 [--paths="a,b"] [--exclude="a,b" — sftp.json pullExclude 를 덮어씀(경고)]',
  upload: '매니페스트 전체 업로드',
  'upload:changed': '변경분 자동 감지 → 업로드 [<매니페스트이름>] [--force]',
  track: '매니페스트 디렉토리를 .gitignore 추적 예외로 등록',
  'deploy:check': '로컬 파일 존재 여부만 점검 --page=<이름> [--only=a,b]',
  'deploy:backup': '드리프트 체크 + 백업 --page=<이름> [--only=a,b] [--force]',
  deploy: '매니페스트 기준 실제 업로드 --page=<이름> [--only=a,b]',
  'deploy:rollback': '백업 스냅샷으로 서버 복원 --page=<이름> [--backup=<id>]',
  'remove-git': '서버측 .git 잔여물 제거',
  'sftp:auto': 'VS Code downloadOnOpen 토글 on|off|status',
  'hook:install': 'pre-commit 훅 설치(업로드 안 된 변경 커밋 차단) [--force]',
};

/**
 * 사용법 출력
 *
 * 명령어가 없거나 모르는 명령어, 또는 --help/-h 가 어디에든 있으면 실행 없이 이것만 찍는다.
 * 예전엔 `sftp-kit pull --help` 가 플래그를 무시하고 전체 pull 을 그대로 실행했다.
 */
function printUsage(only) {
  console.error('사용법: sftp-kit <명령어> [옵션]   (--help 로 이 안내만 출력)\n');
  for (const name of Object.keys(COMMANDS)) {
    if (only && name !== only) {
      continue;
    }
    console.error(`  ${name.padEnd(16)} ${USAGE[name]}`);
  }
}

const [, , cmd, ...rest] = process.argv;
const wantsHelp = !cmd || cmd === 'help' || cmd === '--help' || cmd === '-h' || rest.includes('--help') || rest.includes('-h');

if (wantsHelp) {
  printUsage(COMMANDS[cmd] ? cmd : null);
  process.exit(cmd ? 0 : 1);
}

if (!COMMANDS[cmd]) {
  console.error(`알 수 없는 명령어: ${cmd}\n`);
  printUsage(null);
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

// pull은 일부 파일을 건너뛰어도(한글 파일명 인코딩 문제 등) exit code 1로 끝날 수 있다 —
// 그래도 받은 파일들 사이에 서버측 .git 잔여물이 있을 수 있으니 정리는 항상 시도하고,
// 원래의 실패 상태(pull이 몇 개 건너뛰었는지)는 그대로 유지해서 최종 exit code로 보고한다.
if (cmd === 'pull') {
  const cleanup = spawnSync(
    process.execPath,
    [join(PACKAGE_ROOT, COMMANDS['remove-git']), ...rest],
    { stdio: 'inherit', env: process.env },
  );
  if (cleanup.error) {
    console.error(cleanup.error.message);
    process.exit(1);
  }
  process.exit(result.status !== 0 ? (result.status ?? 1) : (cleanup.status ?? 1));
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

process.exit(0);
