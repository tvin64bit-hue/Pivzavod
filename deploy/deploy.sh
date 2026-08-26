#!/usr/bin/env bash
#
# Выкладка сайта на сервер. Запускается с рабочей машины:
#
#   ./deploy/deploy.sh                       # если SSH_TARGET задан в окружении
#   SSH_TARGET=root@1.2.3.4 ./deploy/deploy.sh
#
# Что делает:
#   1. собирает сайт и конфиг nginx;
#   2. заливает статику в /var/www/pivzavod74 (старое удаляет);
#   3. заливает сервис заявок в /srv/pivzavod74 и перезапускает его;
#   4. проверяет конфиг nginx и перечитывает его.
#
# Первичная настройка сервера — в deploy/README.md, этот скрипт её не делает.

set -euo pipefail

TARGET="${SSH_TARGET:-}"
if [ -z "$TARGET" ]; then
  echo "Укажите сервер: SSH_TARGET=root@адрес $0" >&2
  exit 1
fi

WEB_ROOT=/var/www/pivzavod74
APP_ROOT=/srv/pivzavod74

cd "$(dirname "$0")/.."

echo "→ Сборка"
npm run build
node scripts/build-nginx-conf.mjs

echo "→ Статика в $TARGET:$WEB_ROOT"
# --delete убирает файлы, которых больше нет в сборке: иначе на сервере
# копятся старые страницы, и поисковик может их найти
rsync -az --delete --human-readable \
  dist/ "$TARGET:$WEB_ROOT/"

echo "→ Сервис заявок в $TARGET:$APP_ROOT"
rsync -az --delete --human-readable \
  server/ "$TARGET:$APP_ROOT/server/"
rsync -az package.json package-lock.json "$TARGET:$APP_ROOT/"

echo "→ Конфиг nginx"
rsync -az deploy/nginx/pivzavod74.conf "$TARGET:/etc/nginx/conf.d/pivzavod74.conf"

echo "→ Перезапуск на сервере"
ssh "$TARGET" bash -s <<'REMOTE'
set -euo pipefail
cd /srv/pivzavod74
# Только nodemailer и его зависимости, без сборочных пакетов
npm ci --omit=dev --no-audit --no-fund
chown -R www-data:www-data /srv/pivzavod74 /var/www/pivzavod74
systemctl restart pivzavod74-lead
nginx -t
systemctl reload nginx
REMOTE

echo "→ Проверка"
ssh "$TARGET" 'curl -sS --max-time 5 http://127.0.0.1:8787/api/health && echo'
echo "Готово."
