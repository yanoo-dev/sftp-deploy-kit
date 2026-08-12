import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIST_PATH = join(ROOT, 'deploy', 'no-upload.txt');

/**
 * deploy/no-upload.txt 를 읽어 패턴 목록을 반환한다
 *
 * 파일명 또는 `*` 와일드카드 패턴 한 줄씩. `#` 주석과 빈 줄은 무시.
 */
export function loadNoUploadPatterns() {
  if (!existsSync(LIST_PATH)) {
    return [];
  }
  return readFileSync(LIST_PATH, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function toRegex(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/**
 * 상대경로가 no-upload 패턴 중 하나라도 매칭되면 true
 *
 * 파일명(basename)과 전체 상대경로 양쪽에 대해 매칭한다.
 */
export function isBlocked(relPath, patterns) {
  const basename = relPath.split('/').pop();
  return patterns.some((pattern) => {
    const re = toRegex(pattern);
    return re.test(basename) || re.test(relPath);
  });
}
