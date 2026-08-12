import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { withSftp } from './lib/sftp.js';
import { parseFlags, requireFlags } from './lib/args.js';
import { loadConfig } from './lib/config.js';

/**
 * SFTP 로 운영 원본을 로컬 소스 폴더(cfg.localRoot, 기본 workspaces/html) 아래로 내려받는다
 *
 * --paths 의 각 상대경로를 remoteRoot 기준으로 받아 동일 상대경로로 저장한다.
 * remoteRoot 는 --remote-root 인자 우선, 생략 시 .vscode/sftp.json(context)/.env 의 SFTP_REMOTE_ROOT 를 쓴다.
 * localRoot 는 .vscode/sftp.json 의 context 필드로 프로젝트마다 자유롭게 바꿀 수 있다.
 * (저장소 1개 = 프로젝트 1개 이므로 프로젝트 구분 경로는 두지 않는다.)
 */
async function main() {
  const v = parseFlags(['remote-root', 'paths']);
  requireFlags(v, ['paths'],
    'npm run sftp:pull -- --paths="a.css,a.js" [--remote-root="/home/demo/html"]');

  const cfg = loadConfig();
  // --remote-root 우선, 없으면 config(.vscode/sftp.json 또는 .env)
  const remoteRootRaw = v['remote-root'] || cfg.remoteRoot;
  if (!remoteRootRaw) {
    console.error('--remote-root 인자 또는 .vscode/sftp.json(remotePath)/.env(SFTP_REMOTE_ROOT) 가 필요합니다.');
    process.exit(1);
  }
  const remoteRoot = remoteRootRaw.replace(/\/+$/, '');
  const paths = v.paths.split(',').map((p) => p.trim()).filter(Boolean);
  const localRoot = cfg.localRoot;

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
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
