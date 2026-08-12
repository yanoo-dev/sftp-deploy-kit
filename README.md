# sftp-deploy-kit

SFTP pull/upload을 쉽고 안전하게 — 변경 파일 자동 감지, 드리프트 체크, 백업/롤백·캐시버스팅까지 내장한 상태관리 자동화 키트.

[`php-local-kit`](https://github.com/yanoo-dev/php-local-kit)에서 캡처/프리뷰(playwright) 부분을 뺀 SFTP 파이프라인만 독립시킨 것입니다. SFTP로 배포하는 프로젝트라면 스택·PHP 여부와 무관하게 재사용할 수 있습니다.

## 왜 필요한가

레거시 프로젝트를 SFTP로 직접 만지다 보면 이런 사고가 반복됩니다:

- 뭐가 바뀌었는지 기억 못 해서 전체를 다시 올림 (덮어쓰기 사고)
- 내가 받은 뒤 다른 사람이 서버에 뭔가 올렸는데 모르고 덮어씀
- 실수로 잘못 올렸는데 원본이 없어서 복구 불가
- CSS/JS 캐시버스팅 값을 수동으로 깜빡함
- 서버에 딸려있던 `.git`이 로컬 git과 충돌

이 키트는 이 5가지를 전부 코드로 강제합니다.

## 구조

```
sftp-deploy-kit/
├─ .vscode/sftp.json.example # 접속정보 템플릿 (복사해서 sftp.json으로 사용, git 제외)
├─ scripts/
│  ├─ sftp-pull.js           # 서버 → 로컬 받기
│  ├─ upload.js              # 매니페스트 전체 업로드
│  ├─ upload-changed.js      # git status 기준 변경분만 자동 업로드 (기본 사용 명령)
│  ├─ git-track.js           # 매니페스트 파일만 .gitignore 추적 예외로 등록
│  ├─ deploy-check.js        # 업로드 전 로컬 파일 존재만 검증
│  ├─ deploy-backup.js       # 업로드 전 서버 백업 + 드리프트 체크
│  ├─ deploy.js              # 실제 업로드 실행
│  ├─ deploy-rollback.js     # 백업본으로 서버 복원
│  ├─ remove-git.js          # 서버측 잔여 .git 제거 (pull에 자동 포함됨)
│  ├─ sftp-auto.js           # VS Code downloadOnOpen on/off 토글
│  └─ lib/                   # 위 스크립트들이 공유하는 헬퍼(config/sftp/manifest/confirm-upload/cache-bust 등)
├─ deploy/example.deploy.json # 배포 매니페스트 템플릿 — 프로젝트별로 이름 바꿔서 씀
├─ workspaces/html/          # ← 실제 소스가 받아지는 자리 (기본값일 뿐, 아래 참고)
├─ backups/                  # 자동 백업 스냅샷 + .last-deployed(드리프트 체크 기준점)
├─ .env.example
├─ .gitignore
└─ package.json
```

> **`workspaces/html/`이 고정 이름은 아닙니다.** 아무 설정 안 했을 때의 기본값일 뿐이고, `.vscode/sftp.json`의 `"context"`(또는 `.env`의 `SFTP_LOCAL_ROOT`)를 원하는 이름으로 바꾸면 그 폴더에 소스가 받아지고 모든 스크립트가 그 이름을 따라갑니다.

## 설치

**GitHub에서 (권장)**
```bash
npx degit yanoo-dev/sftp-deploy-kit <새 프로젝트 폴더>
cd <새 프로젝트 폴더>
npm install
```
degit은 git 히스토리를 아예 안 가져오는 도구라 이 키트의 커밋 이력이 새 프로젝트에 섞이지 않습니다.

**로컬 경로에서 (GitHub 등록 전 또는 사내망 전용일 때)**
```bash
rsync -a --exclude='.git' /path/to/sftp-deploy-kit/ <새 프로젝트 폴더>/
cd <새 프로젝트 폴더>
npm install
```
`cp -r`이 아니라 `rsync --exclude='.git'`을 쓰는 이유는 아래 [git 충돌 없이 쓰는 법](#git-충돌-없이-쓰는-법) 참고.

## 초기 설정

```bash
cp .vscode/sftp.json.example .vscode/sftp.json
```
`.vscode/sftp.json`을 열어 접속정보를 채웁니다 (host/port/username/password/remotePath/context). `.vscode/sftp.json`이 있으면 `.env`보다 항상 우선합니다.

```bash
mv deploy/example.deploy.json deploy/<프로젝트키>.deploy.json
```
```json
{
  "remoteRoot": "/서버/절대/경로/하위폴더",
  "files": ["a.css", "sub/b.js"],
  "directories": ["assets/img"]
}
```
이 매니페스트에 없는 파일은 어떤 명령으로도 절대 업로드되지 않습니다.

## 사용법

**처음 받을 때**
```bash
npm run pull -- --paths="a.css,b.js,sub/c.html"
```
지정한 파일을 서버에서 받고, 서버측에 딸려있던 `.git`을 자동으로 제거합니다.

**평소 작업 흐름**
```
1. 로컬에서 파일 수정
2. npm run upload:changed
   → git status 로 바뀐 파일 자동 감지
   → 매니페스트 대상만 필터링
   → 바뀐 CSS/JS를 참조하는 HTML의 캐시버스팅(?time=) 자동 갱신
   → 드리프트 체크(서버가 마지막 배포 이후 바뀌었는지)
   → y/n 확인
   → 업로드
```

## 명령어

| 명령어 | 역할 |
|---|---|
| `npm run pull -- --paths="a,b,c"` | 지정 파일 서버에서 받기 (+ 서버측 `.git` 자동 제거) |
| `npm run upload:changed [-- <매니페스트이름>] [--force]` | git status 기준 변경분 자동 감지 → 업로드 (기본 명령) |
| `npm run upload` | 매니페스트 전체 업로드 |
| `npm run track` | 매니페스트 파일들을 `.gitignore` 추적 예외로 등록 |
| `npm run deploy:check -- --page=<이름>` | 로컬 파일 존재 여부만 점검 (업로드 안 함) |
| `npm run deploy:backup -- --page=<이름> [--force]` | 드리프트 체크 + 백업만 |
| `npm run deploy:rollback -- --page=<이름> [--backup=<id>]` | 백업 스냅샷으로 서버 복원 |
| `npm run sftp:auto:off` / `:on` / `:status` | VS Code `downloadOnOpen` 토글 |
| `npm run remove-git` | 서버측 `.git` 잔여물 수동 제거 (pull에 이미 자동 포함됨) |

## 안전장치

- **드리프트 체크**: 업로드 직전 서버 실제 내용을 다시 받아, 우리가 마지막으로 성공 배포한 내용(`backups/.last-deployed/`)과 바이트 단위 비교. 다르면 중단, `--force`로만 강행
- **업로드 전 y/n 확인**: 우회 옵션 없음, 어떤 경로로 와도 항상 확인받음
- **자동 백업 + 롤백**: 업로드 전 서버 원본을 `backups/`에 저장, 문제 생기면 즉시 복원 가능
- **매니페스트 허용목록**: 명시적으로 등록한 파일 외에는 업로드 경로 자체가 없음 — `.git` 등 민감 파일이 새나갈 구조적 여지가 없음

한계: 드리프트 체크와 실제 업로드(y/n 확인 대기 포함) 사이에는 시간차가 있어 완전한 원자적 보호는 아닙니다. 실사용 빈도상 리스크는 낮지만 이론상 100% 차단은 아닙니다.

## git 충돌 없이 쓰는 법

이 키트를 여러 프로젝트에 복사해 쓰다 보면 "어디서 git이 충돌하는지" 헷갈리기 쉬워 라이프사이클을 명확히 정리합니다.

```
① 키트를 프로젝트에 복사 (rsync --exclude='.git' 또는 degit)
   → 키트 자신의 git 흔적 0개 (실측 검증됨)

② 그 프로젝트 폴더에서 git init (프로젝트 자체의 백업/이력 관리용)
   → ①에서 아무것도 안 남았으니 충돌할 게 없음. 새 git 하나만 생김

③ npm run pull (SFTP로 서버 원본을 받아옴)
   → 서버측에 .git이 딸려있으면 pull 실행 시 자동 제거 (remove-git 체이닝)

결과: 프로젝트 전체에 git은 ②에서 만든 것 하나만 존재.
       키트 코드와 받아온 서버 소스 전부 그 git 안에 일반 파일로 들어간다.
```

**핵심**: `.git`이 남을 수 있는 지점은 ①(키트 자신)과 ③(서버 원본) 두 곳뿐이고, 둘 다 이미 자동으로 처리됩니다. ②는 사용자가 직접 새로 만드는 것이라 애초에 "딸려오는 git"이 아니라 충돌 대상이 아닙니다.

## (선택) AI 코딩 툴 세션 충돌 방지

VS Code SFTP 확장의 `downloadOnOpen: true`는 파일 탭을 열 때마다 서버 최신본으로 덮어씁니다. 원래는 사람끼리 덮어쓰기 방지용이지만, 터미널에서 직접 파일을 수정하는 AI 코딩 툴과 같이 쓰면 **AI가 방금 고친 내용이 파일을 열자마자 조용히 사라지는** 부작용이 있습니다.

이건 특정 AI 툴(예: Claude Code)에서만 의미가 있는 설정이라 이 키트엔 기본 포함하지 않고 `.gitignore`에 `.claude/`를 넣어뒀습니다. Claude Code를 쓴다면 프로젝트에 아래처럼 `.claude/settings.json`을 직접 추가하세요:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command",
      "command": "test -f .vscode/sftp.json && node scripts/sftp-auto.js off >/dev/null 2>&1 || true" }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command",
      "command": "test -f .vscode/sftp.json && node scripts/sftp-auto.js on >/dev/null 2>&1 || true" }] }]
  }
}
```
세션 시작 시 `downloadOnOpen`을 자동으로 끄고 종료 시 다시 켭니다. `Stop` 훅이 아니라 `SessionStart`/`SessionEnd`를 쓴 이유는 `Stop`이 응답 하나 끝날 때마다(대화 중간중간) 계속 fire되기 때문입니다. `.vscode/sftp.json`이 없는 프로젝트에서도 에러 없이 통과합니다.

다른 AI 코딩 툴을 쓴다면 그 툴의 훅/설정 방식으로 `node scripts/sftp-auto.js off`/`on`을 같은 타이밍에 호출하면 동일하게 적용됩니다.

한계: 터미널을 강제 종료하면 `SessionEnd`가 못 뛸 수 있습니다 — 가끔 `npm run sftp:auto:status`로 확인하세요.

## 알려진 함정 히스토리

- **`context` 커스텀 무시 버그 (2026-08-12 발견, 해결됨)**: `.vscode/sftp.json`의 `context`로 로컬 소스 폴더명을 자유롭게 바꿀 수 있다고 했지만, `sftp-pull.js`/`deploy.js`/`deploy-check.js`가 실제로는 `workspaces/html`을 하드코딩하고 있어서 다른 폴더명을 쓰면 강제 종료됐습니다. 전부 `cfg.localRoot`/`manifest.localRoot`를 실제로 쓰도록 수정 — 이제 `context`를 뭘로 바꾸든 정상 동작합니다(실측 테스트 완료).
- **`--force` 무시 버그 (2026-07-27 발견, 해결됨)**: Node `parseArgs`는 `type:'string'` 옵션에 값 없이 단독 플래그(`--force`)가 오면 조용히 무시합니다. `force`/`quiet`를 `boolean` 타입으로 선언해야 실제로 인식됩니다.
- **SFTP 연속 쓰기 제한**: 일부 서버가 한 세션에서 연속 6~7회 이상 쓰면 이후 요청을 `Permission denied`로 거부합니다. 5개 배치 + 파일 사이 300ms 지연으로 회피 처리되어 있습니다.

## 관련

- 원본: [`php-local-kit`](https://github.com/yanoo-dev/php-local-kit) — 캡처+DB없는 로컬 프리뷰까지 필요하면 이쪽 사용
- 문서: `~/Yanoo-Log/01. Project/03. Library/02. sftp-deploy-kit/`
