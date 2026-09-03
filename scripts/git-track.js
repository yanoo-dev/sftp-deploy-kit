import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './lib/config.js';
import { loadDeployManifest } from './lib/manifest.js';

/**
 * manifest(deploy/*.deploy.json) 기반 git 추적 예외 자동 생성
 *
 * deploy 폴더의 모든 manifest 가 선언한 디렉토리/파일을 통째로 git 추적 대상으로
 * 열어주고, `deploy/no-upload.txt`에 매칭되는 파일만 다시 개별적으로 제외한다.
 * localRoot(workspaces/html) 가 통째로 무시되는 상태에서 "작업/배포 대상 디렉토리만"
 * git 에 추적시키는 단일 소스 동기화 도구.
 *
 * 예전엔 파일 하나하나마다 `!path` 예외를 나열해서(디렉토리 안 파일 수만큼 줄 증가),
 * 사이트가 커질수록 .gitignore 가 수천 줄까지 불어나고 그때마다 그 디렉토리에
 * 그 순간 존재하는 파일이 전부(남의 작업 파일 포함) 통째로 딸려 들어오는 문제가 있었다.
 * 지금은 "디렉토리 단위로 열고, no-upload.txt 로 알려진 파일만 다시 닫는" 방식이라
 * .gitignore 크기가 파일 수가 아니라 manifest 디렉토리 개수에 비례한다 — 새 파일이
 * 생겨도 재생성 없이 바로 git 에 보이고, no-upload.txt 에 없는 남의 파일이 섞여
 * 들어와도 실제 업로드는 loadDeployManifest 의 동일한 no-upload 필터가 별도로 막는다
 * (git 추적 여부와 업로드 대상 여부는 처음부터 서로 다른 안전장치였다).
 *
 * 사용: sftp-deploy-kit track  (manifest 에 디렉토리/파일 추가 후 1회 실행,
 * 이후로는 그 디렉토리 밑에 파일이 늘어나도 다시 실행할 필요 없음)
 */

// 사용자 프로젝트(process.cwd()) 기준 — deploy/, .gitignore 전부 사용자 쪽 파일
const ROOT = process.cwd();
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

function normalize(value) {
  return String(value || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

// 1) deploy/*.deploy.json 을 전부 읽어 raw directories/files(미확장) + blocked(no-upload 필터링된 실제 파일) 수집
const deployDir = join(ROOT, 'deploy');
const rawDirectories = new Set();
const rawFiles = new Set();
const blockedFiles = new Set();

if (existsSync(deployDir)) {
  for (const f of readdirSync(deployDir).filter((x) => x.endsWith('.deploy.json'))) {
    const manifestPath = join(deployDir, f);
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
    (raw.directories || []).forEach((d) => rawDirectories.add(normalize(d)));
    (raw.files || []).forEach((x) => rawFiles.add(normalize(x)));

    // no-upload.txt 매칭으로 실제 걸러진 파일 목록은 loadDeployManifest 가 이미 계산해둔 걸 그대로 씀
    const expanded = loadDeployManifest(manifestPath, localRoot, { quiet: true });
    (expanded.blocked || []).forEach((x) => blockedFiles.add(x));
  }
}

// 2) manifest 디렉토리를 "조상(중간 경유지)"과 "실제 선언된 디렉토리(리프)"로 분리
//    - 중간 경유지(예: _modules/board 를 열려면 거쳐야 하는 _modules/)는 열었다가 바로 다시 닫는다
//      → _modules/admin, _modules/search 처럼 manifest 에 없는 형제 디렉토리가 같이 열리는 걸 막기 위함
//    - 리프(manifest 에 실제 선언된 디렉토리, 예: _modules/board)는 열기만 하고 다시 안 닫는다
//      → 그 안의 파일은 개수와 무관하게 전부 자동으로 추적 대상이 됨(예전처럼 파일 단위 나열 안 함)
const leafDirs = new Set([...rawDirectories]);
const intermediateDirs = new Set();
for (const dir of rawDirectories) {
  const parts = dir.split('/');
  let acc = '';
  for (let i = 0; i < parts.length - 1; i++) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i];
    intermediateDirs.add(acc);
  }
}
for (const dir of leafDirs) {
  intermediateDirs.delete(dir); // 리프가 동시에 다른 리프의 조상이면 리프 취급이 우선
}

const sortedIntermediate = [...intermediateDirs].sort(
  (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
);
const sortedLeaf = [...leafDirs].sort();

// 3) .gitignore auto-track 블록 조립 — 중간 경유지는 열고 바로 닫기, 리프는 열기만, blocked 파일만 다시 닫기
const body = [MARK_START];
for (const d of sortedIntermediate) {
  body.push(`!${localRoot}/${d}/`);
  body.push(`${localRoot}/${d}/*`);
}
for (const d of sortedLeaf) {
  body.push(`!${localRoot}/${d}/`);
}
for (const file of [...rawFiles].sort()) {
  body.push(`!${localRoot}/${file}`);
}
for (const file of [...blockedFiles].sort()) {
  body.push(`${localRoot}/${file}`);
}
body.push(MARK_END);
const block = body.join('\n');

// 4) .gitignore 의 마커 구간 교체(없으면 끝에 추가)
const giPath = join(ROOT, '.gitignore');
let gi = existsSync(giPath) ? readFileSync(giPath, 'utf8') : '';
const re = new RegExp(`${esc(MARK_START)}[\\s\\S]*?${esc(MARK_END)}`);
if (re.test(gi)) {
  gi = gi.replace(re, block);
} else {
  gi = `${gi.replace(/\s*$/, '')}\n\n${block}\n`;
}
writeFileSync(giPath, gi);

// 5) 결과 출력
console.log(`[git-track] manifest 디렉토리 ${sortedLeaf.length}개(경유지 ${sortedIntermediate.length}개) · 개별 파일 ${rawFiles.size}개 추적 허용 (${localRoot})`);
if (blockedFiles.size > 0) {
  console.log(`[git-track] no-upload.txt 매칭으로 ${blockedFiles.size}개 파일 재제외:`);
  [...blockedFiles].sort().forEach((f) => console.log(`  - ${localRoot}/${f}`));
}
if (rawDirectories.size === 0 && rawFiles.size === 0) {
  console.log('  (manifest 에 files/directories 없음 — deploy/*.deploy.json 확인)');
}
