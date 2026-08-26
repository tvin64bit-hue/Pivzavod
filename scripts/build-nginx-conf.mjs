/**
 * Собирает конфиг nginx из тех же источников, что и раньше кормили Cloudflare:
 *   public/_redirects  — правила со старых адресов Joomla
 *   public/_headers    — заголовки и кэш
 *   src/content/blog/  — поле legacyUrl каждой записи
 *
 * Зачем генератор, а не конфиг руками: правил больше полутора сотен, и они
 * должны совпадать с реальными адресами записей. Руками это разъедется на
 * первой же новой статье.
 *
 * Важное отличие от Cloudflare: nginx кладёт в $uri уже раскодированный путь,
 * поэтому кириллицу в правилах пишем буквами, а не процентными кодами —
 * так одно правило ловит и %D0%9D…, и сырой UTF-8.
 *
 *   node scripts/build-nginx-conf.mjs
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'deploy/nginx/pivzavod74.conf');

/** Экранирование для регулярного выражения nginx */
const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Кавычки нужны там, где в строке есть спецсимволы конфига */
const quote = (value) => (/^[A-Za-zА-Яа-яЁё0-9/._~-]+$/.test(value) ? value : `"${value}"`);

// ── правила со старого сайта ────────────────────────────────────────────────

const redirectsFile = readFileSync(path.join(ROOT, 'public/_redirects'), 'utf8');

const exact = new Map();
const prefix = new Map();

for (const raw of redirectsFile.split('\n')) {
  const line = raw.replace(/\s+#.*$/, '').trim();
  if (!line || line.startsWith('#')) continue;

  const [from, to] = line.split(/\s+/);
  if (!from || !to) continue;

  // Cloudflare требовал процентного кодирования, nginx работает с буквами
  const source = decodeURIComponent(from);

  if (source.endsWith('/*')) {
    const base = source.slice(0, -2);
    if (!prefix.has(base)) prefix.set(base, to);
  } else if (!exact.has(source)) {
    exact.set(source, to);
  }
}

// ── точечные редиректы на конкретные записи блога ───────────────────────────

const blogDir = path.join(ROOT, 'src/content/blog');
const posts = [];

for (const file of readdirSync(blogDir).filter((f) => f.endsWith('.md'))) {
  const head = readFileSync(path.join(blogDir, file), 'utf8').split(/^---$/m)[1] ?? '';
  const legacy = head.match(/^legacyUrl:\s*(.+)$/m)?.[1]?.trim();
  if (!legacy) continue;

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(legacy).pathname);
  } catch {
    continue;
  }

  const slug = file.replace(/\.md$/, '');
  posts.push([pathname, `/blog/${slug}`]);
}

// Записи важнее разделов: точное совпадение в map всегда бьёт регулярку,
// но одинаковый ключ дважды объявлять нельзя
for (const [from, to] of posts) if (!exact.has(from)) exact.set(from, to);

// ── сам конфиг ──────────────────────────────────────────────────────────────

const exactLines = [...exact]
  .sort(([a], [b]) => a.localeCompare(b, 'ru'))
  .map(([from, to]) => `    ${quote(from)} ${quote(to)};`);

// Регулярки проверяются в порядке объявления; длинные префиксы вперёд,
// чтобы «/index.php/» в конце не перехватил всё остальное
const prefixLines = [...prefix]
  .sort(([a], [b]) => b.length - a.length)
  .map(([base, to]) => `    ~^${escapeRe(base)}(/|$) ${quote(to)};`);

const conf = `# Конфиг nginx для сайта «Лаборатория живого пива».
#
# СГЕНЕРИРОВАН: node scripts/build-nginx-conf.mjs
# Руками не правьте — изменения потеряются. Источники правил:
# public/_redirects, public/_headers и поле legacyUrl в записях блога.
#
# Установка описана в deploy/README.md.

# Кириллица в UTF-8 занимает два байта на букву, поэтому ключи карты
# длиннее, чем nginx рассчитывает по умолчанию (самый длинный — 83 байта).
# Без этих двух строк конфиг не проходит nginx -t.
map_hash_bucket_size 256;
map_hash_max_size 4096;

# Куда вести адрес со старого сайта. Пусто — значит редиректа нет.
map $uri $legacy_target {
    default "";

    # Точные адреса: страницы разделов и ${posts.length} записей блога
${exactLines.join('\n')}

    # Разделы Joomla целиком
${prefixLines.join('\n')}
}

# Кэш по типу файла: у хэшированных ассетов имя меняется вместе с содержимым,
# у перенесённых фотографий содержимое не меняется вовсе
map $uri $cache_control {
    default                 "public, max-age=3600";
    ~^/_astro/              "public, max-age=31536000, immutable";
    ~^/images/legacy/       "public, max-age=2592000";
    ~\\.(?:css|js|woff2?)$   "public, max-age=31536000, immutable";
    ~\\.html$               "public, max-age=0, must-revalidate";
}

# Ограничение частоты для формы: 10 заявок в минуту с адреса — человеку
# столько не нужно, а перебор форм упрётся в предел
limit_req_zone $binary_remote_addr zone=lead:10m rate=10r/m;

# Вход в админку: подбор пароля упирается и в этот предел, и в собственный
# счётчик попыток внутри сервиса
limit_req_zone $binary_remote_addr zone=adminlogin:10m rate=20r/m;

# По умолчанию nginx отвечает на превышение кодом 503 — тем же, каким сервис
# сообщает «почта не настроена», и тем, по которому поисковики считают сайт
# лежащим. Для отказа по частоте правильный код — 429.
limit_req_status 429;

server {
    listen 80;
    server_name pivzavod74.ru www.pivzavod74.ru;

    # Оставляем открытым только проверку сертификата, остальное — на HTTPS
    location /.well-known/acme-challenge/ { root /var/www/certbot; }

    # Старый сайт работал по http, поэтому ссылки из поиска и с чужих сайтов
    # приходят сюда. Уводим сразу на конечный адрес, без лишнего перехода
    # «http-старый → https-старый → https-новый».
    if ($legacy_target) {
        return 301 https://pivzavod74.ru$legacy_target;
    }

    location / { return 301 https://pivzavod74.ru$request_uri; }
}

server {
    listen 443 ssl http2;
    server_name www.pivzavod74.ru;

    ssl_certificate     /etc/letsencrypt/live/pivzavod74.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pivzavod74.ru/privkey.pem;

    # Канонический адрес — без www, иначе поисковики видят два сайта
    return 301 https://pivzavod74.ru$request_uri;
}

server {
    # На nginx 1.25 и новее этот способ включения HTTP/2 объявлен устаревшим:
    # там вместо «ssl http2» в listen пишут отдельную строку «http2 on;».
    # Оставлен старый вариант — он работает и на 1.18, и на 1.24, которые
    # ставятся из репозиториев Ubuntu 22.04 и 24.04.
    # Слушаем только IPv4: на VDS он есть всегда, а IPv6 включён не везде,
    # и лишняя строка listen [::]: не даёт nginx стартовать. Если IPv6
    # у сервера есть — добавьте «listen [::]:443 ssl http2;» рядом.
    listen 443 ssl http2;
    server_name pivzavod74.ru;

    # Симлинк на текущую сборку. Публикация из админки переключает его
    # одной операцией, поэтому полусобранного сайта посетитель не увидит.
    root /var/www/pivzavod74/current;
    index index.html;
    charset utf-8;

    # nginx кэширует, куда указывает симлинк: без сброса кэша после публикации
    # он ещё до полуминуты отдавал бы файлы предыдущей сборки
    open_file_cache off;

    ssl_certificate     /etc/letsencrypt/live/pivzavod74.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pivzavod74.ru/privkey.pem;

    access_log /var/log/nginx/pivzavod74.access.log;
    error_log  /var/log/nginx/pivzavod74.error.log;

    # Фотографии с донора весят немало, отдаём быстрее
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/javascript application/json
               image/svg+xml application/xml application/rss+xml;

    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Permissions-Policy "geolocation=(), microphone=(), camera=(), interest-cohort=()" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    client_max_body_size 64k;

    # Адреса старого сайта уводим на новые до всего остального
    if ($legacy_target) {
        return 301 $legacy_target;
    }

    # Фотографии из админки лежат в каталоге данных, а не в сборке: dist
    # пересобирается целиком, и всё, что лежало бы внутри, терялось бы
    # при каждой публикации
    location /uploads/ {
        alias /srv/pivzavod74/data/uploads/;
        add_header Cache-Control "public, max-age=2592000" always;
        add_header X-Content-Type-Options nosniff always;
        access_log off;
        try_files $uri =404;
    }

    # Админка. Робот сюда не заходит, поисковику показывать нечего
    location /admin {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Публикация запускает сборку в фоне и отвечает сразу, но загрузка
        # снимка на 25 МБ по мобильному интернету идёт долго
        client_max_body_size 25m;
        proxy_read_timeout 120s;
        proxy_request_buffering off;

        add_header X-Robots-Tag "noindex, nofollow" always;
    }

    location = /admin/login {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        limit_req zone=adminlogin burst=10 nodelay;
        add_header X-Robots-Tag "noindex, nofollow" always;
    }

    # Приём заявок — вторая динамическая часть, остальное статика
    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;

        # Отправка письма занимает секунду-другую: не даём положить сервис
        # перебором форм с одного адреса
        limit_req zone=lead burst=5 nodelay;
    }

    # Служебные файлы Cloudflare в раздаче не нужны
    location ~ ^/_(redirects|headers)$ { return 404; }

    location / {
        add_header Cache-Control $cache_control always;
        add_header X-Content-Type-Options nosniff always;
        add_header X-Frame-Options SAMEORIGIN always;
        add_header Referrer-Policy strict-origin-when-cross-origin always;
        add_header Permissions-Policy "geolocation=(), microphone=(), camera=(), interest-cohort=()" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

        # Astro собирает страницы папками: /o-kompanii/index.html
        try_files $uri $uri/index.html $uri/ =404;
    }

    error_page 404 /404.html;
    location = /404.html { internal; }
}
`;

writeFileSync(OUT, conf, 'utf8');
console.log(
  `${path.relative(ROOT, OUT)}: ${exact.size} точных правил (из них ${posts.length} записей блога), ` +
    `${prefix.size} разделов`,
);
