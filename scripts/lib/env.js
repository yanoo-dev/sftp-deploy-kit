import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { loadConfig } from './config.js';

/**
 * 키 파일을 동기적으로 읽는다
 *
 * 경로가 잘못되면 명확한 메시지로 종료한다.
 */
function readFileSafe(path) {
  try {
    return readFileSync(path);
  } catch {
    console.error(`SFTP 키 파일을 읽을 수 없습니다: ${path}`);
    process.exit(1);
  }
}

/**
 * 접속 설정을 ssh2-sftp-client 옵션으로 변환 (sftp.json 우선, .env 폴백)
 *
 * loadConfig() 단일 소스를 사용한다. privateKeyPath 가 있으면 키 인증을
 * 우선하고, 없으면 비밀번호 인증을 쓴다. deploy 계열도 pull/check 와 같은
 * 접속 정보를 공유한다.
 */
export function sftpConfig() {
  const cfg = loadConfig();
  if (!cfg.host || !cfg.user) {
    console.error(`SFTP host / username 이 없습니다 (${cfg.source}).`);
    process.exit(1);
  }

  const config = {
    host: cfg.host,
    port: Number(cfg.port || 22),
    username: cfg.user,
  };

  if (process.env.SFTP_READY_TIMEOUT) {
    config.readyTimeout = Number(process.env.SFTP_READY_TIMEOUT);
  }

  if (cfg.privateKeyPath) {
    // 키 인증 우선
    config.privateKey = readFileSafe(cfg.privateKeyPath);
    if (cfg.passphrase) {
      config.passphrase = cfg.passphrase;
    }
  } else {
    config.password = cfg.password || '';
  }

  return config;
}

/**
 * 접속 설정을 basic-ftp 옵션으로 변환 (loadConfig() 단일 소스, sftp.json 우선/.env 폴백)
 *
 * FTP는 키 인증 개념이 없어 host/port/user/password만 다룬다.
 */
export function ftpConfig() {
  const cfg = loadConfig();
  if (!cfg.host || !cfg.user) {
    console.error(`FTP host / username 이 없습니다 (${cfg.source}).`);
    process.exit(1);
  }

  return {
    host: cfg.host,
    port: Number(cfg.port || 21),
    user: cfg.user,
    password: cfg.password || '',
  };
}
