import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { withSftp } from './lib/sftp.js';
import { parseFlags } from './lib/args.js';
import { loadConfig } from './lib/config.js';

/**
 * 원격 원본을 로컬 소스 폴더(cfg.localRoot, 기본 web) 아래로 내려받는다
 *
 * --paths 를 주면 그 파일들만 선택적으로 받고, 생략하면 remoteRoot 전체를
 * localRoot 로 재귀 미러링한다. --exclude="logs,tmp,datas" 로 이름 일치하는
 * 폴더/파일을 미러링에서 제외할 수 있다.
 * remoteRoot 는 --remote-root 인자 우선, 생략 시 .vscode/sftp.json(remotePath)/.env 의 SFTP_REMOTE_ROOT 를 쓴다.
 */
async function main() {
  const v = parseFlags(['remote-root', 'paths', 'exclude']);

  const cfg = loadConfig();
  const remoteRootRaw = v['remote-root'] || cfg.remoteRoot;
  if (!remoteRootRaw) {
    console.error('--remote-root 인자 또는 .vscode/sftp.json(remotePath)/.env(SFTP_REMOTE_ROOT) 가 필요합니다.');
    process.exit(1);
  }
  const remoteRoot = remoteRootRaw.replace(/\/+$/, '');
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
    (v.exclude || '').split(',').map((s) => s.trim()).filter(Boolean),
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
