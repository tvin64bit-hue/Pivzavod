#!/usr/bin/env node
/**
 * Миграция контента с сайта-донора pivzavod74.ru (раздел 8 ТЗ, сценарий А).
 *
 * Что делает:
 *   1. читает список URL из sitemap_urls.txt (153 страницы);
 *   2. обходит их с задержкой Crawl-delay: 5 с, последовательно, без параллелизма;
 *   3. сохраняет сырой HTML в assets/legacy-content/raw/ (не в git);
 *   4. вытаскивает заголовок, дату публикации, текст и список <img>;
 *   5. качает изображения в public/images/legacy/ (директория /images/ на доноре
 *      закрыта 403, поэтому только адреса из <img> на самих страницах);
 *   6. пишет записи блога в src/content/blog/*.md с оригинальными датами.
 *
 * Недоступные хотлинки на мёртвые домены (старый vkontakte.ru и т.п.)
 * логируются в assets/legacy-content/migration-report.json и пропускаются —
 * процесс миграции из-за них не прерывается.
 *
 * Запуск:  npm run migrate            — полный проход
 *          npm run migrate -- --limit 5   — первые 5 URL, для проверки
 *          npm run migrate -- --dry-run   — без записи файлов
 *          npm run migrate -- --resume    — пропустить уже скачанные страницы
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CONFIG = {
  urlList: path.join(ROOT, 'sitemap_urls.txt'),
  rawDir: path.join(ROOT, 'assets', 'legacy-content', 'raw'),
  imagesDir: path.join(ROOT, 'public', 'images', 'legacy'),
  postsDir: path.join(ROOT, 'src', 'content', 'blog'),
  reportFile: path.join(ROOT, 'assets', 'legacy-content', 'migration-report.json'),
  origin: 'https://pivzavod74.ru',
  /** robots.txt донора: Crawl-delay: 5 — не чаще одного запроса в 5 секунд */
  crawlDelayMs: 5000,
  requestTimeoutMs: 30000,
  userAgent:
    'Mozilla/5.0 (compatible; pivzavod74-migration/1.0; +https://pivzavod74.ru/) content-migration',
};

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const DRY_RUN = flag('dry-run');
const RESUME = flag('resume');
const LIMIT = Number(option('limit', '0')) || 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const report = {
  startedAt: new Date().toISOString(),
  pages: { total: 0, ok: 0, failed: 0 },
  images: { total: 0, ok: 0, skipped: 0 },
  failures: [],
};

/* ------------------------------------------------------------------ utils */

/** Категории блога по разделу пути на доноре → ключи из src/content.config.ts */
const CATEGORY_MAP = {
  'Награждения': 'nagrady',
  'О-нас-пишут': 'pressa',
  'Дегустация': 'degustacii',
  'Дегустационный-зал-пива': 'degustacii',
  'Учёба': 'komandirovki',
  'Экскурсионная-программа': 'komandirovki',
  'Вопросы-к-власти': 'otrasl',
  'Союз-пивоваров': 'otrasl',
  'Плохие-новости': 'otrasl',
  'Оборудование': 'raznoe',
  'Гости': 'raznoe',
  'Пивной-клуб': 'raznoe',
  'Ванны-с-горячим-пивом': 'raznoe',
  'Акции': 'raznoe',
  'Новости': 'raznoe',
  'Случайные-новости': 'raznoe',
};

const RU_MONTHS = {
  'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4, 'мая': 5, 'июня': 6,
  'июля': 7, 'августа': 8, 'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12,
};

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[а-яё]/g, (ch) => TRANSLIT[ch] ?? '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'zapis';
}

function decodeEntities(text) {
  const named = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', laquo: '«', raquo: '»',
    mdash: '—', ndash: '–', hellip: '…', rsquo: '’', deg: '°', shy: '',
  };
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => named[name.toLowerCase()] ?? m);
}

/** HTML → плоский текст с сохранением абзацев */
function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|tr)>/gi, '\n\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

function extract(html, patterns) {
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Joomla-шаблон донора: заголовок в .contentheading / h1 / h2.item-title */
function parseTitle(html) {
  const raw =
    extract(html, [
      /<h1[^>]*class="[^"]*contentheading[^"]*"[^>]*>([\s\S]*?)<\/h1>/i,
      /<h2[^>]*class="[^"]*item-?title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i,
      /<div[^>]*class="[^"]*contentheading[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<h1[^>]*>([\s\S]*?)<\/h1>/i,
      /<h2[^>]*>([\s\S]*?)<\/h2>/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i,
    ]) ?? '';
  return htmlToText(raw).split('\n')[0].trim();
}

function parseDate(html) {
  // 1) машинночитаемая дата в <time datetime="...">
  const iso = extract(html, [/<time[^>]*datetime="([^"]+)"/i]);
  if (iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.valueOf())) return d;
  }

  // 2) Joomla «Опубликовано: 12 марта 2018»
  const ru = html.match(/(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i);
  if (ru && RU_MONTHS[ru[2].toLowerCase()]) {
    return new Date(Date.UTC(Number(ru[3]), RU_MONTHS[ru[2].toLowerCase()] - 1, Number(ru[1])));
  }

  // 3) числовые форматы 12.03.2018 и 2018-03-12
  const dotted = html.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (dotted) {
    return new Date(Date.UTC(Number(dotted[3]), Number(dotted[2]) - 1, Number(dotted[1])));
  }
  const dashed = html.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (dashed) {
    return new Date(Date.UTC(Number(dashed[1]), Number(dashed[2]) - 1, Number(dashed[3])));
  }
  return null;
}

/** Основной текст: сначала контейнер статьи Joomla, иначе — всё тело */
function parseBody(html) {
  const container =
    extract(html, [
      /<div[^>]*itemprop="articleBody"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
      /<div[^>]*class="[^"]*item-page[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
      /<div[^>]*class="[^"]*article-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
      /<body[^>]*>([\s\S]*?)<\/body>/i,
    ]) ?? html;
  return htmlToText(container);
}

function parseImages(html, pageUrl) {
  const urls = new Set();
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const src = m[1].trim();
    if (!src || src.startsWith('data:')) continue;
    try {
      const abs = new URL(src, pageUrl);
      if (abs.protocol === 'http:' || abs.protocol === 'https:') urls.add(abs.href);
    } catch {
      /* мусорный src — пропускаем */
    }
  }
  return [...urls];
}

function categoryFor(url) {
  const seg = decodeURIComponent(url)
    .replace(`${CONFIG.origin}/index.php/`, '')
    .split('/')[0];
  return CATEGORY_MAP[seg] ?? 'raznoe';
}

function excerptFrom(text) {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= 150) return flat;
  const cut = flat.slice(0, 150);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

/** Экранирование строки для YAML-фронтматтера */
const yamlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

/* ----------------------------------------------------------------- network */

async function fetchWithTimeout(url, { binary = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': CONFIG.userAgent, Accept: binary ? '*/*' : 'text/html,*/*' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function downloadImage(imageUrl) {
  const name = path.basename(new URL(imageUrl).pathname) || `img-${Date.now()}`;
  const dest = path.join(CONFIG.imagesDir, name);

  report.images.total += 1;
  if (existsSync(dest)) {
    report.images.ok += 1;
    return name;
  }

  try {
    const buf = await fetchWithTimeout(imageUrl, { binary: true });
    if (!DRY_RUN) await fs.writeFile(dest, buf);
    report.images.ok += 1;
    return name;
  } catch (err) {
    // Часть картинок — хотлинки на давно мёртвые домены (старый vkontakte.ru
    // и т.п.). Логируем и идём дальше, миграцию не прерываем.
    report.images.skipped += 1;
    report.failures.push({ kind: 'image', url: imageUrl, error: String(err.message ?? err) });
    return null;
  }
}

/* -------------------------------------------------------------------- main */

async function migratePage(url, index, total) {
  const slugBase = slugify(
    decodeURIComponent(url)
      .replace(`${CONFIG.origin}/index.php/`, '')
      .replace(/\.html?$/, '')
      .replace(/\//g, '-'),
  );
  const rawFile = path.join(CONFIG.rawDir, `${slugBase}.html`);

  let html;
  if (RESUME && existsSync(rawFile)) {
    html = await fs.readFile(rawFile, 'utf8');
    console.log(`[${index}/${total}] из кэша: ${url}`);
  } else {
    console.log(`[${index}/${total}] загрузка: ${url}`);
    html = await fetchWithTimeout(url);
    if (!DRY_RUN) await fs.writeFile(rawFile, html, 'utf8');
  }

  const title = parseTitle(html) || slugBase;
  const date = parseDate(html);
  const body = parseBody(html);
  const images = parseImages(html, url);

  if (!date) {
    report.failures.push({ kind: 'date', url, error: 'дата публикации не распознана' });
  }

  const localImages = [];
  for (const img of images) {
    const name = await downloadImage(img);
    if (name) localImages.push(name);
    await sleep(CONFIG.crawlDelayMs);
  }

  const slug = slugify(title) || slugBase;
  const frontmatter = [
    '---',
    `title: ${yamlString(title)}`,
    `date: ${(date ?? new Date()).toISOString().slice(0, 10)}`,
    `category: ${categoryFor(url)}`,
    `excerpt: ${yamlString(excerptFrom(body))}`,
    localImages[0] ? `cover: ${localImages[0]}` : null,
    localImages.length > 1 ? `gallery:\n${localImages.map((n) => `  - ${n}`).join('\n')}` : null,
    `legacyUrl: ${url}`,
    !date ? 'draft: true  # дата не распознана — проверьте перед публикацией' : null,
    '---',
    '',
    body,
    '',
  ]
    .filter((line) => line !== null)
    .join('\n');

  if (!DRY_RUN) {
    await fs.writeFile(path.join(CONFIG.postsDir, `${slug}.md`), frontmatter, 'utf8');
  }

  return { url, slug, title, images: localImages.length };
}

async function main() {
  for (const dir of [CONFIG.rawDir, CONFIG.imagesDir, CONFIG.postsDir]) {
    await fs.mkdir(dir, { recursive: true });
  }

  const list = (await fs.readFile(CONFIG.urlList, 'utf8'))
    .split('\n')
    .map((l) => l.trim())
    // В sitemap донора попала строка-мусор со сломанной схемой — отсеиваем
    .filter((l) => l.startsWith('http') && l.includes('pivzavod74.ru'))
    // Корень сайта переносить нечего — там витрина, а не статья
    .filter((l) => l !== `${CONFIG.origin}/` && l !== CONFIG.origin);

  const urls = LIMIT ? list.slice(0, LIMIT) : list;
  report.pages.total = urls.length;

  console.log(
    `Миграция: ${urls.length} страниц, задержка ${CONFIG.crawlDelayMs / 1000}s между запросами` +
      `${DRY_RUN ? ' (dry-run, файлы не пишутся)' : ''}`,
  );
  console.log(`Ожидаемое время: не менее ${Math.ceil((urls.length * CONFIG.crawlDelayMs) / 60000)} мин\n`);

  for (const [i, url] of urls.entries()) {
    try {
      const result = await migratePage(url, i + 1, urls.length);
      report.pages.ok += 1;
      console.log(`    → ${result.slug}.md (${result.images} изобр.)`);
    } catch (err) {
      report.pages.failed += 1;
      report.failures.push({ kind: 'page', url, error: String(err.message ?? err) });
      console.error(`    ✗ ${url}: ${err.message ?? err}`);
    }

    if (i < urls.length - 1) await sleep(CONFIG.crawlDelayMs);
  }

  report.finishedAt = new Date().toISOString();
  if (!DRY_RUN) {
    await fs.writeFile(CONFIG.reportFile, JSON.stringify(report, null, 2), 'utf8');
  }

  console.log('\n— Итог —');
  console.log(`Страницы:    ${report.pages.ok} ок, ${report.pages.failed} с ошибкой`);
  console.log(`Изображения: ${report.images.ok} ок, ${report.images.skipped} пропущено`);
  console.log(`Отчёт:       ${path.relative(ROOT, CONFIG.reportFile)}`);
  if (report.failures.length) {
    console.log(`\nНеудач: ${report.failures.length} — детали в отчёте.`);
  }
}

main().catch((err) => {
  console.error('Миграция прервана:', err);
  process.exitCode = 1;
});
