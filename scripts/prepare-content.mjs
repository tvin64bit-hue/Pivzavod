#!/usr/bin/env node
/**
 * Собирает каталог, из которого Astro читает записи блога.
 *
 * Источников два, и они намеренно разделены:
 *
 *   src/content/blog/     архив 127 статей, перенесённых с донора. Лежит
 *                         в репозитории, правится через git.
 *   DATA_DIR/posts/       всё, что заказчик пишет и правит через админку.
 *                         Лежит на сервере, в git не попадает.
 *   DATA_DIR/deleted.json слаги, снятые с сайта.
 *
 * Результат складывается в .content/blog — отдельный каталог, который в
 * репозиторий не входит. Раньше слой админки накладывался прямо на
 * src/content/blog, и после каждой сборки рабочее дерево git оказывалось
 * изменённым: чужие записи как неотслеживаемые файлы, снятые статьи —
 * как удаления. Так недолго и закоммитить лишнее.
 *
 * Запускается сам перед `npm run build` и `npm run dev` (prebuild/predev),
 * и перед каждой публикацией из админки. Идемпотентен.
 */

import { readdir, copyFile, mkdir, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const ARCHIVE_DIR = path.join(ROOT, 'src/content/blog');
const POSTS_DIR = path.join(DATA_DIR, 'posts');
const DELETED_FILE = path.join(DATA_DIR, 'deleted.json');
const OUT_DIR = path.join(ROOT, '.content/blog');

/** Слаг приходит из нашего же файла, но путь всё равно проверяем */
const safeSlug = (slug) =>
  typeof slug === 'string' && slug && !slug.includes('/') && !slug.includes('\\') && !slug.includes('..');

const deleted = new Set();
if (existsSync(DELETED_FILE)) {
  try {
    for (const slug of JSON.parse(await readFile(DELETED_FILE, 'utf8'))) {
      if (safeSlug(slug)) deleted.add(slug);
    }
  } catch {
    console.error('deleted.json повреждён — снятие записей пропущено');
  }
}

// Каталог собирается заново: так снятая запись исчезает, а не остаётся
// с прошлого раза
await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

const copyFrom = async (dir) => {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const file of await readdir(dir)) {
    if (!file.endsWith('.md')) continue;
    if (deleted.has(file.replace(/\.md$/, ''))) continue;
    await copyFile(path.join(dir, file), path.join(OUT_DIR, file));
    n += 1;
  }
  return n;
};

const archive = await copyFrom(ARCHIVE_DIR);
// Файлы админки копируются вторыми и перекрывают одноимённые из архива
const own = await copyFrom(POSTS_DIR);

console.log(
  `содержимое готово: ${archive} из архива, ${own} из админки, ${deleted.size} снято с сайта`,
);
