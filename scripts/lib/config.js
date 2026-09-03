import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// npm 패키지로 설치돼 node_modules 안에서 실행되더라도, 설정 파일은
// 항상 "사용자가 명령을 실행한 프로젝트"(process.cwd()) 기준으로 찾는다.
const ROOT = process.cwd();

/**
 * 끝 슬래시를 정리하되, 루트('/') 자체는 빈 문자열로 지워버리지 않는다
 *
 * '/foo/' → '/foo', '/' → '/', '' → ''
 */
export function normalizeRoot(raw) {
  const s = String(raw || '');
  const stripped = s.replace(/\/+$/, '');
  return stripped || (s ? '/' : '');
}

/**
 * 접속/경로 설정을 단일 소스로 로드
 *
 * 우선순위: .vscode/sftp.json → .env (폴백). VS Code SFTP 설정 하나로 통일해
 * lftp/deploy 등 모든 스크립트가 같은 host·경로 매핑을 쓰게 한다.
 * SFTP_FORCE_ENV 가 설정되면 sftp.json이 있어도 건너뛰고 .env(.env.tunnel 등)를 강제로 쓴다
 * (예: NUC SSH 터널 경유 등 sftp.json과 다른 접속 경로가 필요할 때).
 */
export function loadConfig() {
  const sftpPath = join(ROOT, '.vscode', 'sftp.json');
  if (existsSync(sftpPath) && !process.env.SFTP_FORCE_ENV) {
    const j = JSON.parse(readFileSync(sftpPath, 'utf8'));
    const protocol = j.protocol === 'ftp' ? 'ftp' : 'sftp';
    return {
      host: j.host,
      protocol,
      port: j.port || (protocol === 'ftp' ? 21 : 22),
      user: j.username,
      password: j.password,
      privateKeyPath: j.privateKeyPath || null,
      passphrase: j.passphrase || null,
      remoteRoot: normalizeRoot(j.remotePath),
      pullRemoteRoot: j.pullRemoteRoot ? normalizeRoot(j.pullRemoteRoot) : '',
      localRoot: j.context || 'web',
      pullExclude: j.pullExclude || '',
      skipGitTrack: !!j.skipGitTrack,
      source: '.vscode/sftp.json',
    };
  }
  const protocol = process.env.SFTP_PROTOCOL === 'ftp' ? 'ftp' : 'sftp';
  return {
    host: process.env.SFTP_HOST,
    protocol,
    port: process.env.SFTP_PORT || (protocol === 'ftp' ? 21 : 22),
    user: process.env.SFTP_USER,
    password: process.env.SFTP_PASSWORD,
    privateKeyPath: process.env.SFTP_PRIVATE_KEY || null,
    passphrase: process.env.SFTP_PASSPHRASE || null,
    remoteRoot: normalizeRoot(process.env.SFTP_REMOTE_ROOT),
    pullRemoteRoot: process.env.SFTP_PULL_REMOTE_ROOT ? normalizeRoot(process.env.SFTP_PULL_REMOTE_ROOT) : '',
    localRoot: process.env.SFTP_LOCAL_ROOT || 'web',
    pullExclude: process.env.SFTP_PULL_EXCLUDE || '',
    skipGitTrack: process.env.SFTP_SKIP_GIT_TRACK === '1',
    source: '.env',
  };
}

/**
 * 업로드에 실제 쓸 remoteRoot를 정하고, pull이 쓰는 경로와 다르면 경고한다
 *
 * manifest.remoteRoot가 있으면 그게 우선(cfg.remoteRoot는 폴백)이라, 정상 설정에서도
 * "다르다"는 게 항상 문제인 건 아니다 — 다만 pullRemoteRoot를 별도로 지정해둔 프로젝트에서
 * 업로드 경로와 pull 경로가 서로 다르면, "pull로 받은 위치"와 "실제 배포되는 위치"가
 * 어긋나는 설정 실수일 가능성이 높다. 차단하지 않고 눈에 띄게 경고만 한다(의도된 구성일
 * 수도 있어서 강제 중단은 과함).
 */
export function resolveUploadRoot(manifest, cfg) {
  const remoteRoot = String((manifest && manifest.remoteRoot) || cfg.remoteRoot || '').replace(/\/+$/, '');
  if (remoteRoot && cfg.pullRemoteRoot && cfg.pullRemoteRoot !== remoteRoot) {
    console.warn(`⚠️ 업로드 경로(${remoteRoot})와 pull 경로(${cfg.pullRemoteRoot})가 서로 다릅니다 — pull로 받은 것과 실제 배포되는 위치가 어긋날 수 있습니다. .vscode/sftp.json의 remotePath/pullRemoteRoot(또는 manifest의 remoteRoot)를 확인하세요.`);
  }
  return remoteRoot;
}
