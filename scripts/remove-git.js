import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { loadConfig } from './lib/config.js';

/**
 * pull로 같이 딸려온 운영 서버측 .git(개발서버에 원래 있던 빈 저장소)을 로컬에서 제거
 *
 * localRoot 안에 .git이 있으면 git이 그 폴더를 서브모듈처럼 취급해
 * git add 가 "does not have a commit checked out" 로 막힌다.
 * npx sftp-kit pull 실행 시 bin/cli.js가 자동으로 이어서 실행한다.
 */
function main() {
  const cfg = loadConfig();
  const target = join(cfg.localRoot, '.git');

  if (!existsSync(target)) {
    console.log(`[remove-git] 없음 — 정리할 것 없음 (${target})`);
    return;
  }

  rmSync(target, { recursive: true, force: true });
  console.log(`[remove-git] 삭제 완료: ${target}`);
}

main();
