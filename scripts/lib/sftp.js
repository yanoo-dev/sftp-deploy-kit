import SftpClient from 'ssh2-sftp-client';
import { sftpConfig } from './env.js';

/**
 * 연결된 SFTP 클라이언트를 만들고 콜백 실행 후 반드시 종료
 *
 * 작업 함수에 client 를 넘겨 주고, 성공/실패와 무관하게 연결을 닫는다.
 */
export async function withSftp(run) {
  const client = new SftpClient();
  await client.connect(sftpConfig());
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

const UPLOAD_BATCH_SIZE = 5;
const UPLOAD_DELAY_MS = 300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * (local, remote) 쌍을 순서대로 업로드한다
 *
 * 이 서버는 한 SFTP 세션에서 연속 쓰기를 6~7개 이상 하면 이후 요청을
 * "Permission denied"로 거부하는 현상이 확인됐다(2026-07-08). 회피책으로
 * 일정 개수마다 연결을 새로 맺고, 파일 사이에 짧은 지연을 둔다.
 * onEach 는 각 파일 업로드 직후 호출된다(로그 출력용).
 */
export async function uploadFiles(entries, onEach) {
  for (let start = 0; start < entries.length; start += UPLOAD_BATCH_SIZE) {
    const batch = entries.slice(start, start + UPLOAD_BATCH_SIZE);
    await withSftp(async (client) => {
      for (const { local, remote } of batch) {
        const remoteDir = remote.slice(0, remote.lastIndexOf('/'));
        if (!(await client.exists(remoteDir))) {
          await client.mkdir(remoteDir, true);
        }
        await client.fastPut(local, remote);
        if (onEach) {
          onEach(local, remote);
        }
        await sleep(UPLOAD_DELAY_MS);
      }
    });
  }
}
