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
mkdir -p .vscode
cp node_modules/sftp-deploy-kit/.vscode/sftp.json.example .vscode/sftp.json
```
`.vscode/sftp.json`을 열어 접속정보를 채웁니다 (host/port/username/password/remotePath/context).

```bash
mkdir -p deploy
cp node_modules/sftp-deploy-kit/deploy/example.deploy.json deploy/<프로젝트키>.deploy.json
```
```json
{
  "remoteRoot": "/서버/절대/경로/하위폴더",
  "files": ["a.css", "sub/b.js"],
  "directories": ["assets/img"]
}
```

`.vscode/sftp.json`, `.env`, `deploy/*.deploy.json`(실제 매니페스트), `backups/`는 프로젝트 쪽 `.gitignore`에 추가하세요.

## 사용법

**처음 받을 때**
```bash
npx sftp-kit pull -- --paths="a.css,b.js,sub/c.html"
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
| `npx sftp-kit pull -- --paths="a,b,c"` | 지정 파일 서버에서 받기 (+ 서버측 `.git` 자동 제거) |
| `npx sftp-kit upload:changed [-- <매니페스트이름>] [--force]` | 변경분 자동 감지 → 업로드 (기본 명령) |
| `npx sftp-kit upload` | 매니페스트 전체 업로드 |
| `npx sftp-kit track` | 매니페스트 파일들을 `.gitignore` 추적 예외로 등록 |
| `npx sftp-kit deploy:check -- --page=<이름>` | 로컬 파일 존재 여부만 점검 (업로드 안 함) |
| `npx sftp-kit deploy:backup -- --page=<이름> [--force]` | 드리프트 체크 + 백업만 |
| `npx sftp-kit deploy:rollback -- --page=<이름> [--backup=<id>]` | 백업 스냅샷으로 서버 복원 |
| `npx sftp-kit sftp:auto off` / `on` / `status` | VS Code `downloadOnOpen` 토글 |
| `npx sftp-kit remove-git` | 서버측 `.git` 잔여물 수동 제거 (pull에 이미 자동 포함됨) |

항상 프로젝트 루트(설정 파일이 있는 폴더)에서 실행하세요.

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
