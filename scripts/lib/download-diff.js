import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// 서버/로컬 시계 오차 보정 — 60초 이내 mtime 차이는 같은 파일로 간주
const MTIME_TOLERANCE_MS = 60 * 1000;

/**
 * 원격 항목 하나를 { isDirectory, size, mtimeMs } 공통 형태로 정규화한다
 *
 * FtpClientAdapter.list()는 basic-ftp FileInfo(.isDirectory 게터, .modifiedAt Date)를
 * 그대로 돌려주고, ssh2-sftp-client의 list()는 { type: 'd'|'-', modifyTime: ms숫자 }
 * 형태라 두 어댑터가 서로 다른 모양을 준다. 이 함수가 그 차이를 흡수한다.
 */
function normalizeEntry(entry) {
  const isDirectory = typeof entry.isDirectory === 'boolean' ? entry.isDirectory : entry.type === 'd';
  const mtimeMs = typeof entry.modifyTime === 'number'
    ? entry.modifyTime
    : (entry.modifiedAt ? entry.modifiedAt.getTime() : null);

  return { isDirectory, size: entry.size, mtimeMs };
}

/**
 * 로컬 파일이 원격과 같은지(크기+수정시각) 비교해 다시 받을지 정한다
 *
 * 로컬에 없으면 무조건 받는다. 있으면 크기가 다르거나 원격 수정시각이 로컬보다
 * MTIME_TOLERANCE_MS 넘게 앞서 있을 때만 다시 받고, 그 외엔 같은 파일로 보고 건너뛴다.
 */
function shouldDownload(localPath, size, mtimeMs) {
  if (!existsSync(localPath)) {
    return true;
  }

  const stat = statSync(localPath);

  if (stat.size !== size) {
    return true;
  }

  if (mtimeMs != null && mtimeMs - stat.mtimeMs > MTIME_TOLERANCE_MS) {
    return true;
  }

  return false;
}

/**
 * remoteDir을 localDir로 재귀 미러링하되, 로컬에 이미 같은 파일이 있으면 건너뛴다
 *
 * 기존 downloadDir()은 매번 원격 전체를 무조건 재전송했다(비교 로직 없음) —
 * 그래서 파일 수만 개짜리 사이트를 pull할 때마다 이미 받은 파일까지 처음부터
 * 다시 받아 수십 분씩 걸렸다. FtpClientAdapter/ssh2-sftp-client 둘 다
 * list(dir)/fastGet(remote, local) 인터페이스가 같아 프로토콜과 무관하게 동작한다.
 *
 * options.filter(fullPath, isDir)가 false를 반환하는 항목은 제외한다.
 * options.onProgress({ action: 'download'|'skip', source, destination })로 진행상황을 받는다.
 */
export async function downloadDirDiff(client, remoteDir, localDir, options = {}) {
  const { filter, onProgress } = options;
  mkdirSync(localDir, { recursive: true });

  const entries = await client.list(remoteDir);

  for (const entry of entries) {
    const remotePath = `${remoteDir}/${entry.name}`;
    const { isDirectory, size, mtimeMs } = normalizeEntry(entry);

    if (filter && !filter(remotePath, isDirectory)) {
      continue;
    }

    const localPath = join(localDir, entry.name);

    if (isDirectory) {
      await downloadDirDiff(client, remotePath, localPath, options);
      continue;
    }

    if (shouldDownload(localPath, size, mtimeMs)) {
      try {
        await client.fastGet(remotePath, localPath);
        onProgress?.({ action: 'download', source: remotePath, destination: localPath });
      } catch (err) {
        // 목록(list)엔 있는데 실제 전송(fastGet)에서 없다고 나오는 경우가 있다
        // (한글 파일명 NFC/NFD 정규화 불일치, 목록 조회 이후 서버측 삭제 등).
        // 파일 하나 때문에 전체 pull이 죽지 않도록 건너뛰고 마지막에 모아서 보고한다.
        onProgress?.({ action: 'error', source: remotePath, destination: localPath, error: err });
      }
    } else {
      onProgress?.({ action: 'skip', source: remotePath, destination: localPath });
    }
  }
}
