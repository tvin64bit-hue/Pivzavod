/**
 * Хранилище новостей для админки.
 *
 * Записи лежат обычными markdown-файлами — теми же, что читает Astro. Но не
 * в репозитории, а в каталоге данных на сервере:
 *
 *   DATA_DIR/posts/<slug>.md   созданные и отредактированные записи
 *   DATA_DIR/deleted.json      слаги, снятые с сайта
 *
 * Перед сборкой scripts/prepare-content.mjs накладывает этот слой на архив
 * из репозитория: файлы из posts/ перекрывают одноимённые, слаги из
 * deleted.json удаляются. Поэтому выкладка новой версии сайта с рабочей
 * машины не затирает то, что написал заказчик, а правка архивной статьи
 * не требует коммита.
 */

import { readFile, writeFile, readdir, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const POSTS_DIR = path.join(DATA_DIR, 'posts');
const DELETED_FILE = path.join(DATA_DIR, 'deleted.json');
/**
 * Архив, перенесённый с донора: лежит в репозитории. Читаем его напрямую,
 * а не собранный .content/blog — админке нужно знать, какая запись откуда,
 * чтобы правильно её удалять (файл архива вернётся при следующей выкладке,
 * поэтому снимается через deleted.json).
 */
const ARCHIVE_DIR = path.join(ROOT, 'src/content/blog');

export const CATEGORIES = {
  nagrady: 'Награды',
  pressa: 'Пресса о нас',
  degustacii: 'Дегустации',
  komandirovki: 'Командировки и обучение',
  otrasl: 'Позиция отрасли',
  raznoe: 'Разное/гости',
};

const LIMITS = { title: 200, excerpt: 400, body: 100_000, slug: 100 };

// ── slug ────────────────────────────────────────────────────────────────────

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Адрес записи из заголовка: кириллица в адресе читается людьми плохо */
export const slugify = (title) =>
  title
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.slug) || 'zapis';

// ── чтение и запись файлов ──────────────────────────────────────────────────

const readDeleted = async () => {
  try {
    return new Set(JSON.parse(await readFile(DELETED_FILE, 'utf8')));
  } catch {
    return new Set();
  }
};

const writeDeleted = async (set) => {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DELETED_FILE, JSON.stringify([...set], null, 2), 'utf8');
};

/**
 * Значение фронтматтера в YAML: кавычим всё, кроме чисел и булевых.
 * Переводы строк схлопываем — многострочный скаляр в кавычках формально
 * допустим, но читается плохо и легко ломается при ручной правке файла.
 */
const yamlValue = (value) => {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `[${value.map((v) => yamlValue(v)).join(', ')}]`;
  return `'${String(value).replace(/\s+/g, ' ').trim().replace(/'/g, "''")}'`;
};

const buildFile = ({ body, ...front }) => {
  const lines = ['---'];
  for (const [key, value] of Object.entries(front)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && !value.length) continue;
    lines.push(`${key}: ${yamlValue(value)}`);
  }
  lines.push('---', '', `${body ?? ''}`.trim(), '');
  return lines.join('\n');
};

/** Разбор фронтматтера. Свой, потому что нужен ровно наш набор полей */
const parseFile = (raw) => {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };

  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w]*):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();

    if (value === 'true' || value === 'false') {
      data[kv[1]] = value === 'true';
      continue;
    }
    if (/^\[.*\]$/.test(value)) {
      data[kv[1]] = value
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
      continue;
    }
    value = value.replace(/^'([\s\S]*)'$/, '$1').replace(/''/g, "'");
    value = value.replace(/^"([\s\S]*)"$/, '$1');
    data[kv[1]] = value;
  }
  return { data, body: match[2] };
};

const readPostFile = async (dir, slug) => {
  const file = path.join(dir, `${slug}.md`);
  if (!existsSync(file)) return null;
  const { data, body } = parseFile(await readFile(file, 'utf8'));
  return { slug, ...data, body: body.trim(), source: dir === ARCHIVE_DIR ? 'archive' : 'admin' };
};

// ── публичное API ───────────────────────────────────────────────────────────

/** Все записи сайта: архив из репозитория плюс слой админки поверх */
export const listPosts = async () => {
  const deleted = await readDeleted();
  const byslug = new Map();

  for (const [dir, exists] of [
    [ARCHIVE_DIR, existsSync(ARCHIVE_DIR)],
    [POSTS_DIR, existsSync(POSTS_DIR)],
  ]) {
    if (!exists) continue;
    for (const file of await readdir(dir)) {
      if (!file.endsWith('.md')) continue;
      const post = await readPostFile(dir, file.replace(/\.md$/, ''));
      if (post) byslug.set(post.slug, post);
    }
  }

  return [...byslug.values()]
    .filter((post) => !deleted.has(post.slug))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
};

export const getPost = async (slug) => {
  const deleted = await readDeleted();
  if (deleted.has(slug)) return null;
  return (await readPostFile(POSTS_DIR, slug)) ?? (await readPostFile(ARCHIVE_DIR, slug));
};

/** Начало текста без markdown-разметки — на анонс в ленте */
const plainExcerpt = (body) =>
  body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')      // картинки
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // ссылки — оставляем текст
    .replace(/^[>\-*+]\s+/gm, '')               // списки и цитаты
    .replace(/^#{1,6}\s+/gm, '')                // заголовки
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
    .trim();

const validate = (input) => {
  const title = String(input.title ?? '').trim().slice(0, LIMITS.title);
  const body = String(input.body ?? '').trim().slice(0, LIMITS.body);
  const category = CATEGORIES[input.category] ? input.category : 'raznoe';
  const excerpt = String(input.excerpt ?? '').trim().slice(0, LIMITS.excerpt);

  if (title.length < 3) return { error: 'Заголовок слишком короткий' };
  if (!body) return { error: 'Текст записи пустой' };

  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date ?? ''))
    ? String(input.date)
    : new Date().toISOString().slice(0, 10);

  return {
    post: {
      title,
      date,
      category,
      // Без анонса карточка в ленте пустая, поэтому берём начало текста,
      // очищенное от разметки
      excerpt: excerpt || plainExcerpt(body),
      cover: String(input.cover ?? '').trim() || undefined,
      gallery: Array.isArray(input.gallery) ? input.gallery.filter(Boolean).slice(0, 30) : [],
      draft: Boolean(input.draft),
      body,
    },
  };
};

export const savePost = async (slug, input) => {
  const { post, error } = validate(input);
  if (error) return { error };

  const target = slug || slugify(post.title);

  // Новая запись не должна затирать существующую
  if (!slug && (await getPost(target))) {
    return { error: `Адрес /blog/${target} уже занят — измените заголовок` };
  }

  // Правка ранее удалённой записи возвращает её на сайт
  const deleted = await readDeleted();
  if (deleted.delete(target)) await writeDeleted(deleted);

  await mkdir(POSTS_DIR, { recursive: true });
  await writeFile(path.join(POSTS_DIR, `${target}.md`), buildFile(post), 'utf8');
  return { slug: target };
};

export const deletePost = async (slug) => {
  const existing = await getPost(slug);
  if (!existing) return { error: 'Записи нет' };

  // Файл из репозитория удалить нельзя — он вернётся при следующей выкладке,
  // поэтому слаг заносится в список снятых
  const deleted = await readDeleted();
  deleted.add(slug);
  await writeDeleted(deleted);

  // Свой файл убираем совсем, чтобы каталог не рос мусором
  const own = path.join(POSTS_DIR, `${slug}.md`);
  if (existsSync(own)) await unlink(own);

  return { ok: true };
};
