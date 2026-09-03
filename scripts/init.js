import { createInterface } from 'node:readline/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// PROJECT_ROOT: 설정 파일을 실제로 만들 사용자 프로젝트 위치
// PACKAGE_ROOT: 템플릿(.example 파일)이 들어있는 이 패키지 자신의 위치
const PROJECT_ROOT = process.cwd();
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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

  console.log('\n[init] 완료. 다음 순서:');
  console.log('  1. .vscode/sftp.json 에서 host/username/password/remotePath 채우기');
  console.log('     (pull로 받을 서버 폴더가 remotePath와 다르면 pullRemoteRoot도 같이 채울 것 — 둘이 다른데 안 맞추면 나중에 배포 위치가 어긋남)');
  console.log(`  2. deploy/${manifestName}.deploy.json 에서 remoteRoot/files 채우기`);
  console.log('  3. npx sftp-kit pull --exclude="logs,tmp" (전체 미러링) 또는 --paths="..." (일부만) 로 소스 받기');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
