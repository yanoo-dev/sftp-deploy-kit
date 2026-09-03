import { createInterface } from 'node:readline/promises';

/**
 * 업로드/복원 직전 대상 파일 목록을 보여주고 y 입력을 받는다 — 확인 없이는 진행하지 않는다.
 * 우회 옵션 없음(회귀 금지) — deploy/upload/upload:changed/rollback 어떤 경로로 와도 항상 여기서 확인받는다.
 */
export async function confirmUpload(files, remoteRoot, label = '업로드') {
  console.log(`\n📤 아래 ${files.length}개 파일을 서버로 ${label}합니다 (${remoteRoot}):`);
  files.forEach((rel) => console.log(`  - ${rel}`));

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\n이대로 ${label}할까요? (y/n): `);
  rl.close();

  // TTY도 없고 파이프로 흘려보낸 답도 없는 환경(예: 에이전트가 stdin 없이 실행하는 셸)에서는
  // rl.question()이 즉시 빈 문자열로 끝난다. 이걸 "확인 없이 실행됨"으로 오인하지 않도록 원인을
  // 명확히 알리고 실패로 끝낸다. `yes | ...`처럼 파이프로 실제 답을 흘려보낸 경우는 answer에
  // 값이 들어오므로 이 분기를 안 타고 정상적으로 아래 y/n 판정으로 넘어간다.
  if (answer === '' && !process.stdin.isTTY) {
    console.error(
      `[${label}] 비대화형 환경이라 확인 프롬프트에 응답할 수 없습니다.\n` +
        `  \`yes | <명령어>\`로 다시 실행하세요 (예: yes | npm run upload:changed).`,
    );
    process.exit(1);
  }

  if (answer.trim().toLowerCase() !== 'y') {
    console.log(`[${label}] 취소됨 — 진행하지 않았습니다.`);
    // 0(성공)으로 종료하면 이 스크립트를 자식 프로세스로 spawn한 상위 명령(upload:changed 등)이
    // "정상 완료"로 오인해 완료 로그를 찍어버린다 — 취소도 "안 끝난 것"이니 비정상 종료로 알림
    process.exit(1);
  }
}
