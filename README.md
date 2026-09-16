# sftp-deploy-kit

SFTP/FTP pull·upload를 쉽고 안전하게 — 변경 파일 자동 감지, 드리프트 체크, 백업/롤백, 캐시버스팅, 커밋 전 업로드 보장(pre-commit 훅)까지 내장한 상태관리 자동화 CLI 패키지.

> **npm 레지스트리에는 배포되어 있지 않습니다.** `npm install sftp-deploy-kit`(짧은 형태)은 동작하지 않습니다 — 아래처럼 GitHub을 설치 대상으로 명시해야 합니다.

## 설치

```bash
npm install -D github:yanoo-dev/sftp-deploy-kit
```

새 버전을 받고 싶으면:
```bash
npm update sftp-deploy-kit
```

## 빠른 시작 — 새 프로젝트를 서버와 연결하는 순서

처음 한 번만 아래 순서대로. 이미 있는 단계는 건너뛰면 됩니다.

**손으로 만드는 건 빈 폴더 1개, 손으로 채우는 건 설정 파일 2개뿐** — 나머지는 각 단계의 명령이 만듭니다.

| 폴더/파일 | 누가 만드나 | 단계 |
|---|---|---|
| `my-site/` (프로젝트 루트) | **직접** — `mkdir` 또는 `git clone` | 1 |
| `package.json` · `node_modules/` | `npm init -y` · `npm install` | 2 |
| `package.json`의 `scripts` 12개 | `npx sftp-kit init` (자동 등록) | 3 |
| `.vscode/sftp.json` · `deploy/<이름>.deploy.json` · `.env` · `backups/` | `npx sftp-kit init` (빈 템플릿) | 3 |
| `.gitignore`(설정·백업 제외) · `.gitattributes`(`eol=lf`) | `npx sftp-kit init` (없는 줄만 추가) | 3 |
| `.vscode/sftp.json` 접속정보 · 매니페스트 내용 | **직접 채움** | 4·5 |
| `html/` (소스 폴더 = 실제 작업 폴더) | `npm run pull` — 서버에서 받아오며 자동 생성 | 6 |
| `.git/hooks/pre-commit` | `npm run hook:install` | 7 |

**1. 프로젝트 루트 폴더 준비** — 직접 만든 이 폴더로 `cd`해서 들어간 뒤, 아래 명령은 전부 그 안에서 실행합니다. 이름은 자유(`web`, `my-site` 등). 소스 폴더(`html`)는 직접 만들지 않습니다 — 6번 `pull`이 이 루트 안에 자동 생성합니다.
```bash
mkdir my-site && cd my-site && git init
# 레포가 이미 있으면 대신:  git clone <주소> my-site && cd my-site
```

**2. 키트 설치**
```bash
npm init -y                                   # package.json 이 없을 때만
npm install -D github:yanoo-dev/sftp-deploy-kit
```

**3. 초기화** — 이 한 번만 `npx`로 실행합니다(아직 스크립트가 없으므로). 로컬 소스 폴더명·매니페스트 이름을 물어보면 답합니다. 소스 폴더명 기본값은 `web`이므로 루트를 `web`으로 지었다면 `html`처럼 **다른 이름**으로 답하세요(`web/web/` 방지).
```bash
npx sftp-kit init
```
정상이면 터미널에 이렇게 찍힙니다(이름은 답한 값):
```
[init] 생성: .vscode/sftp.json (context: "html")
[init] 생성: deploy/mysite.deploy.json
[init] 생성: .env (폴백용 — .vscode/sftp.json이 있으면 이건 안 씀)
[init] 생성: backups/.gitkeep
[init] package.json scripts 등록: init, pull, upload:changed, …
[init] .gitignore 추가: .vscode/sftp.json, .env, deploy/*.deploy.json, backups/, node_modules/
[init] .gitattributes 추가: * text=auto eol=lf
[init] 완료. 다음 순서: …
```
이후부터는 전부 `npm run …`으로 실행합니다. 생성된 파일 확인:
```bash
ls -a .vscode deploy          # .vscode 는 점으로 시작하는 숨김 폴더 — ls -a 로 봐야 보임
```
Finder에서는 `⌘ ⇧ .` 로 숨김 파일을 켜야 `.vscode`가 보이고, VS Code 탐색기에는 기본으로 보입니다.

> 안 될 때
> - `Missing script: "init"` → `npm run init`으로 실행한 것. 첫 1회는 `npx sftp-kit init`
> - `[init] 이미 있음, 건너뜀: .vscode/sftp.json` → 이미 파일이 있는 것(clone한 레포에 들어있던 경우). 그 파일을 4번에서 그대로 채우면 됨
> - 아무 것도 안 생김 → `pwd`로 지금 위치가 `package.json` 있는 프로젝트 루트인지 확인. init은 **현재 폴더**에 만듭니다

**4. 접속정보 입력** — 3번이 만든 `.vscode/sftp.json`(숨김 폴더 안)을 열어 아래처럼 채웁니다. `host`·`username`·`password`·`remotePath`는 서버 담당자에게 받은 값, `context`는 3번에서 답한 소스 폴더명 (키 설명은 「초기 설정 3」).
```bash
code .vscode/sftp.json        # VS Code 로 열기 (또는 탐색기에서 .vscode 폴더 → sftp.json)
```
```json
{
  "protocol": "ftp",
  "host": "서버주소",
  "port": 21,
  "username": "계정",
  "password": "비밀번호",
  "remotePath": "/html",
  "context": "html",
  "pullRemoteRoot": "/html",
  "pullExclude": "logs,tmp,sessions"
}
```

**5. 올릴 범위 지정** — 3번이 만든 `deploy/<이름>.deploy.json`을 열어, `remoteRoot`(서버 기준 폴더)와 내가 작업하는 폴더만 적습니다. 어떤 폴더가 있는지 모르면 6번 `pull`을 먼저 하고 받아온 구조를 보고 채워도 됩니다 (「초기 설정 4」).
```json
{
  "remoteRoot": "/html",
  "files": [],
  "directories": ["assets/css", "assets/js", "pages/my-site"]
}
```

**6. 서버 소스 받기** — 이 커밋이 "서버 원본" 기준점입니다.
```bash
npm run pull
git add -A && git commit -m "backup: 초기 pull"
```

**7. 훅 설치** — 업로드 안 된 변경이 커밋되는 것을 막습니다.
```bash
npm run hook:install
```

**8. 연결 확인** — 파일 하나 수정한 뒤:
```bash
npm run upload:changed                 # 바뀐 파일 목록 확인 후 y → 서버에서 반영 확인
git commit -am "test: 연결 확인"        # 훅을 통과하면 연결 완료
```

끝나면 프로젝트 루트는 이런 모양입니다:
```
my-site/                       ← 프로젝트 루트 = 1번에서 직접 만든 폴더 (npm run 은 항상 여기서)
├─ package.json                ← 2번 생성, 3번이 scripts 등록
├─ .gitignore · .gitattributes ← 3번이 필요한 줄 추가
├─ .vscode/sftp.json           ← 3번이 생성, 4번에서 채움 (git 제외)
├─ deploy/<이름>.deploy.json   ← 3번이 생성, 5번에서 채움 (git 제외)
├─ backups/                    ← 3번 생성, 업로드 때 자동 사용 (git 제외)
└─ html/                       ← 6번 pull 이 자동 생성 — 서버 미러 = 실제 작업 폴더 (context 값)
```

이후 평소 작업은 **수정 → `npm run upload:changed` → `git commit`** 반복. 서버를 남이 바꿨을 수 있으면 먼저 `npm run pull`. 명령·플래그가 헷갈리면 `npx sftp-kit --help`.

## 초기 설정

**1. package.json 스크립트** — `npx sftp-kit init`이 자동 등록합니다. 수동으로 맞추거나 이름을 바꾸고 싶을 때만 아래를 참고하세요(아래 문서는 전부 `npm run` 기준입니다).
```json
{
  "scripts": {
    "init": "sftp-kit init",
    "pull": "sftp-kit pull",
    "upload": "sftp-kit upload",
    "upload:changed": "sftp-kit upload:changed",
    "track": "sftp-kit track",
    "remove-git": "sftp-kit remove-git",
    "sftp:auto": "sftp-kit sftp:auto",
    "deploy": "sftp-kit deploy",
    "deploy:check": "sftp-kit deploy:check",
    "deploy:backup": "sftp-kit deploy:backup",
    "deploy:rollback": "sftp-kit deploy:rollback",
    "hook:install": "sftp-kit hook:install"
  }
}
```
`--exclude=`/`--paths=`/`--page=`/`--only=`/`--force`/`--backup=` 같은 **플래그가 붙는 명령은 `npm run <명령> -- --플래그`처럼 `--`를 한 번 넣어야** 인자가 전달됩니다. 스크립트를 등록하지 않았다면 `npm run <명령>` 자리에 `npx sftp-kit <명령>`을 쓰면 됩니다(이때는 `--` 불필요).

**2. 설정 파일 생성**
```bash
npx sftp-kit init        # 처음엔 npx (스크립트 등록 전). 이후 다시 돌릴 땐 npm run init
```
로컬 소스 폴더명·배포 매니페스트 이름을 물어보고 `.vscode/sftp.json`, `deploy/<이름>.deploy.json`, `.env`(폴백용), `backups/`를 만들고, `package.json` 스크립트와 `.gitignore`·`.gitattributes` 필수 줄을 등록합니다(이미 있는 것은 전부 건너뜀 — 여러 번 실행해도 안전).

**3. `.vscode/sftp.json` 채우기** — VS Code SFTP 확장과 같은 파일을 공유하며, 키트 전용 키 3개가 더 있습니다:

| 키 | 역할 |
|---|---|
| `host` / `port` / `username` / `password` / `protocol` | 접속 정보. `protocol`은 `sftp`(기본, 22) 또는 `ftp`(21) |
| `remotePath` | 업로드 기준 서버 폴더 (매니페스트 `remoteRoot`가 있으면 그게 우선) |
| `context` | 로컬 소스 폴더명 (예: `web`, `html`) — pull 받는 곳이자 매니페스트 경로의 기준 |
| `pullRemoteRoot` | pull로 받아올 서버 폴더. `remotePath`와 다르면 `deploy` 계열이 경고를 띄웁니다 |
| `pullExclude` | pull에서 뺄 폴더/파일 이름(콤마 구분). `logs,tmp,sessions,uploads`처럼 — **`--exclude` 플래그 대신 여기에 적는 것이 정본** |
| `skipGitTrack` | `true`면 `upload:changed`가 `.gitignore` 자동 편집(`track`)을 건너뜀 |

**4. `deploy/<이름>.deploy.json` 채우기**
```json
{
  "remoteRoot": "/서버/절대/경로/하위폴더",
  "files": ["_modules/site/views/layer_popup.html"],
  "directories": ["assets/css", "pages/site_a"]
}
```
`directories`는 재귀 전체, `files`는 파일 하나씩 명시. 다른 담당자 영역(컨트롤러·모델 등)이 섞인 폴더는 통째로 넣지 말고 필요한 파일만 `files`에 적으세요.

**5. `.gitignore`·`.gitattributes`** — `init`이 넣어줍니다. 직접 관리한다면:
- `.vscode/sftp.json`, `.env`, `deploy/*.deploy.json`, `backups/`, `node_modules/`는 `.gitignore`에 (접속정보·로컬 설정)
- `.gitattributes`에 `* text=auto eol=lf` — 서버 파일이 CRLF여도 git엔 LF로 담기고, pre-commit 훅·pull 비교가 줄바꿈 차이로 오탐하지 않습니다

**6. 커밋 전 업로드 보장 훅 설치** (권장)
```bash
npm run hook:install
```

## 사용법

**처음 받을 때 — 전체 구조 통째로**
```bash
npm run pull
```
`.vscode/sftp.json`의 `pullRemoteRoot`(없으면 `remotePath`) 전체를 로컬 `context` 폴더로 재귀 미러링합니다. 두 번째부터는 크기·수정시각이 같은 파일은 건너뜁니다. 서버측 `.git` 잔여물은 자동 제거됩니다.

`--exclude`를 직접 붙이면 설정의 `pullExclude`를 **덮어씁니다**(경고 출력). 제외 목록은 설정 파일에 두고, 플래그는 일회성 예외에만 쓰세요.

**특정 파일만 받을 때**
```bash
npm run pull -- --paths="a.css,b.js,sub/c.html"
```

**평소 작업 흐름**
```bash
# 1. 로컬에서 파일 수정
# 2. 변경분 자동 감지 → 업로드 (업로드 목록을 보여주고 y/n 확인)
npm run upload:changed
# 3. 그 다음 git commit (훅이 "업로드 안 된 변경"을 막아줍니다)
```

`upload:changed`는 **`git status`의 미커밋 변경 전부**(스테이징 여부 무관)를 대상으로 봅니다. 그래서
- **커밋을 먼저 하면 그 파일은 목록에서 빠져 영영 업로드되지 않습니다** — 반드시 업로드 → 커밋 순서. 놓쳤다면 `npm run deploy -- --page=<이름> --only=<경로>`로 그 파일만 올리세요
- 같은 워킹트리에서 다른 사람(또는 다른 작업)의 미커밋 파일도 같이 올라갑니다 — 확인 프롬프트의 목록을 보고 판단하세요
- 터미널이 아닌 곳(AI 에이전트 등)에서 돌릴 땐 `yes | npm run upload:changed`처럼 답을 파이프로 넘겨야 합니다. 답이 없으면 전송하지 않고 명확히 실패로 끝납니다

**커밋 전 업로드 보장 (pre-commit 훅)**

`npm run hook:install`은 `.git/hooks/pre-commit`을 설치합니다. 스테이징된 파일을 `backups/.last-deployed/`(마지막으로 실제 배포·pull한 내용)와 비교해, 아직 서버에 올라가지 않은 변경이 있으면 커밋을 막고 파일 목록을 보여줍니다.
- 이미 훅이 있으면 덮어쓰지 않습니다 — 갱신하려면 `npm run hook:install -- --force`
- 업로드 직후 에디터가 파일을 다시 저장(끝 공백 제거 등)해도 훅이 잡아냅니다. 이건 오탐이 아니라 진짜 차이이므로 `--no-verify`로 뚫지 말고 다시 `upload:changed` 하세요 — 뚫으면 서버와 git이 어긋난 채로 남습니다
- `deploy -- --only=`로 올린 파일도 스냅샷이 갱신됩니다

## 명령어

| 명령어 | 역할 |
|---|---|
| `npm run init` | `.vscode/sftp.json`/`deploy/*.json`/`.env` 대화형 생성 |
| `npm run pull` | `pullRemoteRoot` 전체 재귀 미러링 (+ 서버측 `.git` 자동 제거). `-- --exclude="a,b"`는 설정 덮어쓰기(경고) |
| `npm run pull -- --paths="a,b,c"` | 지정 파일만 받기 |
| `npm run upload:changed [-- <매니페스트이름>] [-- --force]` | 변경분 자동 감지 → 업로드 (기본 명령) |
| `npm run upload` | 매니페스트 전체 업로드 |
| `npm run track` | manifest 디렉토리를 `.gitignore` 추적 예외로 등록 (아래 참고) |
| `npm run deploy:check -- --page=<이름> [--only=path1,path2]` | 로컬 파일 존재 여부만 점검 (업로드 안 함) |
| `npm run deploy:backup -- --page=<이름> [--only=path1,path2] [--force]` | 드리프트 체크 + 백업만 |
| `npm run deploy -- --page=<이름> [--only=path1,path2]` | manifest 기준 실제 업로드 (y/n 확인 필수) |
| `npm run deploy:rollback -- --page=<이름> [--backup=<id>]` | 백업 스냅샷으로 서버 복원 |
| `npm run hook:install [-- --force]` | pre-commit 훅 설치(업로드 안 된 변경 커밋 차단) |
| `npm run sftp:auto off` / `on` / `status` | VS Code `downloadOnOpen` 토글 |
| `npm run remove-git` | 서버측 `.git` 잔여물 수동 제거 (pull에 이미 자동 포함됨) |
| `npx sftp-kit --help` / `npx sftp-kit <명령> --help` | 사용법만 출력하고 **실행하지 않음** |

항상 프로젝트 루트(설정 파일이 있는 폴더)에서 실행하세요. 명령어 이름을 모르거나 플래그를 확인하고 싶을 땐 `--help`를 붙이세요 — 어떤 플래그를 잘못 적어도 그 명령이 실제로 실행되는 일은 없습니다.

**`pull`은 파일 하나가 안 받아져도 전체가 죽지 않습니다** — 목록(list)엔 있는데 실제 전송에서 없다고 나오는 파일(한글 파일명 인코딩 문제, 목록 조회 이후 서버측 삭제 등)은 경고만 남기고 건너뛰며, 마지막에 못 받은 파일 목록을 모아서 보여줍니다(하나라도 있으면 exit code 1).

**드리프트 체크** — `upload:changed`/`deploy`는 올리기 전에 원격 파일을 `backups/<시각>/`에 백업하면서 「우리가 마지막으로 배포한 내용」과 비교합니다. 다른 사람이 서버에서 직접 고친 파일이 있으면 중단하고 알려줍니다. 백업본을 로컬과 diff해서(`\r` 제거 후) 진짜 변경이면 로컬에 먼저 반영한 뒤 `-- --force`로 이어가세요. `--force`는 이 경고를 통과시키는 것이지 원격을 무시하고 덮어쓰라는 뜻이 아닙니다.

**업로드 경로와 pull 경로가 다르면 경고합니다** — `.vscode/sftp.json`의 `remotePath`/`pullRemoteRoot`(또는 manifest의 `remoteRoot`)가 서로 다른 값이면 `deploy`/`deploy:check`/`deploy:backup` 실행 시 경고를 띄웁니다. 정상적으로 둘 다 같은 서버 폴더를 가리켜야 하며, 다르면 "pull로 받은 위치"와 "실제 배포되는 위치"가 어긋나는 설정 실수일 가능성이 높습니다.

**`track`은 manifest에 선언된 디렉토리를 통째로 열고, `deploy/no-upload.txt`에 매칭되는 파일만 다시 닫습니다** — `.gitignore` 크기가 파일 수가 아니라 manifest 디렉토리 개수에 비례하고, 새 파일이 생겨도 `track`을 다시 돌릴 필요가 없습니다. 특정 파일만 git 추적에서 계속 빼고 싶다면(예: 다른 담당자가 서버에서 직접 작업하는 파일) `deploy/no-upload.txt`에 패턴을 등록하세요(파일명 또는 `*` 와일드카드, 한 줄에 하나) — `deploy`/`upload:changed`의 업로드 대상에서도 같이 제외됩니다. manifest `files`에만 적힌 파일은 그 파일 한 줄만 예외로 열립니다.

## 캐시버스팅 — 동작과 한계

`upload:changed`는 바뀐 CSS/JS를 참조하는 HTML 안의 `파일명.css?time=…` 값을 오늘 시각으로 갱신하고, 그 HTML도 같이 올립니다. 이건 **HTML 소스에 `파일명?time=` 리터럴이 그대로 적혀 있을 때만** 동작합니다.

- **PHP 등이 런타임에 경로를 조립하는 HTML**(`<?=$dir.'/'.$name?>.css?time=…`처럼 소스에 파일명 문자열이 없는 경우)은 매칭되지 않아 `?time=`이 영원히 안 바뀝니다 — 서버엔 새 파일, 방문자는 옛 캐시. 이런 구조에선 템플릿 쪽에서 `?v=<?=filemtime($path)?>`처럼 **파일 수정시각을 직접 붙이는 방식**을 쓰세요(키트가 손댈 일이 없어짐)
- 매칭은 **파일명(basename) 기준**입니다. 여러 사이트가 같은 이름(`basic.css`)을 쓰면 한 사이트의 CSS를 올려도 다른 사이트 HTML의 `basic.css?time=`이 같이 갱신됩니다. 실제 피해는 없지만 "안 건드린 HTML이 업로드 목록에 뜨는" 이유가 이것입니다

## SFTP / FTP
`.vscode/sftp.json`(또는 `.env`)에 `"protocol": "sftp"` 또는 `"ftp"`를 넣어 접속 방식을 고를 수 있습니다(생략 시 `sftp`). 순수 FTP만 지원하는 서버라면 `"ftp"`로 설정하세요 — 포트 기본값도 각각 22 / 21로 자동 적용됩니다. FTP는 파일을 임시명 없이 직접 덮어쓰므로, 전송 중에 그 페이지를 열면 잘린 파일이 잠깐 보일 수 있습니다(새로고침하면 정상).

**SFTP — 비밀번호**
```json
{
  "protocol": "sftp",
  "host": "서버주소",
  "port": 22,
  "username": "계정",
  "password": "비밀번호",
  "remotePath": "/var/www/html",
  "context": "html",
  "pullRemoteRoot": "/var/www/html",
  "pullExclude": "logs,tmp"
}
```

**SFTP — SSH 키** (`password` 대신 키 파일 경로, 키에 암호가 있으면 `passphrase`)
```json
{
  "protocol": "sftp",
  "host": "서버주소",
  "port": 22,
  "username": "계정",
  "privateKeyPath": "/Users/me/.ssh/id_ed25519",
  "passphrase": "키 암호 (없으면 이 줄 삭제)",
  "remotePath": "/var/www/html",
  "context": "html",
  "pullRemoteRoot": "/var/www/html",
  "pullExclude": "logs,tmp"
}
```
`pull`/`upload:changed`/`deploy` 등 모든 명령은 프로토콜과 무관하게 동일합니다. VS Code SFTP 확장도 같은 파일을 읽으므로 확장 쪽 접속도 함께 바뀝니다.

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

## License

[MIT](./LICENSE)
