/**
 * Приём заявок с сайта: POST /api/lead → письмо на почту.
 *
 * Сайт статический, поэтому это единственная динамическая часть — маленький
 * сервис на Node без фреймворков. Перед ним стоит nginx: он отдаёт файлы из
 * dist/ и проксирует сюда только /api/. Наружу этот порт не смотрит.
 *
 * Почта уходит по обычному SMTP через ящик заказчика (Яндекс 360, Mail.ru
 * для бизнеса — любой). Отдельный сервис рассылок не нужен: на VDS, в отличие
 * от Cloudflare Workers, TCP-сокеты доступны.
 *
 * Переменные окружения — в /etc/pivzavod74.env, см. deploy/README:
 *   MAIL_TO      кому слать заявки (можно несколько через запятую)
 *   SMTP_HOST    например smtp.yandex.ru
 *   SMTP_PORT    465 (SSL) или 587 (STARTTLS)
 *   SMTP_USER    логин ящика, от имени которого отправляем
 *   SMTP_PASS    пароль приложения (не пароль от аккаунта!)
 *   MAIL_FROM    необязательно, по умолчанию SMTP_USER
 *   ALLOWED_ORIGIN  необязательно, точный Origin сайта
 */

import nodemailer from 'nodemailer';
import { json, readBody, rejectBody, asString, escapeHtml } from './lib/http.mjs';

const {
  MAIL_TO,
  SMTP_HOST,
  SMTP_PORT = '465',
  SMTP_USER,
  SMTP_PASS,
  MAIL_FROM,
  ALLOWED_ORIGIN,
} = process.env;

const configured = Boolean(MAIL_TO && SMTP_HOST && SMTP_USER && SMTP_PASS);

if (!configured) {
  // Не падаем: сайт должен работать и без почты, а форма — честно сообщать
  // об отказе и предлагать телефон, а не делать вид, что заявка ушла.
  console.error(
    'lead: почта не настроена (нужны MAIL_TO, SMTP_HOST, SMTP_USER, SMTP_PASS) — заявки будут отклоняться с 503',
  );
}

const transport = configured
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      // 465 — SSL с первого байта, 587 — STARTTLS уже внутри соединения
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
  : null;

const TOPIC_LABELS = {
  tour: 'Экскурсия/дегустация',
  wholesale: 'Оптовые закупки',
  other: 'Другое',
};

/** Предельные длины — чтобы письмо нельзя было раздуть до мегабайта */
const LIMITS = { name: 80, phone: 32, message: 2000, source: 120, page: 200 };

/** Тело запроса: больше 16 КБ для этой формы быть не может */
const MAX_BODY = 16 * 1024;

/** Российский номер: 11 цифр, начинается с 7 или 8 */
const isValidPhone = (raw) => {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'));
};

/** Ответить и сообщить маршрутизатору, что запрос обработан */
const sent = (res, status, body) => {
  json(res, status, body);
  return true;
};

/** Настроена ли отправка — показывается в проверке живости */
export const mailConfigured = () => configured;

/** Обрабатывает /api/*. Возвращает false, если путь не наш. */
export const handleApi = async (req, res, url) => {
  // Проверка живости для systemd и мониторинга
  if (req.method === 'GET' && url.pathname === '/api/health') {
    json(res, 200, { ok: true, mail: configured });
    return true;
  }

  if (url.pathname !== '/api/lead') return false;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    json(res, 405, { ok: false, error: 'method_not_allowed' });
    return true;
  }

  if (!configured) return sent(res, 503, { ok: false, error: 'not_configured' });

  if (ALLOWED_ORIGIN) {
    const origin = req.headers.origin;
    if (origin && origin !== ALLOWED_ORIGIN) {
      json(res, 403, { ok: false, error: 'forbidden_origin' });
      return true;
    }
  }

  // Заявленный размер проверяем до чтения — так отказ стоит один пакет
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY) {
    rejectBody(req, res, 413, 'too_large');
    return true;
  }

  let payload;
  try {
    payload = JSON.parse((await readBody(req)).toString('utf8'));
  } catch (err) {
    // too_large ловим и здесь: у запроса без Content-Length (chunked)
    // размер виден только по ходу чтения
    if (err?.message === 'too_large') {
      rejectBody(req, res, 413, 'too_large');
      return true;
    }
    json(res, 400, { ok: false, error: 'bad_json' });
    return true;
  }

  // Honeypot: поле скрыто от людей, заполняют его только боты.
  // Отвечаем успехом, чтобы спамер не подбирал обход.
  if (asString(payload?.company, 100)) return sent(res, 200, { ok: true });

  const name = asString(payload?.name, LIMITS.name);
  const phone = asString(payload?.phone, LIMITS.phone);
  const message = asString(payload?.message, LIMITS.message);
  const source = asString(payload?.source, LIMITS.source);
  const page = asString(payload?.page, LIMITS.page);
  const topic = TOPIC_LABELS[asString(payload?.topic, 20)] ?? TOPIC_LABELS.other;

  if (name.length < 2) return sent(res, 400, { ok: false, error: 'invalid_name' });
  if (!isValidPhone(phone)) return sent(res, 400, { ok: false, error: 'invalid_phone' });

  const when = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
    // Челябинск, UTC+5 — чтобы время в письме совпадало с местным
    timeZone: 'Asia/Yekaterinburg',
  }).format(new Date());

  const where = source || page || 'сайт';

  const rows = [
    ['Имя', name],
    ['Телефон', phone],
    ['Тема', topic],
    message ? ['Комментарий', message] : null,
    ['Откуда', where],
    ['Когда', when],
  ].filter(Boolean);

  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n');

  const html = `<table style="border-collapse:collapse;font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif">
${rows
  .map(
    ([k, v]) =>
      `<tr><td style="padding:6px 16px 6px 0;color:#666;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td>` +
      `<td style="padding:6px 0">${escapeHtml(v).replace(/\n/g, '<br>')}</td></tr>`,
  )
  .join('\n')}
</table>`;

  try {
    await transport.sendMail({
      from: MAIL_FROM || SMTP_USER,
      to: MAIL_TO,
      // Отвечать удобнее сразу заявителю, но адреса он не оставлял,
      // поэтому тема письма несёт телефон — видно прямо в списке писем.
      subject: `Заявка с сайта: ${name}, ${phone}`,
      text,
      html,
    });
    json(res, 200, { ok: true });
    return true;
  } catch (err) {
    // Пароль в сообщении об ошибке nodemailer не печатает
    console.error('lead: письмо не ушло —', err?.message ?? err);
    json(res, 502, { ok: false, error: 'mail_failed' });
    return true;
  }
};

