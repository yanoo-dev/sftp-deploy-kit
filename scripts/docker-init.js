import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = process.cwd();
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const LEGACY_APT = `# Debian Buster가 EOL이라 기본 저장소(deb.debian.org)에서 404 남 → archive.debian.org로 전환
RUN sed -i \\
      -e 's|deb.debian.org/debian|archive.debian.org/debian|g' \\
      -e 's|security.debian.org/debian-security|archive.debian.org/debian-security|g' \\
      -e '/buster-updates/d' \\
      /etc/apt/sources.list \\
    && echo 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/99no-check-valid

`;

const DB_SCRIPTS = {
  'db:office': 'bash scripts/db-proxy.sh office',
  'db:home': 'bash scripts/db-proxy.sh home',
  'db:status': 'bash scripts/db-proxy.sh status',
  'db:fix': 'bash scripts/db-proxy.sh restart',
};

const GITIGNORE_LINES = ['Dockerfile', 'docker-compose.yaml', 'docker-entrypoint-local.sh', 'scripts/'];

/**
 * --key=value 플래그를 읽는다 (없으면 기본값)
 */
function flag(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim() : fallback;
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
 * package.json scripts 에 db:* 를 없는 것만 등록한다
 */
function registerScripts() {
  const target = join(PROJECT_ROOT, 'package.json');
  if (!existsSync(target)) {
    console.log('[docker:init] package.json 없음 — db:* 스크립트 등록 건너뜀');
    return;
  }
  const pkg = JSON.parse(readFileSync(target, 'utf8'));
  pkg.scripts = pkg.scripts || {};
  const added = [];
  for (const [name, cmd] of Object.entries(DB_SCRIPTS)) {
    if (pkg.scripts[name] === undefined) {
      pkg.scripts[name] = cmd;
      added.push(name);
    }
  }
  if (added.length === 0) {
    console.log('[docker:init] 이미 있음, 건너뜀: package.json db:* scripts');
    return;
  }
  writeFileSync(target, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  console.log(`[docker:init] package.json scripts 등록: ${added.join(', ')}`);
}

/**
 * 로컬 PHP 실행용 Docker 파일 4개를 값만 바꿔 생성한다
 *
 * 대상은 database.php 가 hostname=localhost 로 고정된 CI3 계열 소스 — 컨테이너 안 socat 이
 * 유닉스 소켓을 원격 DB(--db-host) 로 중계한다. PHP 7.x 는 Debian 옛 저장소 우회 블록을 넣는다.
 */
function main() {
  const dbHost = flag('db-host');
  if (!dbHost || process.argv.includes('--help') || process.argv.includes('-h')) {
    console.error('사용법: sftp-kit docker:init --db-host=<원격DB주소> [--name=<프로젝트>] [--port=8080] [--db-port=3306] [--php=7.2] [--force]');
    console.error('  --name    컨테이너 이름 앞부분(기본: 현재 폴더명). 두 프로젝트 폴더명이 같으면 반드시 다르게');
    console.error('  --port    localhost 포트(기본 8080) — 동시에 띄울 프로젝트끼리 다르게');
    console.error('  --php     서버 PHP 버전(기본 7.2). 7.x 면 Debian 옛 저장소 우회 블록 포함');
    process.exit(dbHost ? 0 : 1);
  }
  const name = flag('name', PROJECT_ROOT.split('/').pop());
  const port = flag('port', '8080');
  const dbPort = flag('db-port', '3306');
  const php = flag('php', '7.2');
  const force = process.argv.includes('--force');
  const legacy = php.startsWith('7.');
  const values = {
    NAME: name,
    PORT: port,
    DB_HOST: dbHost,
    DB_PORT: dbPort,
    PHP: php,
    LEGACY_APT: legacy ? LEGACY_APT : '',
    MCRYPT: legacy ? '1.0.5' : '1.0.7',
  };
  const tpl = (f) => readFileSync(join(PACKAGE_ROOT, 'docker', f), 'utf8');

  writeIfMissing('Dockerfile', render(tpl('Dockerfile.tpl'), values), force);
  writeIfMissing('docker-compose.yaml', render(tpl('docker-compose.yaml.tpl'), values), force);
  writeIfMissing('docker-entrypoint-local.sh', tpl('docker-entrypoint-local.sh'), force, true);
  writeIfMissing('scripts/db-proxy.sh', render(tpl('db-proxy.sh.tpl'), values), force, true);
  registerScripts();
  appendMissingLines('.gitignore', GITIGNORE_LINES);

  console.log('\n[docker:init] 완료. 다음 순서:');
  console.log('  1. docker compose up -d --build   (첫 빌드 3~10분 — Docker Hub 에서 php 이미지를 받음)');
  console.log(`  2. npm run db:status              ("DB 연결 ✅" 나오면 http://localhost:${port}/ )`);
  console.log(`  * 컨테이너 이름 ${name}-web-1 · DB 프록시 ${dbHost}:${dbPort} · PHP ${php}`);
}

main();
