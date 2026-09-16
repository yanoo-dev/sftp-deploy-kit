FROM php:__PHP__-apache

__LEGACY_APT__# 실제 소스(__uok__, _modules)에서 grep으로 확인된 확장만 설치 (imagecreate/mb_*/mcrypt_* 등 실사용 함수 기준)
# socat: 로컬 Docker 전용 mysqli 'localhost' 소켓 → 원격 DB TCP 프록시용
RUN apt-get update && apt-get install -y \
    libpng-dev \
    libzip-dev \
    libmcrypt-dev \
    libonig-dev \
    socat \
    && docker-php-ext-install mysqli pdo_mysql gd zip mbstring \
    && pecl install mcrypt-__MCRYPT__ \
    && docker-php-ext-enable mcrypt \
    && a2enmod rewrite \
    && rm -rf /var/lib/apt/lists/*

# 소스의 hostname='localhost' 하드코딩이 이 소켓을 보게 강제 (실 소스는 무변경)
RUN { \
      echo 'mysqli.default_socket=/tmp/mysql.sock'; \
      echo 'pdo_mysql.default_socket=/tmp/mysql.sock'; \
    } > /usr/local/etc/php/conf.d/mysql-socket.ini

# php-apache 기본 이미지는 AllowOverride None이라 .htaccess(mod_rewrite 라우팅)가 무시됨 — 켜줌
RUN { \
      echo '<Directory /var/www/html>'; \
      echo '    AllowOverride All'; \
      echo '</Directory>'; \
    } > /etc/apache2/conf-available/allow-override.conf \
    && a2enconf allow-override

COPY docker-entrypoint-local.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint-local.sh
CMD ["/usr/local/bin/docker-entrypoint-local.sh"]
