/**
 * Единственный процесс сайта: приём заявок и админка.
 *
 * Слушает только localhost — снаружи всё идёт через nginx, который отдаёт
 * статику сам и проксирует сюда /api/ и /admin/.
 *
 * Почему один процесс, а не два: админке и форме нужны одни и те же
 * настройки, а операций у сайта столько, что второй systemd-юнит
 * добавил бы работы при обслуживании и ничего не дал бы.
 */

import { createServer } from 'node:http';
import path from 'node:path';
import { json } from './lib/http.mjs';
import { createStaticHandler } from './lib/static.mjs';
import { handleApi, mailConfigured } from './lead.mjs';
import { handleAdmin } from './admin/router.mjs';
import { authConfigured } from './admin/auth.mjs';

const PORT = Number(process.env.PORT || 8787);

/**
 * Локальный режим: раздаём ещё и сам сайт. На сервере этого не делаем —
 * там статику отдаёт nginx, и делает это лучше. Включается, если задан
 * STATIC_DIR (см. `npm run local`).
 */
const STATIC_DIR = process.env.STATIC_DIR;
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const serveStatic = STATIC_DIR
  ? createStaticHandler(path.resolve(STATIC_DIR), path.join(path.resolve(DATA_DIR), 'uploads'))
  : null;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  try {
    if (url.pathname.startsWith('/admin')) return await handleAdmin(req, res, url);
    if (url.pathname.startsWith('/api/')) {
      if (await handleApi(req, res, url)) return;
    }
    if (serveStatic && (await serveStatic(req, res, url))) return;
    json(res, 404, { ok: false, error: 'not_found' });
  } catch (err) {
    console.error('app: необработанная ошибка —', err);
    // Ответ отправлять поздно, если заголовки уже ушли
    if (!res.headersSent) json(res, 500, { ok: false, error: 'internal' });
    else res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `app: слушаю http://127.0.0.1:${PORT} · почта ${mailConfigured() ? 'настроена' : 'НЕ настроена'}` +
      ` · админка ${authConfigured ? 'настроена' : 'НЕ настроена'}` +
      (serveStatic ? ` · сайт из ${STATIC_DIR}` : ''),
  );
  if (serveStatic) console.log(`app: админка — http://127.0.0.1:${PORT}/admin`);
});
