import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRootLocal, loadConfig } from './lib/config.js';

const PROJECT_ROOT = process.cwd();
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCKER_DIR = '_docker';

const LEGACY_APT = `# Debian Buster/Bullseye 가 EOL 이라 기본 저장소(deb.debian.org · 보안 저장소)에서 404 남
# → archive.debian.org 로 처음부터 전환 (update 는 통과해도 패키지 다운로드에서 404 나므로 조건부 전환 X)
RUN sed -i \\
      -e 's|deb.debian.org/debian|archive.debian.org/debian|g' \\
      -e 's|security.debian.org/debian-security|archive.debian.org/debian-security|g' \\
      -e '/buster-updates/d' \\
      /etc/apt/sources.list \\
    && echo 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/99no-check-valid

`;

const HTACCESS_MOUNT = `      # 웹 루트 .htaccess 의 강제 리다이렉트 · SetEnv CI_ENV 를 컨테이너 안에서만 교체 (원본 무수정)
      - ./${DOCKER_DIR}/htaccess.local:/var/www/html/.htaccess:ro
`;

/**
 * --key=value 플래그를 읽는다 (없으면 기본값)
 */
function flag(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim() : fallback;
}

/**
 * 값 없는 스위치 플래그(--db-tunnel 등) 존재 여부
 */
function has(name) {
  return process.argv.includes(`--${name}`);
}

/**
 * 템플릿의 __KEY__ 자리를 값으로 바꾼다
 */
function render(template, values) {
  return Object.entries(values).reduce((out, [k, v]) => out.split(`__${k}__`).join(v), template);
}

/**
 * 파일을 만든다 — 이미 있으면 --force 없이는 건너뛴다
 */
function writeIfMissing(rel, content, force, executable = false) {
  const target = join(PROJECT_ROOT, rel);
  if (existsSync(target) && !force) {
    console.log(`[docker:init] 이미 있음, 건너뜀: ${rel} (덮어쓰려면 --force)`);
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
  if (executable) {
    chmodSync(target, 0o755);
  }
  console.log(`[docker:init] 생성: ${rel}`);
}

/**
 * 파일에 없는 줄만 뒤에 붙인다
 */
function appendMissingLines(rel, lines) {
  const target = join(PROJECT_ROOT, rel);
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  const have = new Set(current.split(/\r?\n/).map((l) => l.trim()));
  const missing = lines.filter((l) => !have.has(l));
  if (missing.length === 0) {
    console.log(`[docker:init] 이미 있음, 건너뜀: ${rel}`);
    return;
  }
  const sep = current.length === 0 || current.endsWith('\n') ? '' : '\n';
  writeFileSync(target, `${current}${sep}# Docker (로컬 전용)\n${missing.join('\n')}\n`, 'utf8');
  console.log(`[docker:init] ${rel} 추가: ${missing.join(', ')}`);
}

/**
 * .htaccess 에서 로컬을 막는 줄만 걷어낸다
 *
 * 리다이렉트(R / R=30x 플래그) RewriteRule 은 바로 앞 RewriteCond 묶음과 함께 제거,
 * `SetEnv CI_ENV …` 도 제거(→ index.php 가 development 로 동작). 나머지 라우팅은 그대로 유지.
 */
function stripHtaccess(src) {
  const out = [];
  const removed = [];
  let conds = [];
  for (const line of src.split(/\r?\n/)) {
    const t = line.trim();
    if (/^RewriteCond\b/i.test(t)) {
      conds.push(line);
      continue;
    }
    if (/^RewriteRule\b/i.test(t)) {
      const isRedirect = /\[(?:[^\]]*,)?\s*R(?:=\d+)?\s*(?:,[^\]]*)?\]/i.test(t);
      if (isRedirect) {
        removed.push(...conds, line);
      } else {
        out.push(...conds, line);
      }
      conds = [];
      continue;
    }
    out.push(...conds);
    conds = [];
    if (/^SetEnv\s+CI_ENV\b/i.test(t)) {
      removed.push(line);
      continue;
    }
    out.push(line);
  }
  out.push(...conds);
  // 블록을 걷어낸 자리에 남는 연속 빈 줄은 하나로
  return { content: out.join('\n').replace(/\n{3,}/g, '\n\n'), removed };
}

/**
 * 웹 루트 .htaccess 로 로컬 전용 사본을 만든다 — 걷어낼 게 없으면 만들지 않는다
 *
 * @returns 마운트가 필요하면 true
 */
function writeLocalHtaccess(webDir, force) {
  const src = join(PROJECT_ROOT, webDir, '.htaccess');
  if (!existsSync(src)) {
    return false;
  }
  const { content, removed } = stripHtaccess(readFileSync(src, 'utf8'));
  if (removed.length === 0) {
    return false;
  }
  const header = '# 로컬 Docker 전용 — 원본 .htaccess 에서 아래 줄만 제거 (docker:init 자동 생성)\n'
    + removed.map((l) => `#   - ${l.trim()}`).join('\n') + '\n\n';
  writeIfMissing(`${DOCKER_DIR}/htaccess.local`, header + content.trimStart(), force);
  return true;
}

/**
 * browser-sync 가 없으면 devDependencies 로 설치한다
 */
function ensureBrowserSync() {
  const pkgPath = join(PROJECT_ROOT, 'package.json');
  if (!existsSync(pkgPath)) {
    return;
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (pkg.devDependencies?.['browser-sync'] || pkg.dependencies?.['browser-sync']) {
    console.log('[docker:init] 이미 있음, 건너뜀: browser-sync');
    return;
  }
  console.log('[docker:init] browser-sync 설치 중 (npm i -D browser-sync)...');
  const r = spawnSync('npm', ['i', '-D', 'browser-sync'], { stdio: 'inherit', cwd: PROJECT_ROOT });
  if (r.status !== 0) {
    console.log('[docker:init] ⚠️ browser-sync 설치 실패 — 나중에 npm i -D browser-sync');
  }
}

/**
 * package.json scripts 에 없는 것만 등록한다
 */
function registerScripts(scripts) {
  const target = join(PROJECT_ROOT, 'package.json');
  if (!existsSync(target)) {
    console.log('[docker:init] package.json 없음 — scripts 등록 건너뜀');
    return;
  }
  const pkg = JSON.parse(readFileSync(target, 'utf8'));
  pkg.scripts = pkg.scripts || {};
  const added = [];
  for (const [name, cmd] of Object.entries(scripts)) {
    if (pkg.scripts[name] === undefined) {
      pkg.scripts[name] = cmd;
      added.push(name);
    }
  }
  if (added.length === 0) {
    console.log('[docker:init] 이미 있음, 건너뜀: package.json scripts');
    return;
  }
  writeFileSync(target, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  console.log(`[docker:init] package.json scripts 등록: ${added.join(', ')}`);
}

/**
 * browser-sync 감시 대상 인자를 만든다
 *
 * --watch 로 폴더를 주면 그 폴더만, 루트 모드 기본은 저장소 전체(node_modules · _docker 제외).
 */
function devFilesArgs(watchDir) {
  const exts = ['css', 'html', 'js'];
  if (watchDir === '.') {
    return `${exts.map((e) => `'**/*.${e}'`).join(' ')} --ignore 'node_modules/**' --ignore '${DOCKER_DIR}/**'`;
  }
  return exts.map((e) => `'${watchDir}/**/*.${e}'`).join(' ');
}

/**
 * 로컬 PHP 실행용 Docker 세팅 생성
 *
 * 루트에 docker-compose.yaml(→ `docker compose up` 그대로), 나머지는 _docker/ 에 모은다.
 * sftp.json context 로 웹 루트를 판단 — "." (루트 모드, 회사 저장소) 면 볼륨 "." + .git/info/exclude,
 * 아니면 볼륨 "./<context>" + .gitignore. DB 가 서버 안 localhost 전용이면 --db-tunnel 로
 * 맥 터널(sftp-kit db:tunnel) 경유 구성을 만든다.
 */
function main() {
  const tunnel = has('db-tunnel');
  const dbHostFlag = flag('db-host');
  if ((!dbHostFlag && !tunnel) || has('help') || has('h')) {
    console.error('사용법: sftp-kit docker:init (--db-host=<원격DB주소> | --db-tunnel) [옵션]');
    console.error('  --db-host     DB 에 직접 붙을 수 있을 때 주소');
    console.error('  --db-tunnel   DB 가 서버 안 localhost 전용일 때 — sftp.json SSH 계정으로 맥 터널 경유');
    console.error('  --name        컨테이너 이름 앞부분(기본: 현재 폴더명)');
    console.error('  --port        localhost 포트(기본 8080) — 동시에 띄울 프로젝트끼리 다르게');
    console.error('  --php         서버 PHP 버전(기본 7.2). 7.x 면 Debian archive 저장소 블록 포함');
    console.error('  --db-port     원격 DB 포트(기본 3306) · --tunnel-port 맥 터널 포트(기본 13306)');
    console.error('  --watch       npm run dev 감시 폴더(기본: 웹 루트) · --no-dev browser-sync 생략 · --force 덮어쓰기');
    process.exit(dbHostFlag || tunnel ? 0 : 1);
  }

  const cfg = loadConfig();
  const webDir = flag('web-dir', cfg.localRoot);
  const rootMode = isRootLocal(webDir);
  const name = flag('name', PROJECT_ROOT.split('/').pop());
  const port = flag('port', '8080');
  const php = flag('php', '7.2');
  const dbPort = flag('db-port', '3306');
  const tunnelPort = flag('tunnel-port', '13306');
  const devPort = flag('dev-port', String(3000 + Math.max(0, Number(port) - 8080)));
  const watchDir = flag('watch', rootMode ? '.' : webDir);
  const noDev = has('no-dev');
  const force = has('force');
  const legacy = php.startsWith('7.');

  const tpl = (f) => readFileSync(join(PACKAGE_ROOT, 'docker', f), 'utf8');
  const mountHtaccess = writeLocalHtaccess(webDir, force);
  const values = {
    NAME: name,
    PORT: port,
    DB_HOST: tunnel ? 'host.docker.internal' : dbHostFlag,
    DB_PORT: tunnel ? tunnelPort : dbPort,
    PHP: php,
    LEGACY_APT: legacy ? LEGACY_APT : '',
    MCRYPT: legacy ? '1.0.5' : '1.0.7',
    WEB_DIR: rootMode ? '.' : `./${webDir}`,
    HTACCESS_MOUNT: mountHtaccess ? HTACCESS_MOUNT : '',
  };

  writeIfMissing('docker-compose.yaml', render(tpl('docker-compose.yaml.tpl'), values), force);
  writeIfMissing(`${DOCKER_DIR}/Dockerfile`, render(tpl('Dockerfile.tpl'), values), force);
  writeIfMissing(`${DOCKER_DIR}/docker-entrypoint-local.sh`, tpl('docker-entrypoint-local.sh'), force, true);
  writeIfMissing(`${DOCKER_DIR}/db-proxy.sh`, render(tpl('db-proxy.sh.tpl'), values), force, true);

  if (!noDev) {
    ensureBrowserSync();
  }

  const scripts = {
    'db:status': `bash ${DOCKER_DIR}/db-proxy.sh status`,
    'db:fix': `bash ${DOCKER_DIR}/db-proxy.sh restart`,
    'docker:up': 'docker compose up -d --build',
    'docker:down': 'docker compose down',
  };
  if (tunnel) {
    scripts['db:tunnel'] = `sftp-kit db:tunnel --local-port=${tunnelPort} --remote-port=${dbPort}`;
  } else {
    scripts['db:office'] = `bash ${DOCKER_DIR}/db-proxy.sh office`;
    scripts['db:home'] = `bash ${DOCKER_DIR}/db-proxy.sh home`;
  }
  if (!noDev) {
    scripts.dev = `browser-sync start --proxy 'localhost:${port}' --port ${devPort} --files ${devFilesArgs(watchDir)} --no-open`;
  }
  registerScripts(scripts);

  // 루트 모드 = 회사 저장소 → .gitignore 무수정, 내 clone 의 exclude 에만 (앞 / 루트 고정)
  if (rootMode) {
    appendMissingLines('.git/info/exclude', [`/${DOCKER_DIR}/`, '/docker-compose.yaml']);
  } else {
    appendMissingLines('.gitignore', [`${DOCKER_DIR}/`, 'docker-compose.yaml']);
  }

  console.log('\n[docker:init] 완료. 다음 순서:');
  if (tunnel) {
    console.log('  0. npm run db:tunnel              (다른 터미널에 켜둠 — SSH 접속이 되는 상태여야 함)');
  }
  console.log('  1. docker compose up -d --build   (첫 빌드 3~10분)');
  console.log(`  2. npm run db:status              ("DB 연결 ✅" 나오면 http://localhost:${port}/ )`);
  if (!noDev) {
    console.log(`  3. npm run dev                    (http://localhost:${devPort}/ 저장 시 자동 새로고침)`);
  }
  console.log(`  * 컨테이너 ${name}-web-1 · 웹 루트 ${values.WEB_DIR} · DB ${values.DB_HOST}:${values.DB_PORT} · PHP ${php}`);
  if (mountHtaccess) {
    console.log(`  * .htaccess 로컬 교체: ${DOCKER_DIR}/htaccess.local (리다이렉트 · CI_ENV 제거본)`);
  }
}

main();
