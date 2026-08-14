import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { withSftp } from './lib/sftp.js';
import { parseFlags } from './lib/args.js';
import { loadConfig, normalizeRoot } from './lib/config.js';

/**
 * 원격 원본을 로컬 소스 폴더(cfg.localRoot, 기본 web) 아래로 내려받는다
 *
 * --paths 를 주면 그 파일들만 선택적으로 받고, 생략하면 remoteRoot 전체를
 * localRoot 로 재귀 미러링한다. --exclude="logs,tmp,sessions" 로 이름 일치하는
 * 폴더/파일을 미러링에서 제외할 수 있다. --exclude 생략 시 .vscode/sftp.json의
 * pullExclude(또는 .env의 SFTP_PULL_EXCLUDE)를 기본값으로 쓴다.
 * remoteRoot 는 --remote-root 인자 우선, 생략 시 .vscode/sftp.json(pullRemoteRoot → remotePath 순)
 * 또는 .env(SFTP_PULL_REMOTE_ROOT → SFTP_REMOTE_ROOT 순)를 쓴다. remotePath(계정 루트)와
 * pull 대상 실제 경로(예: 계정 루트 아래 html/ 서브폴더)가 다른 경우 pullRemoteRoot로 명시한다.
 */
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
  let count = 0;
  await withSftp(async (client) => {
    client.on('download', ({ source }) => {
      count += 1;
      console.log(`받음(${count}): ${source}`);
    });
    await client.downloadDir(remoteRoot, localRoot, { filter });
  });
  const excludeNote = excludeNames.size ? ` (제외: ${[...excludeNames].join(', ')})` : '';
  console.log(`완료: 전체 미러링 ${count}개 ${remoteRoot} → ${localRoot}${excludeNote}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
