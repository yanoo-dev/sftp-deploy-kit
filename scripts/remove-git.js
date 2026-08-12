import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { loadConfig } from './lib/config.js';

/**
 * pull로 같이 딸려온 운영 서버측 .git(개발서버에 원래 있던 빈 저장소)을 로컬에서 제거
 *
 * workspaces/html 안에 .git이 있으면 git이 그 폴더를 서브모듈처럼 취급해
 * git add 가 "does not have a commit checked out" 로 막힌다.
 * 사용: npm run pull 다음에 항상 실행 (npm run pull && npm run remove-git)
 */
function main() {
  const cfg = loadConfig();
  const target = join(cfg.localRoot || 'workspaces/html', '.git');

  if (!existsSync(target)) {
    console.log(`[remove-git] 없음 — 정리할 것 없음 (${target})`);
    return;
  }

  rmSync(target, { recursive: true, force: true });
  console.log(`[remove-git] 삭제 완료: ${target}`);
}

main();
