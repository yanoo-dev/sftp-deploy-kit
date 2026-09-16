name: __NAME__
services:
  web:
    image: __NAME__-web
    build: .
    ports:
      - "__PORT__:80"
    volumes:
      - ./html:/var/www/html
    environment:
      # index.php가 ENVIRONMENT를 'development'로 하드코딩해서 씀 (라이브 서버와 동일)
      - CI_ENV=development
      - DB_PROXY_HOST=__DB_HOST__
      - DB_PROXY_PORT=__DB_PORT__
