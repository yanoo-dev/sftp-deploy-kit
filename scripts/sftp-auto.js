import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const CONFIG_PATH = join(ROOT, '.vscode', 'sftp.json');
const DOWNLOAD_ON_OPEN_KEY = 'downloadOnOpen';

const mode = process.argv[2];

if (!['on', 'off', 'status'].includes(mode)) {
  console.error('사용법: npm run sftp:auto -- on|off|status');
  process.exit(1);
}

if (!existsSync(CONFIG_PATH)) {
  console.error(`sftp.json을 찾을 수 없습니다: ${CONFIG_PATH}`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));

if (mode === 'status') {
  console.log(`${DOWNLOAD_ON_OPEN_KEY}: ${config[DOWNLOAD_ON_OPEN_KEY] === true ? 'on' : 'off'}`);
  process.exit(0);
}

const enabled = mode === 'on';

config[DOWNLOAD_ON_OPEN_KEY] = enabled;

writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 4)}\n`, 'utf8');

console.log(`SFTP downloadOnOpen ${enabled ? 'ON' : 'OFF'}`);
console.log(`${DOWNLOAD_ON_OPEN_KEY}: ${config[DOWNLOAD_ON_OPEN_KEY]}`);
