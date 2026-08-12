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

  if (answer.trim().toLowerCase() !== 'y') {
    console.log(`[${label}] 취소됨 — 진행하지 않았습니다.`);
    process.exit(0);
  }
}
