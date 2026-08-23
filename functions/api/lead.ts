/**
 * Cloudflare Pages Function: POST /api/lead → Telegram Bot API sendMessage.
 *
 * Раздел 7 ТЗ: приём заявок только через Telegram — без email, админ-панели
 * и базы данных. Секреты живут в переменных окружения проекта Pages
 * и никогда не попадают в клиентский код.
 *
 * Обязательные переменные окружения (Pages → Settings → Variables and Secrets):
 *   TELEGRAM_BOT_TOKEN — токен бота от @BotFather
 *   TELEGRAM_CHAT_ID   — id чата/группы/канала для уведомлений
 * Необязательная:
 *   ALLOWED_ORIGIN     — точный Origin сайта; при указании чужие Origin отклоняются
 *
 * Экспортируется только onRequestPost: на остальные методы Pages отвечает 404
 * (проверено на wrangler pages dev). Экспорт onRequest перехватил бы все методы
 * и обошёл бы этот обработчик.
 */

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  ALLOWED_ORIGIN?: string;
}

interface LeadPayload {
  name?: unknown;
  phone?: unknown;
  topic?: unknown;
  message?: unknown;
  source?: unknown;
  page?: unknown;
  company?: unknown;
}

const TOPIC_LABELS: Record<string, string> = {
  tour: 'Экскурсия/дегустация',
  wholesale: 'Оптовые закупки',
  other: 'Другое',
};

/** Предельные длины — защита от раздувания сообщения и лимита Telegram в 4096 символов */
const LIMITS = { name: 80, phone: 32, message: 2000, source: 120, page: 200 } as const;

/** Лимит sendMessage в Telegram Bot API */
const TELEGRAM_MAX_TEXT = 4096;
const TRUNCATION_MARK = '… (сообщение обрезано)';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

const asString = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/** Экранирование для parse_mode: HTML */
const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Телефон считаем валидным, если это российский номер из 11 цифр, начинающийся с 7 или 8 */
const isValidPhone = (raw: string): boolean => {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'));
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ALLOWED_ORIGIN } = env;

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    // Пока заказчик не выдал токен и chat_id, форма честно сообщает об отказе,
    // а не делает вид, что заявка ушла.
    console.error('lead: TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID не заданы');
    return json({ ok: false, error: 'not_configured' }, 503);
  }

  if (ALLOWED_ORIGIN) {
    const origin = request.headers.get('Origin');
    if (origin && origin !== ALLOWED_ORIGIN) {
      return json({ ok: false, error: 'forbidden_origin' }, 403);
    }
  }

  let payload: LeadPayload;
  try {
    payload = (await request.json()) as LeadPayload;
  } catch {
    return json({ ok: false, error: 'bad_json' }, 400);
  }

  // Honeypot: поле скрыто от людей, заполняют его только боты.
  // Отвечаем успехом, чтобы спамер не подбирал обход.
  if (asString(payload.company, 100)) {
    return json({ ok: true }, 200);
  }

  const name = asString(payload.name, LIMITS.name);
  const phone = asString(payload.phone, LIMITS.phone);
  const topicKey = asString(payload.topic, 20);
  const message = asString(payload.message, LIMITS.message);
  const source = asString(payload.source, LIMITS.source);
  const page = asString(payload.page, LIMITS.page);

  if (name.length < 2) return json({ ok: false, error: 'invalid_name' }, 400);
  if (!isValidPhone(phone)) return json({ ok: false, error: 'invalid_phone' }, 400);

  const topic = TOPIC_LABELS[topicKey] ?? TOPIC_LABELS.other;
  const when = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
    // Челябинск, UTC+5 — чтобы время в уведомлении совпадало с местным
    timeZone: 'Asia/Yekaterinburg',
  }).format(new Date());

  const buildText = (comment: string) =>
    [
      '<b>Заявка с сайта</b>',
      '',
      `<b>Имя:</b> ${escapeHtml(name)}`,
      `<b>Телефон:</b> ${escapeHtml(phone)}`,
      `<b>Тема:</b> ${escapeHtml(topic)}`,
      comment ? `<b>Комментарий:</b> ${comment}` : null,
      '',
      `<i>${escapeHtml(source || page || 'сайт')} · ${when}</i>`,
    ]
      .filter((line) => line !== null)
      .join('\n');

  // Экранирование раздувает текст: 2000 символов «<» превращаются в 8000 и
  // упираются в лимит sendMessage в 4096 символов. Режем экранированный
  // комментарий по остатку бюджета, чтобы заявка дошла, а не отвалилась с 400.
  let escapedComment = escapeHtml(message);
  const overflow = buildText(escapedComment).length - TELEGRAM_MAX_TEXT;
  if (overflow > 0) {
    const budget = Math.max(0, escapedComment.length - overflow - TRUNCATION_MARK.length);
    // Обрезаем по границе HTML-сущности, чтобы не оставить хвост вида «&l»
    escapedComment = escapedComment.slice(0, budget).replace(/&[a-z]*$/i, '') + TRUNCATION_MARK;
  }

  const text = buildText(escapedComment);

  try {
    const tgResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      },
    );

    if (!tgResponse.ok) {
      // Тело ответа Telegram содержит причину, но не токен — логировать безопасно
      console.error('lead: Telegram ответил', tgResponse.status, await tgResponse.text());
      return json({ ok: false, error: 'telegram_failed' }, 502);
    }

    return json({ ok: true }, 200);
  } catch (err) {
    console.error('lead: сеть недоступна', err);
    return json({ ok: false, error: 'network' }, 502);
  }
};
