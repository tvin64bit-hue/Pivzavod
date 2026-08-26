/**
 * Раздача собранного сайта самим процессом.
 *
 * На сервере это делает nginx и делает лучше. Нужно это ровно для одного
 * случая: посмотреть сайт и админку у себя на компьютере, где nginx нет.
 * Включается переменной STATIC_DIR.
 */

import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.pdf': 'application/pdf',
};

const send = async (res, file, status = 200) => {
  const info = await stat(file);
  res.writeHead(status, {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': 'no-store',
  });
  createReadStream(file).pipe(res);
};

/**
 * @param {string} root каталог сборки
 * @param {string} uploads каталог фотографий, которые раздаются по /uploads/
 */
export const createStaticHandler = (root, uploads) => async (req, res, url) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  const decoded = decodeURIComponent(url.pathname);

  // Фотографии из админки лежат вне сборки — как и на сервере
  const isUpload = decoded.startsWith('/uploads/');
  const base = isUpload ? uploads : root;
  const rel = isUpload ? decoded.slice('/uploads/'.length) : decoded.replace(/^\/+/, '');

  // Выход за пределы каталога запрещаем: «../» в адресе иначе отдал бы
  // любой файл на диске
  const target = path.resolve(base, rel);
  if (target !== path.resolve(base) && !target.startsWith(path.resolve(base) + path.sep)) {
    return false;
  }

  for (const candidate of isUpload ? [target] : [target, path.join(target, 'index.html')]) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) {
        await send(res, candidate);
        return true;
      }
    } catch {
      /* нет такого — пробуем следующий вариант */
    }
  }

  // Своя страница 404, как настроено в nginx
  try {
    const notFound = path.join(root, '404.html');
    await stat(notFound);
    await send(res, notFound, 404);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Не найдено');
  }
  return true;
};
