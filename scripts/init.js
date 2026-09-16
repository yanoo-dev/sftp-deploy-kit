import { createInterface } from 'node:readline/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// PROJECT_ROOT: 설정 파일을 실제로 만들 사용자 프로젝트 위치
// PACKAGE_ROOT: 템플릿(.example 파일)이 들어있는 이 패키지 자신의 위치
const PROJECT_ROOT = process.cwd();
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SCRIPTS = {
  init: 'sftp-kit init',
  pull: 'sftp-kit pull',
  'upload:changed': 'sftp-kit upload:changed',
  upload: 'sftp-kit upload',
  deploy: 'sftp-kit deploy',
  'deploy:check': 'sftp-kit deploy:check',
  'deploy:backup': 'sftp-kit deploy:backup',
  'deploy:rollback': 'sftp-kit deploy:rollback',
  'hook:install': 'sftp-kit hook:install',
  track: 'sftp-kit track',
  'sftp:auto': 'sftp-kit sftp:auto',
  'remove-git': 'sftp-kit remove-git',
};

/**
 * package.json 에 sftp-kit 스크립트를 등록한다
 *
 * 이미 같은 이름의 스크립트가 있으면 사용자가 바꿔둔 것으로 보고 건드리지 않는다.
 * package.json 자체가 없으면(npm install 전에 init 을 돌린 경우) 만들지 않고 안내만 한다.
 */
function registerScripts() {
  const target = join(PROJECT_ROOT, 'package.json');
  if (!existsSync(target)) {
    console.log('[init] package.json 없음 — npm install -D github:yanoo-dev/sftp-deploy-kit 먼저 실행 후 다시 init');
    return;
  }
  const pkg = JSON.parse(readFileSync(target, 'utf8'));
  pkg.scripts = pkg.scripts || {};
  const added = [];
  for (const name of Object.keys(SCRIPTS)) {
    if (pkg.scripts[name] === undefined) {
      pkg.scripts[name] = SCRIPTS[name];
      added.push(name);
    }
  }
  if (added.length === 0) {
    console.log('[init] 이미 있음, 건너뜀: package.json scripts');
    return;
  }
  writeFileSync(target, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  console.log(`[init] package.json scripts 등록: ${added.join(', ')}`);
}

/**
 * 파일에 없는 줄만 뒤에 붙인다 (파일이 없으면 새로 만든다)
 */
function appendMissingLines(target, lines, label) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  const have = new Set(current.split(/\r?\n/).map((l) => l.trim()));
  const missing = lines.filter((l) => !have.has(l));
  if (missing.length === 0) {
    console.log(`[init] 이미 있음, 건너뜀: ${label}`);
    return;
  }
  const sep = current.length === 0 || current.endsWith('\n') ? '' : '\n';
  writeFileSync(target, `${current}${sep}${missing.join('\n')}\n`, 'utf8');
  console.log(`[init] ${label} 추가: ${missing.join(', ')}`);
}

/**
 * .gitignore / .gitattributes 에 키트가 필요로 하는 줄을 없는 것만 추가한다
 *
 * 접속정보·로컬 설정·백업은 git 에 올리면 안 되고, eol=lf 는 pre-commit 훅과 pull 비교가
 * 줄바꿈 차이로 오탐하지 않기 위한 전제라 함께 넣는다.
 */
function registerGitFiles() {
  appendMissingLines(join(PROJECT_ROOT, '.gitignore'), [
    '.vscode/sftp.json',
    '.env',
    'deploy/*.deploy.json',
    'backups/',
    'node_modules/',
  ], '.gitignore');
  appendMissingLines(join(PROJECT_ROOT, '.gitattributes'), ['* text=auto eol=lf'], '.gitattributes');
}

/**
 * 대화형으로 물어봐서 .vscode/sftp.json 과 deploy/*.deploy.json 을 자동 생성한다
 *
 * 이미 있는 파일은 덮어쓰지 않고 건너뛴다. 접속정보(host/username/password 등)는
 * 민감정보라 여기서 안 물어보고 생성된 파일을 직접 열어 채우도록 안내만 한다.
 */
async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const sftpTarget = join(PROJECT_ROOT, '.vscode', 'sftp.json');
  let folderName = 'web';

  if (existsSync(sftpTarget)) {
    console.log('[init] 이미 있음, 건너뜀: .vscode/sftp.json');
  } else {
    const answer = (await rl.question('로컬 소스 폴더명 (기본값: web): ')).trim();
    folderName = answer || 'web';

    const example = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, '.vscode', 'sftp.json.example'), 'utf8'),
    );
    example.context = folderName;

    mkdirSync(dirname(sftpTarget), { recursive: true });
    writeFileSync(sftpTarget, `${JSON.stringify(example, null, 4)}\n`, 'utf8');
    console.log(`[init] 생성: .vscode/sftp.json (context: "${folderName}")`);
  }

  const manifestAnswer = (await rl.question('배포 매니페스트 이름 (기본값: main): ')).trim();
  const manifestName = manifestAnswer || 'main';
  const deployDir = join(PROJECT_ROOT, 'deploy');
  const manifestTarget = join(deployDir, `${manifestName}.deploy.json`);

  if (existsSync(manifestTarget)) {
    console.log(`[init] 이미 있음, 건너뜀: deploy/${manifestName}.deploy.json`);
  } else {
    const exampleManifest = readFileSync(join(PACKAGE_ROOT, 'deploy', 'example.deploy.json'), 'utf8');
    mkdirSync(deployDir, { recursive: true });
    writeFileSync(manifestTarget, exampleManifest, 'utf8');
    console.log(`[init] 생성: deploy/${manifestName}.deploy.json`);
  }

  // .env — .vscode/sftp.json이 있으면 항상 우선이라 실제로는 안 쓰이지만,
  // sftp.json을 나중에 지우고 .env 방식으로 바꾸고 싶을 때를 대비해 폴백용으로 같이 생성
  const envTarget = join(PROJECT_ROOT, '.env');
  if (existsSync(envTarget)) {
    console.log('[init] 이미 있음, 건너뜀: .env');
  } else {
    const exampleEnv = readFileSync(join(PACKAGE_ROOT, '.env.example'), 'utf8');
    writeFileSync(envTarget, exampleEnv, 'utf8');
    console.log('[init] 생성: .env (폴백용 — .vscode/sftp.json이 있으면 이건 안 씀)');
  }

  // backups/ — 실제 백업은 나중에 자동 생성되지만, 폴더 존재 자체를 미리 보여주기 위해 .gitkeep으로 확보
  const backupsDir = join(PROJECT_ROOT, 'backups');
  const backupsKeep = join(backupsDir, '.gitkeep');
  if (existsSync(backupsDir)) {
    console.log('[init] 이미 있음, 건너뜀: backups/');
  } else {
    mkdirSync(backupsDir, { recursive: true });
    writeFileSync(backupsKeep, '', 'utf8');
    console.log('[init] 생성: backups/.gitkeep');
  }

  rl.close();

  registerScripts();
  registerGitFiles();

  console.log('\n[init] 완료. 다음 순서:');
  console.log('  1. .vscode/sftp.json 에서 host/username/password/protocol/remotePath 채우기');
  console.log('     (pull로 받을 서버 폴더가 remotePath와 다르면 pullRemoteRoot도, 안 받을 폴더는 pullExclude 에)');
  console.log(`  2. deploy/${manifestName}.deploy.json 에서 remoteRoot/directories/files 채우기`);
  console.log('  3. npm run pull (전체 미러링) 또는 npm run pull -- --paths="..." (일부만) → git commit 으로 기준점 남기기');
  console.log('  4. npm run hook:install — 업로드 안 된 변경이 커밋되는 사고를 pre-commit 훅으로 차단(권장)');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
