# sftp-deploy-kit

SFTP pull/upload을 쉽고 안전하게 — 변경 파일 자동 감지, 드리프트 체크, 백업/롤백·캐시버스팅까지 내장한 상태관리 자동화 CLI 패키지.

> **npm 레지스트리에는 배포되어 있지 않습니다.** `npm install sftp-deploy-kit`(짧은 형태)은 동작하지 않습니다 — 아래처럼 GitHub을 설치 대상으로 명시해야 합니다.

## 설치

```bash
npm install -D github:yanoo-dev/sftp-deploy-kit
```

새 버전을 받고 싶으면:
```bash
npm update sftp-deploy-kit
```

## 초기 설정

```bash
npx sftp-kit init
```
로컬 소스 폴더명·배포 매니페스트 이름을 물어보고 `.vscode/sftp.json`, `deploy/<이름>.deploy.json`을 자동 생성합니다(이미 있으면 건너뜀). 생성된 `.vscode/sftp.json`을 열어 접속정보(host/username/password/remotePath)를 채우고, `deploy/<이름>.deploy.json`에 올릴 파일 목록을 채우세요:
```json
{
  "remoteRoot": "/서버/절대/경로/하위폴더",
  "files": ["a.css", "sub/b.js"],
  "directories": ["assets/img"]
}
```

`.vscode/sftp.json`, `.env`, `deploy/*.deploy.json`(실제 매니페스트), `backups/`는 프로젝트 쪽 `.gitignore`에 추가하세요.

## 사용법

> `sftp-kit`은 `npm run`이 아니라 진짜 실행파일(bin)이라, 인자 앞에 `--`를 붙이지 않습니다.

**처음 받을 때 — 전체 구조 통째로**
```bash
npx sftp-kit pull --exclude="logs,tmp,uploads"
```
`--paths`를 생략하면 원격 `remoteRoot` 전체를 로컬로 재귀 미러링합니다. `--exclude`로 이름이 일치하는 폴더/파일(로그, 캐시, 업로드 원본 등 불필요한 것)을 제외할 수 있습니다.

**특정 파일만 받을 때**
```bash
npx sftp-kit pull --paths="a.css,b.js,sub/c.html"
```

**평소 작업 흐름**
```bash
# 1. 로컬에서 파일 수정
# 2. 변경분 자동 감지 → 업로드
npx sftp-kit upload:changed
```

## 명령어

| 명령어 | 역할 |
|---|---|
| `npx sftp-kit init` | `.vscode/sftp.json`/`deploy/*.json` 대화형 생성 |
| `npx sftp-kit pull [--exclude="a,b"]` | `remoteRoot` 전체 재귀 미러링 (+ 서버측 `.git` 자동 제거) |
| `npx sftp-kit pull --paths="a,b,c"` | 지정 파일만 받기 (+ 서버측 `.git` 자동 제거) |
| `npx sftp-kit upload:changed [<매니페스트이름>] [--force]` | 변경분 자동 감지 → 업로드 (기본 명령) |
| `npx sftp-kit upload` | 매니페스트 전체 업로드 |
| `npx sftp-kit track` | 매니페스트 파일들을 `.gitignore` 추적 예외로 등록 |
| `npx sftp-kit deploy:check --page=<이름>` | 로컬 파일 존재 여부만 점검 (업로드 안 함) |
| `npx sftp-kit deploy:backup --page=<이름> [--force]` | 드리프트 체크 + 백업만 |
| `npx sftp-kit deploy:rollback --page=<이름> [--backup=<id>]` | 백업 스냅샷으로 서버 복원 |
| `npx sftp-kit sftp:auto off` / `on` / `status` | VS Code `downloadOnOpen` 토글 |
| `npx sftp-kit remove-git` | 서버측 `.git` 잔여물 수동 제거 (pull에 이미 자동 포함됨) |

항상 프로젝트 루트(설정 파일이 있는 폴더)에서 실행하세요.

## SFTP / FTP

`.vscode/sftp.json`(또는 `.env`)에 `"protocol": "sftp"` 또는 `"ftp"`를 넣어 접속 방식을 고를 수 있습니다(생략 시 `sftp`). 순수 FTP만 지원하는 서버라면 `"ftp"`로 설정하세요 — 포트 기본값도 각각 22 / 21로 자동 적용됩니다.

## (선택) AI 코딩 툴 세션 충돌 방지

Claude Code처럼 터미널에서 직접 파일을 수정하는 AI 툴을 쓴다면, `.claude/settings.json`을 프로젝트에 추가하세요(이 파일은 `.gitignore`에 넣는 걸 권장):

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command",
      "command": "test -f .vscode/sftp.json && npx sftp-kit sftp:auto off >/dev/null 2>&1 || true" }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command",
      "command": "test -f .vscode/sftp.json && npx sftp-kit sftp:auto on >/dev/null 2>&1 || true" }] }]
  }
}
```
다른 AI 코딩 툴을 쓴다면 그 툴의 훅 방식으로 같은 타이밍에 `npx sftp-kit sftp:auto off`/`on`을 호출하면 됩니다.

## 관련

- 원본: [`php-local-kit`](https://github.com/yanoo-dev/php-local-kit)

## License

[MIT](./LICENSE)
