import { dirname, join, relative } from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';
import { withSftp } from './lib/sftp.js';
import { downloadDirDiff } from './lib/download-diff.js';
import { parseFlags } from './lib/args.js';
import { loadConfig, normalizeRoot } from './lib/config.js';

/**
 * 원격 원본을 로컬 소스 폴더(cfg.localRoot, 기본 web) 아래로 내려받는다
 *
 * --paths 를 주면 그 파일들만 선택적으로 받고, 생략하면 remoteRoot 전체를
 * localRoot 로 재귀 미러링한다. 전체 미러링은 로컬에 이미 같은 파일(크기+수정시각
 * 일치)이 있으면 건너뛴다(downloadDirDiff, 매번 전체 재전송하던 문제 해결).
 * --exclude="logs,tmp,sessions" 로 이름 일치하는 폴더/파일을 미러링에서 제외할 수
 * 있다. --exclude 생략 시 .vscode/sftp.json의 pullExclude(또는 .env의
 * SFTP_PULL_EXCLUDE)를 기본값으로 쓴다.
 * remoteRoot 는 --remote-root 인자 우선, 생략 시 .vscode/sftp.json(pullRemoteRoot → remotePath 순)
 * 또는 .env(SFTP_PULL_REMOTE_ROOT → SFTP_REMOTE_ROOT 순)를 쓴다. remotePath(계정 루트)와
 * pull 대상 실제 경로(예: 계정 루트 아래 html/ 서브폴더)가 다른 경우 pullRemoteRoot로 명시한다.
 *
 * 받은 파일은 그 자리에서 backups/.last-deployed/ 에도 같이 기록한다 — pull로 받은
 * 내용은 정의상 "지금 서버에 있는 그대로"라, deploy.js를 거친 적 없어도 이미
 * 배포 확인된 것으로 봐야 한다. 이걸 안 하면 pull만 받고 커밋하려 할 때
 * pre-commit 훅이 매번 "업로드 기록 없음"으로 잘못 막는다.
 */
function markDeployed(localFile, rel) {
  const dest = join('backups', '.last-deployed', rel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(localFile, dest);
}

async function main() {
  const v = parseFlags(['remote-root', 'paths', 'exclude']);

  const cfg = loadConfig();
  const remoteRootRaw = v['remote-root'] || cfg.pullRemoteRoot || cfg.remoteRoot;
  if (!remoteRootRaw) {
    console.error('--remote-root 인자 또는 .vscode/sftp.json(pullRemoteRoot/remotePath)/.env(SFTP_PULL_REMOTE_ROOT/SFTP_REMOTE_ROOT) 가 필요합니다.');
    process.exit(1);
  }
  const remoteRoot = normalizeRoot(remoteRootRaw);
  const localRoot = cfg.localRoot;

  if (v.paths) {
    const paths = v.paths.split(',').map((p) => p.trim()).filter(Boolean);
    await withSftp(async (client) => {
      for (const rel of paths) {
        const remote = `${remoteRoot}/${rel}`;
        const local = join(localRoot, rel);
        mkdirSync(dirname(local), { recursive: true });
        await client.fastGet(remote, local);
        markDeployed(local, rel);
        console.log(`받음: ${remote} → ${local}`);
      }
    });
    console.log(`완료: ${paths.length}개 → ${localRoot}`);
    return;
  }

  const excludeNames = new Set(
    (v.exclude || cfg.pullExclude || '').split(',').map((s) => s.trim()).filter(Boolean),
  );
  const filter = excludeNames.size
    ? (fullPath) => !excludeNames.has(fullPath.split('/').pop())
    : null;

  mkdirSync(localRoot, { recursive: true });
  let downloaded = 0;
  let skipped = 0;
  const failed = [];
  await withSftp(async (client) => {
    await downloadDirDiff(client, remoteRoot, localRoot, {
      filter,
      onProgress: ({ action, source, destination, error }) => {
        if (action === 'download') {
          downloaded += 1;
          markDeployed(destination, relative(localRoot, destination));
          console.log(`받음(${downloaded}): ${source}`);
        } else if (action === 'error') {
          failed.push({ source, error });
          console.warn(`  ⚠️ 못 받음(건너뜀): ${source} — ${error.message}`);
        } else {
          skipped += 1;
        }
      },
    });
  });
  const excludeNote = excludeNames.size ? ` (제외: ${[...excludeNames].join(', ')})` : '';
  console.log(`완료: ${downloaded}개 받음, ${skipped}개 동일해서 건너뜀 → ${remoteRoot} → ${localRoot}${excludeNote}`);

  if (failed.length > 0) {
    console.warn(`\n⚠️ ${failed.length}개 파일을 못 받고 건너뛰었습니다 — 목록(list)엔 있는데 실제로 없거나(서버측 삭제) 한글 파일명 인코딩 문제일 수 있습니다:`);
    failed.forEach(({ source, error }) => console.warn(`  ⚠️ ${source} — ${error.message}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
