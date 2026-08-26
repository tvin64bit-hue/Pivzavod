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

/** Пивоварня работает с 2011 года; всё раньше — дата из текста, а не публикации */
const SITE_ERA_FROM = 2010;

const report = {
  startedAt: new Date().toISOString(),
  pages: { total: 0, ok: 0, failed: 0, skipped: 0 },
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
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Первое совпадение из списка шаблонов.
 * Элемент списка — регулярка либо пара [регулярка, номер группы]: у шаблонов
 * с обратной ссылкой на имя тега содержимое лежит во второй группе, а не в первой.
 */
function extract(html, patterns) {
  for (const entry of patterns) {
    const [re, group] = Array.isArray(entry) ? entry : [entry, 1];
    const m = html.match(re);
    if (m?.[group]) return m[group];
  }
  return null;
}

/**
 * Заголовок статьи. Донор — Joomla 1.5 с табличной вёрсткой:
 *   <h2 class="contentheading"><a class="contentpagetitle">Заголовок</a></h2>
 * Класс contentheading при этом носит и ячейка со слоганом в шапке
 * («Качество выше цены!»), одинаковая на всех страницах, — поэтому искать
 * по одному этому классу нельзя, нужен contentpagetitle.
 *
 * Запасной вариант — <title>, который у донора устроен как «Заголовок | Раздел».
 */
function parseTitle(html) {
  const raw = extract(html, [
    /<a[^>]*class="[^"]*contentpagetitle[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
    /<h2[^>]*class="[^"]*contentheading[^"]*"[^>]*>([\s\S]*?)<\/h2>/i,
    /<h1[^>]*class="[^"]*contentheading[^"]*"[^>]*>([\s\S]*?)<\/h1>/i,
    [/<([a-z]+)[^>]*class="[^"]*(?:item-?title|article-?title|page-?title)[^"]*"[^>]*>([\s\S]*?)<\/\1>/i, 2],
  ]);

  const fromMarkup = raw ? htmlToText(raw).split('\n')[0].trim() : '';
  if (fromMarkup) return fromMarkup;

  const docTitle = extract(html, [/<title[^>]*>([\s\S]*?)<\/title>/i]) ?? '';
  return htmlToText(docTitle)
    .split('\n')[0]
    // «Золото «Золотой осени» 2018 | Награждения» → без хвоста с разделом
    .replace(/\s*\|\s*[^|]*$/, '')
    .replace(/\s*[—–-]\s*Пивзавод\S*\s*$/i, '')
    .trim();
}

/** Дата из псевдонима статьи на доноре: «2018-05-02-10-34-23.html» */
function dateFromUrl(url) {
  const m = decodeURIComponent(url).match(/(\d{4})-(\d{2})-(\d{2})(?:-\d{2}){0,3}\.html?$/i);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.valueOf()) ? null : d;
}

/**
 * Дата публикации. Искать по всей странице нельзя: в меню донора висят ссылки
 * вида /index.php/2011-11-23-09-41-05.html, и статья 2018 года получала от них
 * дату 2011 года. Поэтому источники — только контейнер статьи и её адрес.
 *
 * Псевдоним в адресе идёт раньше даты из текста: Joomla собирает его из даты
 * создания записи, тогда как в тексте обычно стоит дата события, а не публикации.
 */
function parseDate(container, url) {
  const iso = extract(container, [/<time[^>]*datetime="([^"]+)"/i]);
  if (iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.valueOf())) return d;
  }

  const fromAlias = url ? dateFromUrl(url) : null;
  if (fromAlias) return fromAlias;

  const text = htmlToText(container);

  // Дата из текста — это чаще дата события, чем публикации, и в исторических
  // статьях встречается что угодно: «Индийский эль» дал 1835 год, «ПРОМАСС» —
  // 1995. Принимаем только то, что попадает в срок жизни сайта.
  const plausible = (d) => {
    const year = d.getUTCFullYear();
    return year >= SITE_ERA_FROM && year <= new Date().getUTCFullYear() ? d : null;
  };

  const ru = text.match(/(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i);
  if (ru && RU_MONTHS[ru[2].toLowerCase()]) {
    const d = plausible(
      new Date(Date.UTC(Number(ru[3]), RU_MONTHS[ru[2].toLowerCase()] - 1, Number(ru[1]))),
    );
    if (d) return d;
  }

  const dotted = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (dotted) {
    const d = plausible(
      new Date(Date.UTC(Number(dotted[3]), Number(dotted[2]) - 1, Number(dotted[1]))),
    );
    if (d) return d;
  }

  const dashed = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (dashed) {
    const d = plausible(
      new Date(Date.UTC(Number(dashed[1]), Number(dashed[2]) - 1, Number(dashed[3]))),
    );
    if (d) return d;
  }

  return null;
}

/**
 * Год из текста статьи, когда полной даты нет («…выставке "Золотая осень" 2018»).
 * Ставим 1 января этого года: это заведомо приблизительно, запись уходит в draft,
 * но так архивный материал не притворяется свежим, получив сегодняшнее число.
 */
function yearFallback(container, title) {
  const years = `${title} ${htmlToText(container)}`.match(/\b(20[0-2]\d)\b/g);
  if (!years) return null;
  // Берём самый поздний: в тексте могут упоминаться прошлые годы
  const year = Math.max(...years.map(Number));
  if (year < SITE_ERA_FROM || year > new Date().getUTCFullYear()) return null;
  return new Date(Date.UTC(year, 0, 1));
}

/**
 * Хвост шаблона Joomla, попадающий внутрь контейнера статьи:
 * навигация «< Предыдущая / Следующая >» и футерная линкоферма.
 * Ленивый поиск закрывающего </div> до них дотягивается, поэтому режем по метке.
 */
function trimTrailingChrome(containerHtml) {
  const markers = [
    /<table[^>]*class="[^"]*pagenav[^"]*"/i,
    /<div[^>]*class="[^"]*headerbody[^"]*"/i,
    /<[a-z]+[^>]*class="[^"]*pagination[^"]*"/i,
  ];

  let cut = containerHtml.length;
  for (const re of markers) {
    const m = containerHtml.match(re);
    if (m?.index !== undefined && m.index < cut) cut = m.index;
  }
  return containerHtml.slice(0, cut);
}

function parseContainer(html) {
  return trimTrailingChrome(
    extract(html, [
      /<div[^>]*itemprop="articleBody"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
      /<div[^>]*class="[^"]*item-page[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
      /<div[^>]*class="[^"]*article-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
      /<body[^>]*>([\s\S]*?)<\/body>/i,
    ]) ?? html,
  );
}

function parseBody(container) {
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

/**
 * Уже лежащие в репозитории записи: адрес на доноре → имя файла.
 * Часть записей заведена вручную по текстам ТЗ и ссылается на те же статьи.
 * Без этой карты миграция создала бы рядом второй файл с другим именем,
 * и в ленте появились бы дубли.
 */
const existingByLegacyUrl = new Map();

async function indexExistingPosts() {
  let files;
  try {
    files = await fs.readdir(CONFIG.postsDir);
  } catch {
    return;
  }

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const text = await fs.readFile(path.join(CONFIG.postsDir, file), 'utf8');
    const m = text.match(/^legacyUrl:\s*(\S+)\s*$/m);
    if (m) existingByLegacyUrl.set(m[1], file);
  }
}

/** Убрать прежнюю запись про ту же статью, если она называлась иначе */
async function dropSupersededPost(url, slug) {
  const previous = existingByLegacyUrl.get(url);
  if (!previous || previous === `${slug}.md`) return;

  if (!DRY_RUN) await fs.rm(path.join(CONFIG.postsDir, previous), { force: true });
  console.log(`      заменяет прежнюю запись: ${previous}`);
}

/**
 * Занятые имена записей. Если шаблон донора отдаёт один и тот же заголовок
 * (например, название сайта из <title>), без этой защиты каждая следующая
 * статья затирала бы предыдущую и от архива осталась бы одна запись.
 */
const usedSlugs = new Set();

/** Имя записи: осмысленный заголовок, иначе адрес на доноре; всегда уникальное */
function uniqueSlug(fromTitle, fromUrl) {
  for (const candidate of [fromTitle, fromUrl]) {
    if (candidate && !usedSlugs.has(candidate)) {
      usedSlugs.add(candidate);
      return candidate;
    }
  }
  let n = 2;
  while (usedSlugs.has(`${fromUrl}-${n}`)) n += 1;
  usedSlugs.add(`${fromUrl}-${n}`);
  return `${fromUrl}-${n}`;
}

/**
 * Имена уже занятых файлов изображений: имя → исходный адрес.
 * На доноре в разных папках встречаются одноимённые картинки (1.jpg и т.п.) —
 * без проверки одна молча подменила бы другую.
 */
const imageNameOwner = new Map();

/** Имя файла из адреса: декодированное и безопасное для пути и URL */
function imageFileName(imageUrl) {
  let base = path.basename(new URL(imageUrl).pathname);
  try {
    // На доноре встречается «1_%202.jpg»: без декодирования браузер запросит
    // «1_ 2.jpg» и получит 404
    base = decodeURIComponent(base);
  } catch {
    /* невалидная escape-последовательность — оставляем как есть */
  }

  let name =
    base
      .replace(/\s+/g, '-')
      .replace(/[%?#&"'`\\:<>|*]/g, '') || `img-${Date.now()}`;

  const owner = imageNameOwner.get(name);
  if (owner && owner !== imageUrl) {
    const ext = path.extname(name);
    const stem = name.slice(0, name.length - ext.length);
    let n = 2;
    while (imageNameOwner.has(`${stem}-${n}${ext}`)) n += 1;
    name = `${stem}-${n}${ext}`;
  }
  imageNameOwner.set(name, imageUrl);
  return name;
}

/**
 * Результаты уже опрошенных изображений. Шапка, логотип и кнопки шаблона
 * повторяются на всех 152 страницах: без кэша мы бы качали их сотни раз,
 * а битый хотлинк ловил бы 30-секундный таймаут на каждой странице.
 */
const attemptedImages = new Map();

async function downloadImage(imageUrl) {
  if (attemptedImages.has(imageUrl)) {
    return { name: attemptedImages.get(imageUrl), fromNetwork: false, cached: true };
  }

  const name = imageFileName(imageUrl);
  const dest = path.join(CONFIG.imagesDir, name);

  report.images.total += 1;

  // Файл с прошлого прогона (--resume) — сети не касаемся
  if (existsSync(dest)) {
    report.images.ok += 1;
    attemptedImages.set(imageUrl, name);
    return { name, fromNetwork: false, cached: false };
  }

  try {
    const buf = await fetchWithTimeout(imageUrl, { binary: true });
    if (!DRY_RUN) await fs.writeFile(dest, buf);
    report.images.ok += 1;
    attemptedImages.set(imageUrl, name);
    return { name, fromNetwork: true, cached: false };
  } catch (err) {
    // Часть картинок — хотлинки на давно мёртвые домены (старый vkontakte.ru
    // и т.п.). Логируем и идём дальше, миграцию не прерываем.
    report.images.skipped += 1;
    report.failures.push({ kind: 'image', url: imageUrl, error: String(err.message ?? err) });
    attemptedImages.set(imageUrl, null);
    return { name: null, fromNetwork: true, cached: false };
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
  let pageFromNetwork = true;
  if (RESUME && existsSync(rawFile)) {
    html = await fs.readFile(rawFile, 'utf8');
    pageFromNetwork = false;
    console.log(`[${index}/${total}] из кэша: ${url}`);
  } else {
    console.log(`[${index}/${total}] загрузка: ${url}`);
    html = await fetchWithTimeout(url);
    if (!DRY_RUN) await fs.writeFile(rawFile, html, 'utf8');
  }

  const container = parseContainer(html);
  const title = parseTitle(html) || slugBase;
  const date = parseDate(container, url);
  // Заголовок и дата печатаются сразу: если шаблон донора не распознан,
  // это видно на первой же статье, а не после полного обхода
  console.log(`      заголовок: ${title}`);
  const body = parseBody(container);
  // Только картинки из тела статьи — иначе обложкой станет логотип шаблона
  const images = parseImages(container, url);

  const approxDate = date ? null : yearFallback(container, title);
  console.log(
    `      дата: ${
      date
        ? date.toISOString().slice(0, 10)
        : approxDate
          ? `${approxDate.toISOString().slice(0, 10)} (только год, условно)`
          : 'не распознана'
    }`,
  );

  if (!date) {
    report.failures.push({
      kind: 'date',
      url,
      error: approxDate
        ? `полная дата не найдена, распознан только год ${approxDate.getUTCFullYear()}`
        : 'дата публикации не распознана',
    });
  }

  const localImages = [];
  for (const [n, img] of images.entries()) {
    const { name, fromNetwork, cached } = await downloadImage(img);
    if (name) localImages.push(name);

    const mark = name ? name : 'пропущено (недоступно)';
    const note = cached ? ' — уже опрошено' : fromNetwork ? '' : ' — уже на диске';
    console.log(`      картинка ${n + 1}/${images.length}: ${mark}${note}`);

    // Crawl-delay относится к запросам, а не к чтению с диска
    if (fromNetwork) await sleep(CONFIG.crawlDelayMs);
  }

  // Часть адресов из sitemap донора ведёт на его страницу «404 - Ошибка: 404»,
  // причём с кодом 200. Такие страницы — не материалы, записей из них не делаем.
  // ТЗ это подтверждает: раздел «Экскурсионная программа» исключён именно
  // потому, что страниц по этим адресам на доноре уже нет.
  if (/^404\b/.test(title) || body.length < 50) {
    report.pages.skipped += 1;
    report.failures.push({
      kind: 'empty',
      url,
      error: /^404\b/.test(title) ? 'страница 404 донора' : 'пустое тело статьи',
    });
    console.log('    ✗ пропущено: страница без содержания');
    return { url, slug: null, title, images: 0, skipped: true, pageFromNetwork };
  }

  const slug = uniqueSlug(slugify(title), slugBase);
  const frontmatter = [
    '---',
    `title: ${yamlString(title)}`,
    `date: ${(date ?? approxDate ?? new Date()).toISOString().slice(0, 10)}`,
    `category: ${categoryFor(url)}`,
    `excerpt: ${yamlString(excerptFrom(body))}`,
    localImages[0] ? `cover: ${localImages[0]}` : null,
    localImages.length > 1 ? `gallery:\n${localImages.map((n) => `  - ${n}`).join('\n')}` : null,
    `legacyUrl: ${url}`,
    !date
      ? `draft: true  # ${
          approxDate
            ? `распознан только год ${approxDate.getUTCFullYear()}, число условное — уточните`
            : 'дата не распознана — проставьте вручную'
        }`
      : null,
    '---',
    '',
    body,
    '',
  ]
    .filter((line) => line !== null)
    .join('\n');

  await dropSupersededPost(url, slug);

  if (!DRY_RUN) {
    await fs.writeFile(path.join(CONFIG.postsDir, `${slug}.md`), frontmatter, 'utf8');
  }

  return { url, slug, title, images: localImages.length, pageFromNetwork };
}

async function main() {
  for (const dir of [CONFIG.rawDir, CONFIG.imagesDir, CONFIG.postsDir]) {
    await fs.mkdir(dir, { recursive: true });
  }

  await indexExistingPosts();

  const all = (await fs.readFile(CONFIG.urlList, 'utf8'))
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('http') && l.includes('pivzavod74.ru'));

  // Статьи на доноре оканчиваются на .html. Остальные девять адресов —
  // корень и страницы-листинги разделов («Новости/», «Дегустация/» и т.п.):
  // это витрины с анонсами и десятками миниатюр, а не материалы. Переносить
  // их как записи блога незачем — разделы на новом сайте свои.
  const list = all.filter((l) => /\.html?$/i.test(l));
  const skippedSections = all.length - list.length;

  const urls = LIMIT ? list.slice(0, LIMIT) : list;
  report.pages.total = urls.length;

  console.log(
    `Миграция: ${urls.length} статей, задержка ${CONFIG.crawlDelayMs / 1000}s между запросами` +
      `${DRY_RUN ? ' (dry-run, файлы не пишутся)' : ''}`,
  );
  if (skippedSections) {
    console.log(`Пропущено страниц-листингов разделов: ${skippedSections}`);
  }
  console.log(
    `Ожидаемое время: от ${Math.ceil((urls.length * CONFIG.crawlDelayMs) / 60000)} мин, ` +
      'плюс по 5 с на каждое новое изображение\n',
  );

  for (const [i, url] of urls.entries()) {
    let fetchedFromNetwork = true;
    try {
      const result = await migratePage(url, i + 1, urls.length);
      fetchedFromNetwork = result.pageFromNetwork;
      if (!result.skipped) {
        report.pages.ok += 1;
        console.log(`    → ${result.slug}.md (${result.images} изобр.)`);
      }
    } catch (err) {
      report.pages.failed += 1;
      report.failures.push({ kind: 'page', url, error: String(err.message ?? err) });
      console.error(`    ✗ ${url}: ${err.message ?? err}`);
    }

    // Crawl-delay относится к запросам к донору. При повторном разборе из кэша
    // (--resume) сети не касаемся, и выжидать нечего: полный переразбор
    // 144 статей иначе стоил бы 12 минут пустого ожидания.
    if (fetchedFromNetwork && i < urls.length - 1) await sleep(CONFIG.crawlDelayMs);
  }

  report.finishedAt = new Date().toISOString();
  if (!DRY_RUN) {
    await fs.writeFile(CONFIG.reportFile, JSON.stringify(report, null, 2), 'utf8');
  }

  console.log('\n— Итог —');
  console.log(
    `Страницы:    ${report.pages.ok} ок, ${report.pages.skipped} без содержания, ` +
      `${report.pages.failed} с ошибкой`,
  );
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
