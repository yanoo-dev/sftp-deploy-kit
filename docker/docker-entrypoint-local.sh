#!/bin/bash
#
# docker-entrypoint-local.sh — 로컬 Docker 전용 진입점
#
# PHP 소스(__uok__/config/database.php)가 hostname='localhost' 로 고정돼 있어
# mysqli 가 유닉스 소켓(/tmp/mysql.sock)으로만 접속한다. 컨테이너엔 MySQL 이 없으므로
# socat 으로 그 소켓 → 원격 DB(TCP) 를 중계한다.
#
# socat 이 apache 재시작(SIGWINCH) 등에 휩쓸려 죽으면 소켓 파일만 남아
# 이후 연결이 전부 "Connection refused" 가 되던 문제 → 감시 루프로 감싸 자동 재기동.
#
# 중계 타겟은 /tmp/db-proxy.target 파일로 관리한다.
#   - 파일이 없으면 docker-compose.yaml 의 DB_PROXY_HOST:PORT (사무실 LAN 직결) 로 생성
#   - scripts/db-proxy.sh 가 이 파일을 바꾸고 socat 을 kill 하면 루프가 새 타겟으로 재기동
#     (재택: host.docker.internal:13306 = Mac 의 DB 터널)
set -e

mkdir -p /var/run/mysqld

TARGET_FILE=/tmp/db-proxy.target
if [ ! -s "$TARGET_FILE" ]; then
  printf '%s:%s\n' "$DB_PROXY_HOST" "$DB_PROXY_PORT" > "$TARGET_FILE"
fi

# socat 감시 루프 (백그라운드). 서브셸이라 set -e 영향은 set +e 로 격리.
(
  set +e
  while true; do
    target="$(cat "$TARGET_FILE" 2>/dev/null)"
    if [ -z "$target" ]; then
      target="$DB_PROXY_HOST:$DB_PROXY_PORT"
    fi
    rm -f /tmp/mysql.sock
    echo "[db-proxy] socat /tmp/mysql.sock -> TCP:$target"
    socat UNIX-LISTEN:/tmp/mysql.sock,fork,reuseaddr,mode=777 "TCP:$target"
    echo "[db-proxy] socat exited (rc=$?) — restart in 2s"
    sleep 2
  done
) &

exec apache2-foreground
