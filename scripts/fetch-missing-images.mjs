#!/usr/bin/env node
/**
 * Докачивает изображения, на которые ссылаются страницы сайта, но которых
 * нет в public/images/legacy/.
 *
 * Основная миграция берёт картинки только из тела статей, поэтому снимки
 * со служебных страниц донора (руководство, точки продаж) в выгрузку
 * не попали. Адрес ищем в сохранённом HTML, а если его там нет — перебираем
 * типовые пути Joomla.
 *
 * Запуск: node scripts/fetch-missing-images.mjs [--dry-run]
 * Донор из окружения сборки недоступен, поэтому скрипт рассчитан на прогон
 * в GitHub Actions вместе с миграцией.
 */

import fs from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://pivzavod74.ru';
const IMAGES_DIR = path.join(ROOT, 'public', 'images', 'legacy');
const RAW_DIR = path.join(ROOT, 'assets', 'legacy-content', 'raw');
const CRAWL_DELAY_MS = 5000;
const DRY_RUN = process.argv.includes('--dry-run');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Имена файлов, которые упоминает код сайта */
function referencedImages() {
  const names = new Set();
  const scan = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full);
      } else if (/\.(astro|ts)$/.test(entry.name)) {
        const text = readFileSync(full, 'utf8');
        for (const m of text.matchAll(/['"]([\w@.\- ]+\.(?:jpg|jpeg|png|gif))['"]/gi)) {
          names.add(m[1]);
        }
      }
    }
  };
  scan(path.join(ROOT, 'src'));
  return [...names];
}

/** Кандидаты в адреса: сначала из сохранённого HTML, потом типовые пути */
function candidateUrls(name) {
  const found = new Set();
  for (const file of readdirSync(RAW_DIR)) {
    if (!file.endsWith('.html')) continue;
    const html = readFileSync(path.join(RAW_DIR, file), 'utf8');
    const re = new RegExp(`["'\\s(]([^"'\\s)]*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})["'\\s)]`, 'i');
    const m = html.match(re);
    if (m) {
      try {
        found.add(new URL(m[1], ORIGIN).href);
      } catch {
        /* мусорный src */
      }
    }
  }
  // Joomla складывает картинки либо в /images, либо в /images/stories
  for (const p of [`/images/${name}`, `/images/stories/${name}`]) {
    found.add(ORIGIN + p);
  }
  return [...found];
}

async function download(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'pivzavod74-migration/1.0 (+https://pivzavod74.ru/)' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // Донор отдаёт свою страницу 404 с кодом 200 — отличаем по типу и размеру
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/') || buf.length < 512) {
      throw new Error(`не изображение (${type || 'без типа'}, ${buf.length} б)`);
    }
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  await fs.mkdir(IMAGES_DIR, { recursive: true });

  const missing = referencedImages().filter((n) => !existsSync(path.join(IMAGES_DIR, n)));
  if (!missing.length) {
    console.log('Все упомянутые изображения уже на месте.');
    return;
  }

  console.log(`Не хватает изображений: ${missing.length}`);
  console.log(missing.map((n) => `  ${n}`).join('\n'));
  console.log();

  let ok = 0;
  const failed = [];

  for (const [i, name] of missing.entries()) {
    const urls = candidateUrls(name);
    console.log(`[${i + 1}/${missing.length}] ${name} — вариантов адреса: ${urls.length}`);
    let done = false;

    for (const url of urls) {
      try {
        const buf = await download(url);
        if (!DRY_RUN) await fs.writeFile(path.join(IMAGES_DIR, name), buf);
        console.log(`    ✓ ${url} (${Math.round(buf.length / 1024)} КБ)`);
        ok += 1;
        done = true;
        break;
      } catch (err) {
        console.log(`    ✗ ${url}: ${err.message}`);
      }
      await sleep(CRAWL_DELAY_MS);
    }

    if (!done) failed.push(name);
    if (i < missing.length - 1) await sleep(CRAWL_DELAY_MS);
  }

  console.log(`\nСкачано: ${ok}, не найдено: ${failed.length}`);
  if (failed.length) {
    console.log('Не найдены на доноре — нужен файл от заказчика:');
    console.log(failed.map((n) => `  ${n}`).join('\n'));
  }
}

main().catch((err) => {
  console.error('Прервано:', err);
  process.exitCode = 1;
});
