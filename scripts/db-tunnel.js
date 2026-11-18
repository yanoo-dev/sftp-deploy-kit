import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import ssh2 from 'ssh2';
import { loadConfig } from './lib/config.js';

const { Client } = ssh2;

/**
 * --key=value 플래그를 읽는다 (없으면 기본값)
 */
function flag(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim() : fallback;
}

/**
 * 맥 로컬 포트 → 서버 안 DB 로 SSH 터널을 연다
 *
 * DB 계정이 서버 안 localhost 전용일 때 — 서버에 SSH 로 들어간 뒤 그 안에서 127.0.0.1:<remote> 로
 * 붙으므로 서버 입장에선 localhost 접속. 계정은 sftp.json(.env) 그대로, 비밀번호 · 개인키 모두 지원.
 * Docker 는 host.docker.internal:<local> 로 이 터널을 본다. Ctrl+C 로 종료.
 */
function main() {
  const cfg = loadConfig();
  const localPort = Number(flag('local-port', '13306'));
  const remoteHost = flag('remote-host', '127.0.0.1');
  const remotePort = Number(flag('remote-port', '3306'));
  if (cfg.protocol !== 'sftp') {
    console.error('[db:tunnel] ❌ SFTP(SSH) 접속에서만 가능 — 현재 protocol:', cfg.protocol);
    process.exit(1);
  }

  const ssh = new Client();
  ssh.on('ready', () => {
    const server = createServer((sock) => {
      ssh.forwardOut('127.0.0.1', localPort, remoteHost, remotePort, (err, stream) => {
        if (err) {
          console.error('[db:tunnel] forward 실패:', err.message);
          sock.destroy();
          return;
        }
        sock.pipe(stream).pipe(sock);
      });
    });
    server.on('error', (e) => {
      const why = e.code === 'EADDRINUSE' ? `포트 ${localPort} 이미 사용 중 — 터널이 이미 떠 있는지 확인` : e.message;
      console.error('[db:tunnel] ❌', why);
      process.exit(1);
    });
    server.listen(localPort, '127.0.0.1', () => {
      console.log(`[db:tunnel] ✅ 127.0.0.1:${localPort} → ${cfg.host}:${cfg.port} 안 ${remoteHost}:${remotePort} (종료 Ctrl+C)`);
    });
  });
  ssh.on('error', (e) => {
    console.error('[db:tunnel] ❌ SSH 오류:', e.message, `— ${cfg.host}:${cfg.port} 접속 경로(터널 · VPN) 확인`);
    process.exit(1);
  });
  ssh.on('close', () => {
    console.error('[db:tunnel] SSH 연결 종료');
    process.exit(1);
  });

  ssh.connect({
    host: cfg.host,
    port: Number(cfg.port),
    username: cfg.user,
    password: cfg.password || undefined,
    privateKey: cfg.privateKeyPath ? readFileSync(cfg.privateKeyPath) : undefined,
    passphrase: cfg.passphrase || undefined,
    keepaliveInterval: 30000,
    readyTimeout: 15000,
  });
}

main();
