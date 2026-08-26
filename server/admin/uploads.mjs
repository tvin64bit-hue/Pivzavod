/**
 * Загрузка фотографий из админки.
 *
 * Файлы кладутся в DATA_DIR/uploads/ГГГГ/ММ/ и раздаются nginx по адресу
 * /uploads/… напрямую. В сборку сайта они не попадают: dist пересобирается
 * целиком, и всё, что лежало бы внутри, терялось бы при каждой публикации.
 *
 * Снимок с телефона — это 3–6 МБ и 4000 пикселей по длинной стороне. На сайте
 * такой ширины нет нигде, поэтому пережимаем сразу при загрузке: иначе
 * страница новости будет весить как весь остальной сайт.
 */

import { mkdir, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { DATA_DIR, slugify } from './posts.mjs';

export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

/** Больше 1600px на сайте не показывается даже на широком экране */
const MAX_WIDTH = 1600;
const QUALITY = 82;
/** Предел приёма: снимок с современного телефона в это укладывается */
export const MAX_UPLOAD = 25 * 1024 * 1024;

const ALLOWED = new Set(['jpeg', 'png', 'webp', 'gif', 'avif']);

/**
 * Имя файла из имени, с которым его прислали. Кириллицу переводим в латиницу
 * тем же способом, что и адреса записей: иначе «Фото с телефона.JPG»
 * превращалось бы в пустую строку и все снимки назывались бы foto-2, foto-3.
 */
const safeName = (original) => {
  const stem = path.basename(String(original || ''), path.extname(String(original || '')));
  const base = slugify(stem).slice(0, 60);
  return base && base !== 'zapis' ? base : 'foto';
};

export const saveUpload = async (buffer, originalName) => {
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    return { error: 'Это не изображение' };
  }

  if (!ALLOWED.has(meta.format)) {
    return { error: `Формат ${meta.format ?? 'неизвестный'} не поддерживается` };
  }

  const now = new Date();
  const dir = path.join(
    UPLOADS_DIR,
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, '0'),
  );
  await mkdir(dir, { recursive: true });

  // Анимированные gif пережимать нельзя — потеряется анимация
  const animated = meta.format === 'gif' && (meta.pages ?? 1) > 1;
  const ext = animated ? 'gif' : 'jpg';

  let name = `${safeName(originalName)}.${ext}`;
  let i = 2;
  const existing = new Set(await readdir(dir).catch(() => []));
  while (existing.has(name)) name = `${safeName(originalName)}-${i++}.${ext}`;

  const output = animated
    ? buffer
    : await sharp(buffer)
        .rotate() // по EXIF: снимки с телефона иначе лежат на боку
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: QUALITY, mozjpeg: true })
        .toBuffer();

  const file = path.join(dir, name);
  await writeFile(file, output);

  const url = `/uploads/${path.relative(UPLOADS_DIR, file).split(path.sep).join('/')}`;
  return { url, bytes: output.length, width: Math.min(meta.width ?? 0, MAX_WIDTH) };
};

/** Список загруженного — чтобы в редакторе можно было взять уже загруженное фото */
export const listUploads = async (limit = 60) => {
  const found = [];

  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(jpe?g|png|webp|gif|avif)$/i.test(entry.name)) {
        found.push({ full, mtime: (await stat(full)).mtimeMs });
      }
    }
  };

  await walk(UPLOADS_DIR);

  return found
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map(({ full }) => `/uploads/${path.relative(UPLOADS_DIR, full).split(path.sep).join('/')}`);
};
