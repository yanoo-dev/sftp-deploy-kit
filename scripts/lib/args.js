import { parseArgs } from 'node:util';

// --force/--quiet는 프로젝트 전체에서 항상 값 없이 bare flag로만 쓰인다
// (--force=xxx 형태 없음) — node:util parseArgs는 type:'string'인 옵션에
// 값이 안 붙어있으면 (strict:false에서도) 조용히 무시하므로, 반드시 boolean 타입이어야
// bare --force가 실제로 인식된다. 이걸 놓쳐서 --force가 deploy-backup.js 드리프트
// 체크에서 매번 무시되던 버그가 있었음(2026-07-27 발견).
const BOOLEAN_FLAGS = new Set(['force', 'quiet']);

/**
 * --key=value 형태의 CLI 인자를 객체로 파싱
 *
 * force/quiet를 제외한 모든 값을 문자열 옵션으로 받는다. 누락 검증은 호출부에서 한다.
 */
export function parseFlags(keys) {
  const options = {};
  for (const key of keys) {
    options[key] = BOOLEAN_FLAGS.has(key) ? { type: 'boolean' } : { type: 'string' };
  }
  const { values } = parseArgs({ args: process.argv.slice(2), options, strict: false });
  return values;
}

/**
 * `--` 로 시작하지 않는 첫 번째 위치 인자를 반환
 *
 * `npm run deploy -- gj-lms --only=a,b` 처럼 --page= 를 생략하고
 * 위치 인자로 페이지명만 짧게 쓸 수 있게 해준다.
 */
export function firstPositional() {
  return process.argv.slice(2).find((arg) => !arg.startsWith('--'));
}

/**
 * 필수 인자 누락 시 즉시 종료
 *
 * 누락된 키를 모아 사용법과 함께 출력하고 프로세스를 끝낸다.
 */
export function requireFlags(values, required, usage) {
  const missing = required.filter((k) => !values[k]);
  if (missing.length > 0) {
    console.error(`누락된 인자: ${missing.map((k) => `--${k}`).join(', ')}`);
    if (usage) {
      console.error(`사용법: ${usage}`);
    }
    process.exit(1);
  }
}
