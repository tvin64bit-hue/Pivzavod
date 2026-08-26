#!/usr/bin/env bash
#
# Выкладка сайта на сервер. Запускается с рабочей машины:
#
#   SSH_TARGET=root@1.2.3.4 ./deploy/deploy.sh
#
# Собирает сайт не здесь, а на сервере — и это принципиально. Записи,
# созданные заказчиком через админку, живут в каталоге данных на сервере;
# собрать у себя и залить готовый dist значило бы выкатить сайт без них.
#
# Что делает:
#   1. заливает исходники и конфиг nginx;
#   2. ставит зависимости, если package-lock.json изменился;
#   3. просит сервис пересобрать сайт — тем же путём, что и публикация
#      из админки, с переключением симлинка одной операцией;
#   4. проверяет, что сайт и сервис живы.
#
# Первичная настройка сервера — в deploy/README.md, этот скрипт её не делает.

set -euo pipefail

TARGET="${SSH_TARGET:-}"
if [ -z "$TARGET" ]; then
  echo "Укажите сервер: SSH_TARGET=root@адрес $0" >&2
  exit 1
fi

APP_ROOT=/srv/pivzavod74

cd "$(dirname "$0")/.."

echo "→ Конфиг nginx"
node scripts/build-nginx-conf.mjs

echo "→ Исходники в $TARGET:$APP_ROOT"
# Каталог данных исключён намеренно: там записи и фотографии заказчика,
# --delete снёс бы их. По той же причине не трогаем сборки.
rsync -az --delete --human-readable \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.astro' \
  --exclude 'data' \
  --exclude 'assets/source-images/legacy-originals' \
  ./ "$TARGET:$APP_ROOT/"

echo "→ Конфиг nginx на сервер"
rsync -az deploy/nginx/pivzavod74.conf "$TARGET:/etc/nginx/conf.d/pivzavod74.conf"

echo "→ Сборка и перезапуск на сервере"
ssh "$TARGET" bash -s <<'REMOTE'
set -euo pipefail
cd /srv/pivzavod74

# Полный набор зависимостей, а не --omit=dev: сборка сайта идёт на сервере,
# и astro со sharp нужны в рантайме
npm ci --no-audit --no-fund

chown -R www-data:www-data /srv/pivzavod74
mkdir -p /var/www/pivzavod74/releases
chown -R www-data:www-data /var/www/pivzavod74

systemctl restart pivzavod74
nginx -t
systemctl reload nginx

# Первая сборка после выкладки: тем же путём, что и публикация из админки
sudo -u www-data env DATA_DIR="${DATA_DIR:-/srv/pivzavod74/data}" \
  node -e "import('./server/admin/build.mjs').then(async (m) => {
    m.requestBuild();
    let s;
    do {
      await new Promise((r) => setTimeout(r, 2000));
      s = m.buildState();
      process.stdout.write('.');
    } while (s.status === 'running' || s.status === 'queued');
    console.log('');
    if (s.status === 'error') { console.error(s.error); console.error(s.log.slice(-2000)); process.exit(1); }
    console.log('собрано за ' + Math.round(s.durationMs / 1000) + ' с');
  })"
REMOTE

echo "→ Проверка"
ssh "$TARGET" 'curl -sS --max-time 5 http://127.0.0.1:8787/api/health && echo'
echo "Готово."
