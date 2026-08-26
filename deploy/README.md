# Установка сайта на сервер FirstVDS

Сайт статический: nginx отдаёт готовые файлы из `dist/`. Динамическая часть
одна — приём заявок с формы, её обслуживает маленький сервис на Node, который
шлёт письмо по SMTP. Базы данных и админки нет.

Ниже — установка с нуля. Всё выполняется по SSH под пользователем с sudo.
Дальнейшие выкладки делает `deploy/deploy.sh` одной командой.

## Что понадобится

- VDS с Ubuntu 22.04 или 24.04 (подойдёт минимальный тариф: сайт статический,
  нагрузки почти нет);
- домен `pivzavod74.ru`, у которого A-запись указывает на IP сервера;
- ящик, с которого будут уходить письма (Яндекс 360 для бизнеса — бесплатно
  на своём домене), и **пароль приложения** для него.

## 1. Базовая настройка сервера

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx rsync curl

# Node 20 из репозитория NodeSource — в стандартном Ubuntu версия старее
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # должно быть v20 или новее
```

Файрвол, если включён:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## 2. Каталоги

```bash
sudo mkdir -p /var/www/pivzavod74 /srv/pivzavod74 /var/www/certbot
sudo chown -R www-data:www-data /var/www/pivzavod74 /srv/pivzavod74
```

## 3. Сертификат

Certbot должен получить сертификат до того, как заработает конфиг сайта —
конфиг на него ссылается и без него nginx не стартует.

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot certonly --nginx -d pivzavod74.ru -d www.pivzavod74.ru
```

Продление certbot настраивает сам (таймер `certbot.timer`), проверить:
`systemctl list-timers | grep certbot`.

## 4. Почта для заявок

```bash
sudo cp deploy/pivzavod74.env.example /etc/pivzavod74.env
sudo nano /etc/pivzavod74.env          # впишите MAIL_TO, SMTP_*
sudo chown root:www-data /etc/pivzavod74.env
sudo chmod 640 /etc/pivzavod74.env
```

Два подводных камня:

- **Пароль приложения, а не пароль от аккаунта.** У Яндекса и Mail.ru обычный
  пароль по SMTP не проходит, если включена двухфакторная аутентификация.
  Создаётся в настройках безопасности почтового аккаунта.
- **Исходящий SMTP на VDS часто закрыт.** Хостеры режут порт 25 от спама,
  иногда заодно 465 и 587. Проверьте с сервера:

  ```bash
  curl -v --max-time 5 telnet://smtp.yandex.ru:465
  ```

  Если соединение не устанавливается — напишите в поддержку FirstVDS, что
  нужен исходящий SMTP на 465; открывают по запросу.

## 5. Сервис заявок

```bash
sudo cp deploy/pivzavod74-lead.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pivzavod74-lead
systemctl status pivzavod74-lead --no-pager
curl -s http://127.0.0.1:8787/api/health    # {"ok":true,"mail":true}
```

`"mail":false` означает, что переменные в `/etc/pivzavod74.env` заполнены не
полностью — сервис работает, но заявки будет отклонять, а форма на сайте
честно покажет ошибку и предложит позвонить.

Логи: `journalctl -u pivzavod74-lead -f`.

## 6. Первая выкладка

С рабочей машины, из корня проекта:

```bash
SSH_TARGET=root@адрес-сервера ./deploy/deploy.sh
```

Скрипт соберёт сайт, сгенерирует конфиг nginx, зальёт статику и сервис,
поставит зависимости, перезапустит сервис и перечитает nginx.

## 7. Проверка

```bash
curl -I https://pivzavod74.ru/                       # 200
curl -I https://www.pivzavod74.ru/                   # 301 на без-www
curl -I http://pivzavod74.ru/index.php/2.html        # 301 на /o-kompanii
curl -I https://pivzavod74.ru/net-takoy-stranicy     # 404
```

И главное — отправьте заявку через форму на сайте и убедитесь, что письмо
пришло. Если не пришло, смотрите `journalctl -u pivzavod74-lead -n 50`:
там будет причина отказа SMTP.

## Про конфиг nginx

`deploy/nginx/pivzavod74.conf` **генерируется**, править его руками
бессмысленно — перезапишется. Источники правил:

- `public/_redirects` — адреса старого сайта на Joomla;
- `public/_headers` — заголовки и кэш;
- поле `legacyUrl` в записях блога — точечные редиректы на 127 статей.

Пересобрать: `node scripts/build-nginx-conf.mjs`.

Две особенности, на которые стоит обратить внимание при правках:

- **Кириллица пишется буквами, а не процентными кодами.** nginx кладёт в `$uri`
  уже раскодированный путь, поэтому одно правило ловит и `%D0%9D…`, и сырой
  UTF-8. На Cloudflare было наоборот, и файл `_redirects` до сих пор хранит
  коды — генератор раскодирует их сам.
- **`map_hash_bucket_size 256`** обязателен: русские ключи вдвое длиннее
  латинских, и с настройками по умолчанию nginx отказывается собирать карту.

## Если IPv6 включён

Конфиг слушает только IPv4 — так он стартует на любом сервере. Если у VDS есть
IPv6, добавьте рядом с `listen 443 ssl http2;` строку
`listen [::]:443 ssl http2;` (и `listen [::]:80;` в первом блоке) — но не в
сгенерированном файле, а в `scripts/build-nginx-conf.mjs`, иначе потеряется
при следующей сборке.
