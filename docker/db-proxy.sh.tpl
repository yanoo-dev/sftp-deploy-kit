#!/usr/bin/env bash
#
# db-proxy.sh — 로컬 Docker 컨테이너의 mysqli 소켓 프록시(socat) 타겟 전환/점검
#
#   ./scripts/db-proxy.sh office     원격 DB 직결   (__DB_HOST__:__DB_PORT__)
#   ./scripts/db-proxy.sh home       재택 DB 터널 경유 (host.docker.internal:13306)
#   ./scripts/db-proxy.sh status     현재 타겟 + socat + DB 연결 확인 (인자 생략 시 기본)
#   ./scripts/db-proxy.sh restart    현재 타겟 그대로 socat 재기동
#
# 원리: docker-entrypoint-local.sh 의 감시 루프가 컨테이너 안 /tmp/db-proxy.target 을
#       읽어 socat 을 (재)기동한다. 이 스크립트는 "타겟 파일 교체 + socat kill" 만 하고
#       나머지(유령 소켓 정리, 재기동)는 루프가 처리한다. 컨테이너를 재시작하면
#       타겟은 docker-compose.yaml 의 DB_PROXY_HOST:PORT (= office) 로 돌아간다.
#
# macOS 기본 bash 3.2 에서도 동작하도록 4.x 전용 문법은 쓰지 않는다.
set -euo pipefail

CONTAINER="${DB_PROXY_CONTAINER:-__NAME__-web-1}"
OFFICE_TARGET="__DB_HOST__:__DB_PORT__"
HOME_TARGET="host.docker.internal:13306"
TARGET_FILE="/tmp/db-proxy.target"
CHECK_URL="http://localhost:__PORT__/"

# 오류 메시지 출력 후 종료
die() {
  echo "❌ $*" >&2
  exit 1
}

# 컨테이너 안 타겟 파일을 새 값으로 교체하고 socat 을 종료한다.
# (종료되면 entrypoint 감시 루프가 2초 뒤 새 타겟으로 socat 을 다시 띄운다)
set_target() {
  local target="$1"
  docker exec "$CONTAINER" sh -c '
    printf "%s\n" "$2" > "$1"
    pkill -x socat 2>/dev/null || true
  ' _ "$TARGET_FILE" "$target"
  echo "→ 타겟 변경: $target"
  echo "  socat 재기동 대기 중..."
  sleep 3
  show_status
}

# 현재 타겟 / socat 프로세스 수 / localhost:8080 응답으로 DB 연결 상태를 출력한다.
show_status() {
  local target running code
  target="$(docker exec "$CONTAINER" cat "$TARGET_FILE" 2>/dev/null || echo '(파일 없음)')"
  running="$(docker exec "$CONTAINER" sh -c 'pgrep -x socat | wc -l' 2>/dev/null | tr -d '[:space:]')"
  code="$(curl -s -o /dev/null -w '%{http_code}' -m 15 "$CHECK_URL" 2>/dev/null || echo 000)"

  echo "─────────────────────────────────────"
  echo " 컨테이너   : $CONTAINER"
  echo " socat 타겟 : $target"
  echo " socat 개수 : ${running:-0}"
  echo " HTTP 응답  : $code"
  if curl -s -m 15 "$CHECK_URL" 2>/dev/null | grep -qi 'Connection refused'; then
    echo " DB 연결    : ❌ Connection refused — 타겟/터널 확인 필요"
  elif [ "$code" = "200" ]; then
    echo " DB 연결    : ✅ 정상"
  else
    echo " DB 연결    : ⚠️  판정 불가 (HTTP $code)"
  fi
  echo "─────────────────────────────────────"
}

# 컨테이너의 socat 만 종료한다 (감시 루프가 현재 타겟 그대로 재기동)
restart_socat() {
  docker exec "$CONTAINER" sh -c 'pkill -x socat 2>/dev/null || true'
  echo "→ socat 종료. 감시 루프가 재기동합니다..."
  sleep 3
  show_status
}

docker inspect -f '{{.State.Running}}' "$CONTAINER" >/dev/null 2>&1 \
  || die "컨테이너 '$CONTAINER' 안 떠 있음.  docker compose up -d  먼저 실행."

case "${1:-status}" in
  office)
    set_target "$OFFICE_TARGET"
    ;;
  home)
    set_target "$HOME_TARGET"
    ;;
  restart)
    restart_socat
    ;;
  status)
    show_status
    ;;
  *)
    die "사용법: $0 {office|home|status|restart}"
    ;;
esac
