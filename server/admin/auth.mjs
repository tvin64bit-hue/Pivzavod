/**
 * Вход в админку по логину и паролю.
 *
 * Пароль на сервере лежит только хешем (scrypt из node:crypto — отдельная
 * библиотека не нужна). Сессия — подписанная кука, состояние держим в памяти
 * процесса: перезапуск сервиса разлогинивает, и это правильно.
 *
 * Переменные окружения:
 *   ADMIN_LOGIN          логин
 *   ADMIN_PASSWORD_HASH  строка вида scrypt:<соль-hex>:<хеш-hex>
 *                        генерируется: node scripts/admin-password.mjs
 *                        Разделитель двоеточие, а не доллар: строка с $
 *                        ломается везде, где файл читают через оболочку
 *                        или подставляют переменные (docker compose, `. env`)
 *   SESSION_SECRET       случайная строка для подписи куки
 */

import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';

const { ADMIN_LOGIN, ADMIN_PASSWORD_HASH, SESSION_SECRET } = process.env;

export const authConfigured = Boolean(ADMIN_LOGIN && ADMIN_PASSWORD_HASH && SESSION_SECRET);

const COOKIE = 'pz_admin';
/** Сессия живёт сутки — рабочий день с запасом */
const SESSION_TTL = 24 * 60 * 60 * 1000;

/** Параметры scrypt: N=16384 занимает ~30 мс, этого достаточно против перебора */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export const hashPassword = (password, salt = randomBytes(16)) => {
  const hash = scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
};

const verifyPassword = (password, stored) => {
  const [scheme, saltHex, hashHex] = String(stored).split(':');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;

  let expected;
  try {
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }

  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, SCRYPT);
  // Сравнение за постоянное время: обычное === подсказывает перебору,
  // сколько первых байт угадано
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

// ── сессии ──────────────────────────────────────────────────────────────────

const sessions = new Map();

const sign = (value) =>
  createHmac('sha256', SESSION_SECRET ?? '').update(value).digest('base64url');

const createSession = () => {
  const id = randomBytes(24).toString('base64url');
  sessions.set(id, { created: Date.now() });
  return `${id}.${sign(id)}`;
};

const readSession = (token) => {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;

  const id = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  const expected = sign(id);
  if (mac.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;

  const session = sessions.get(id);
  if (!session) return null;
  if (Date.now() - session.created > SESSION_TTL) {
    sessions.delete(id);
    return null;
  }
  return { id, ...session };
};

export const parseCookies = (header = '') =>
  Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const eq = part.indexOf('=');
        return eq < 0 ? [part, ''] : [part.slice(0, eq), decodeURIComponent(part.slice(eq + 1))];
      }),
  );

export const isLoggedIn = (req) =>
  Boolean(readSession(parseCookies(req.headers.cookie)[COOKIE]));

/**
 * Перебор паролей: после пяти неудач с адреса ждём минуту.
 * Порог намеренно низкий — админ один, ошибиться пять раз подряд он не должен.
 */
const attempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT = 60 * 1000;

export const login = (req, res, ip, credentials) => {
  const record = attempts.get(ip);
  if (record && record.count >= MAX_ATTEMPTS && Date.now() - record.at < LOCKOUT) {
    return { ok: false, error: 'too_many_attempts' };
  }

  const okLogin = credentials.login === ADMIN_LOGIN;
  // Хеш считаем всегда, даже при неверном логине: иначе по времени ответа
  // видно, существует такой логин или нет
  const okPassword = verifyPassword(credentials.password ?? '', ADMIN_PASSWORD_HASH);

  if (!okLogin || !okPassword) {
    attempts.set(ip, {
      count: record && Date.now() - record.at < LOCKOUT ? record.count + 1 : 1,
      at: Date.now(),
    });
    return { ok: false, error: 'bad_credentials' };
  }

  attempts.delete(ip);
  const token = createSession();
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}`,
  );
  return { ok: true };
};

export const logout = (req, res) => {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  const session = readSession(token);
  if (session) sessions.delete(session.id);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
};
