/** Мелкие помощники HTTP, общие для формы заявок и админки. */

/** Тело запроса: больше этого для наших форм быть не может */
export const MAX_JSON_BODY = 256 * 1024;

export const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
};

export const html = (res, status, body) => {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    // Админка не должна попадать в поиск ни при каких обстоятельствах
    'X-Robots-Tag': 'noindex, nofollow',
  });
  res.end(body);
};

export const redirect = (res, location) => {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
};

/**
 * Читает тело запроса целиком. Отдаёт Buffer — вызывающий решает,
 * что это: JSON формы или байты картинки.
 */
export const readBody = (req, limit = MAX_JSON_BODY) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        // Не рвём соединение: сначала дадим ответить 413, иначе клиент
        // получит обрыв вместо кода ошибки
        req.pause();
        reject(new Error('too_large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

/** Ответ с закрытием соединения: остаток тела дочитывать незачем */
export const rejectBody = (req, res, status, error) => {
  res.setHeader('Connection', 'close');
  json(res, status, { ok: false, error });
  req.destroy();
};

export const asString = (value, max) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

export const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
