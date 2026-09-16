import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.js';

const PROJECT_ROOT = process.cwd();
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 프로젝트 .git/hooks/pre-commit 에 "업로드 안 된 변경 커밋 차단" 훅을 설치한다
 *
 * 로컬 소스 폴더명(.vscode/sftp.json 의 context)을 템플릿에 주입해서 쓴다.
 * 이미 훅이 있으면 --force 없이는 덮어쓰지 않는다(다른 훅 도구와 충돌 방지).
 */
function main() {
  const force = process.argv.includes('--force');
  const hooksDir = join(PROJECT_ROOT, '.git', 'hooks');
  if (!existsSync(join(PROJECT_ROOT, '.git'))) {
    console.error('[hook:install] .git 폴더가 없습니다 — git 저장소 루트에서 실행하세요.');
    process.exit(1);
  }

  const target = join(hooksDir, 'pre-commit');
  if (existsSync(target) && !force) {
    console.log('[hook:install] 이미 있음, 건너뜀: .git/hooks/pre-commit (덮어쓰려면 --force)');
    return;
  }

  const localRoot = loadConfig().localRoot.replace(/\/+$/, '');
  const template = readFileSync(join(PACKAGE_ROOT, 'hooks', 'pre-commit'), 'utf8');
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(target, template.replace('__LOCAL_ROOT__', localRoot), 'utf8');
  chmodSync(target, 0o755);
  console.log(`[hook:install] 설치: .git/hooks/pre-commit (localRoot: "${localRoot}")`);
}

main();
