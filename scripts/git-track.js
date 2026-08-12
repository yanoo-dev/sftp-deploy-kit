import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.js';
import { loadDeployManifest } from './lib/manifest.js';

/**
 * manifest(deploy/*.deploy.json) 기반 git 추적 예외 자동 생성
 *
 * deploy 폴더의 모든 manifest 의 files 를 모아 .gitignore 의 auto-track 구간에
 * 추적 예외(!) 규칙을 생성한다. localRoot(workspaces/html) 가 통째로 무시되는 상태에서
 * "작업/배포 파일만" git 에 추적시키는 단일 소스 동기화 도구.
 * 사용: npm run track  (manifest 에 파일 추가 후 실행)
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = loadConfig();
const localRoot = (cfg.localRoot || 'workspaces/html').replace(/\/+$/, '');

const MARK_START = '# >>> auto-track (manifest 기반 · git-track.js 자동생성 · 수정 금지) >>>';
const MARK_END = '# <<< auto-track <<<';

/**
 * 정규식 특수문자 이스케이프
 *
 * .gitignore 마커 문자열(괄호 등 포함)을 RegExp 로 안전하게 쓰기 위함.
 */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 1) deploy/*.deploy.json 의 files 전부 수집
const deployDir = join(ROOT, 'deploy');
const files = new Set();
if (existsSync(deployDir)) {
  for (const f of readdirSync(deployDir).filter((x) => x.endsWith('.deploy.json'))) {
    const m = loadDeployManifest(join(deployDir, f), localRoot, { quiet: true });
    (m.files || []).forEach((x) => files.add(String(x).replace(/^\/+/, '')));
  }
}

// 2) 각 파일의 부모 디렉토리(깊이순) + 파일 예외 규칙 생성
const dirs = new Set();
for (const file of files) {
  const parts = file.split('/');
  let acc = '';
  for (let i = 0; i < parts.length - 1; i++) {
    acc += (acc ? '/' : '') + parts[i];
    dirs.add(acc);
  }
}
const sortedDirs = [...dirs].sort(
  (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
);

const body = [MARK_START];
for (const d of sortedDirs) {
  body.push(`!${localRoot}/${d}/`);
  body.push(`${localRoot}/${d}/*`);
}
for (const file of [...files].sort()) {
  body.push(`!${localRoot}/${file}`);
}
body.push(MARK_END);
const block = body.join('\n');

// 3) .gitignore 의 마커 구간 교체(없으면 끝에 추가)
const giPath = join(ROOT, '.gitignore');
let gi = existsSync(giPath) ? readFileSync(giPath, 'utf8') : '';
const re = new RegExp(`${esc(MARK_START)}[\\s\\S]*?${esc(MARK_END)}`);
if (re.test(gi)) {
  gi = gi.replace(re, block);
} else {
  gi = `${gi.replace(/\s*$/, '')}\n\n${block}\n`;
}
writeFileSync(giPath, gi);

// 4) 결과 출력
console.log(`[git-track] ${files.size}개 파일 추적 예외 생성 (${localRoot})`);
[...files].sort().forEach((f) => console.log(`  + ${localRoot}/${f}`));
if (files.size === 0) {
  console.log('  (manifest 에 files 없음 — deploy/*.deploy.json 확인)');
}
