import { Client as FtpClient } from 'basic-ftp';

/**
 * basic-ftp를 ssh2-sftp-client와 같은 메서드 이름으로 감싼 어댑터
 *
 * withSftp()/uploadFiles()가 프로토콜과 무관하게 동일한 코드로 동작하도록,
 * connect/end/exists/mkdir/fastGet/fastPut 5개만 맞춰 제공한다.
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
}
