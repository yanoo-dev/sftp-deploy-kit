name: __NAME__
services:
  web:
    image: __NAME__-web
    build: ./_docker
    ports:
      - "__PORT__:80"
    volumes:
      - __WEB_DIR__:/var/www/html
__HTACCESS_MOUNT__    environment:
      # index.php가 ENVIRONMENT를 'development'로 하드코딩해서 씀 (라이브 서버와 동일)
      - CI_ENV=development
      - DB_PROXY_HOST=__DB_HOST__
      - DB_PROXY_PORT=__DB_PORT__
