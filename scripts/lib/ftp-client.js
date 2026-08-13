import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client as FtpClient } from 'basic-ftp';

/**
 * basic-ftp를 ssh2-sftp-client와 같은 메서드 이름으로 감싼 어댑터
 *
 * withSftp()/uploadFiles()가 프로토콜과 무관하게 동일한 코드로 동작하도록,
 * connect/end/exists/mkdir/fastGet/fastPut/downloadDir을 맞춰 제공한다.
 */
export class FtpClientAdapter {
  #client = new FtpClient();

  async connect(config) {
    await this.#client.access({ ...config, secure: false });
  }

  async end() {
    this.#client.close();
  }

  async exists(remotePath) {
    try {
      await this.#client.size(remotePath); // 파일이면 성공
      return true;
    } catch {
      try {
        const cwd = await this.#client.pwd(); // 디렉터리인지 재확인
        await this.#client.cd(remotePath);
        await this.#client.cd(cwd);
        return true;
      } catch {
        return false;
      }
    }
  }

  async mkdir(remotePath) {
    const cwd = await this.#client.pwd();
    await this.#client.ensureDir(remotePath); // 없으면 재귀 생성 + cd 이동
    await this.#client.cd(cwd);
  }

  async fastPut(local, remote) {
    await this.#client.uploadFrom(local, remote);
  }

  async fastGet(remote, local) {
    await this.#client.downloadTo(local, remote);
  }

  /**
   * remoteDir을 localDir로 재귀 다운로드 (basic-ftp엔 필터 있는 재귀 다운로드가 없어 직접 구현)
   *
   * options.filter(fullPath, isDir)가 false를 반환하는 항목은 건너뛴다.
   */
  async downloadDir(remoteDir, localDir, options = {}) {
    const { filter } = options;
    mkdirSync(localDir, { recursive: true });
    const entries = await this.#client.list(remoteDir);
    for (const entry of entries) {
      const remotePath = `${remoteDir}/${entry.name}`;
      if (filter && !filter(remotePath, entry.isDirectory)) {
        continue;
      }
      const localPath = join(localDir, entry.name);
      if (entry.isDirectory) {
        await this.downloadDir(remotePath, localPath, options);
      } else {
        await this.#client.downloadTo(localPath, remotePath);
      }
    }
  }
}
