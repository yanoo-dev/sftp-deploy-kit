import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadConfig } from './lib/config.js';
import { parseFlags, requireFlags, firstPositional } from './lib/args.js';
import { loadDeployManifest, filterOnly } from './lib/manifest.js';

/**
 * 배포 manifest 를 검증한다
 *
 * deploy/{page}.deploy.json 을 읽어 files 의 각 파일이 로컬 소스 폴더
 * (cfg.localRoot, .vscode/sftp.json 의 context) 에 실제로 있는지 확인하고
 * 결과를 출력한다. (업로드는 하지 않음)
 */
async function main() {
  const v = parseFlags(['page', 'only', 'quiet']);
  v.page = v.page || firstPositional();
  requireFlags(v, ['page'],
    'npm run deploy:check -- sample-page [--only=path1,path2]');

  const manifestPath = join('deploy', `${v.page}.deploy.json`);
  if (!existsSync(manifestPath)) {
    console.error(`manifest 없음: ${manifestPath}`);
    process.exit(1);
  }

  const cfg = loadConfig();
  const manifest = loadDeployManifest(manifestPath, cfg.localRoot, { quiet: v.quiet !== undefined });
  manifest.files = filterOnly(manifest.files, v.only);
  const localRoot = manifest.localRoot;

  let ok = 0;
  let missing = 0;
  for (const rel of manifest.files) {
    const local = join(localRoot, rel);
    if (existsSync(local)) {
      console.log(`  ✓ ${rel}`);
      ok += 1;
    } else {
      console.log(`  ✗ ${rel}  (로컬 없음: ${local})`);
      missing += 1;
    }
  }

  const remoteRoot = manifest.remoteRoot || cfg.remoteRoot;
  console.log(`\n대상 ${manifest.files.length}개 · 존재 ${ok} · 누락 ${missing}`);
  console.log(`remoteRoot: ${remoteRoot}`);
  if (missing > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
