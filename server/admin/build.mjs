/**
 * Пересборка сайта после публикации.
 *
 * Сайт статический, поэтому «опубликовать» значит собрать заново. Полная
 * сборка занимает около полуминуты — держать на ней открытую форму нельзя,
 * поэтому публикация ставит сборку в очередь и сразу отвечает, а админка
 * показывает состояние.
 *
 * Две вещи, ради которых это не просто «запустить npm run build»:
 *
 *   1. Сборка идёт в отдельный каталог, и только готовый результат
 *      подменяет рабочий — переключением симлинка, одной операцией.
 *      Иначе посетитель, зашедший в момент сборки, увидит полсайта.
 *   2. Одновременно идёт не больше одной сборки. Если во время сборки
 *      опубликовали ещё раз, следующая запускается после текущей —
 *      ровно один раз, сколько бы правок ни накопилось.
 */

import { spawn } from 'node:child_process';
import { rm, rename, symlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
/**
 * Симлинк, на который смотрит nginx, и каталог со сборками. Оба лежат внутри
 * /var/www/pivzavod74, который принадлежит www-data: так сервису не нужно
 * право записи в /var/www целиком, чтобы переключить симлинк.
 */
const LIVE = process.env.WEB_ROOT || '/var/www/pivzavod74/current';
const RELEASES = process.env.RELEASES_DIR || '/var/www/pivzavod74/releases';

const state = {
  status: 'idle', // idle | running | queued | error
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  error: null,
  log: '',
};

let queued = false;
/** Отдельный флаг, а не проверка state.status: пока идёт сборка, статус
    успевает смениться на «queued», и по нему параллельный запуск не отсечь */
let busy = false;

export const buildState = () => ({ ...state });

const run = (command, args, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, ...options });
    let out = '';
    const take = (chunk) => {
      out += chunk;
      // Держим только хвост: при ошибке важны последние строки
      if (out.length > 20_000) out = out.slice(-20_000);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (err) => resolve({ code: -1, out: `${out}\n${err.message}` }));
    child.on('close', (code) => resolve({ code, out }));
  });

const buildOnce = async () => {
  const started = Date.now();
  state.status = 'running';
  state.startedAt = started;
  state.error = null;

  const outDir = path.join(RELEASES, String(started));
  await mkdir(RELEASES, { recursive: true });

  // Слой админки поверх архива из репозитория
  const prep = await run(process.execPath, ['scripts/prepare-content.mjs']);
  if (prep.code !== 0) {
    state.status = 'error';
    state.error = 'Не удалось подготовить содержимое';
    state.log = prep.out;
    state.finishedAt = Date.now();
    return;
  }

  const build = await run('npx', ['astro', 'build', '--outDir', outDir], {
    env: { ...process.env, NODE_ENV: 'production' },
  });

  state.log = build.out;

  if (build.code !== 0 || !existsSync(path.join(outDir, 'index.html'))) {
    state.status = 'error';
    state.error = 'Сборка завершилась с ошибкой — сайт остался прежним';
    state.finishedAt = Date.now();
    await rm(outDir, { recursive: true, force: true });
    return;
  }

  await swapLive(outDir);
  await dropOldReleases();

  state.status = 'idle';
  state.finishedAt = Date.now();
  state.durationMs = state.finishedAt - started;
};

/**
 * Подменяет рабочую сборку готовой.
 *
 * На сервере это переключение симлинка: rename симлинка атомарен, поэтому
 * посетитель не может застать полусобранное состояние.
 *
 * На Windows создать симлинк на каталог без прав администратора нельзя
 * (EPERM), а проверять сайт локально надо. Там переносим каталог: секунду
 * сайт недоступен, но локально это никого не трогает.
 */
const swapLive = async (outDir) => {
  const tmpLink = `${LIVE}.new`;
  await rm(tmpLink, { recursive: true, force: true });

  try {
    // 'junction' — тип для Windows, где обычный симлинк на каталог требует
    // прав администратора; на Linux аргумент игнорируется
    await symlink(outDir, tmpLink, 'junction');
    await rename(tmpLink, LIVE);
    return;
  } catch (err) {
    console.warn(`build: подмена симлинком не удалась (${err.code ?? err.message}), переношу каталог`);
    await rm(tmpLink, { recursive: true, force: true });
  }

  // Запасной путь: подменяем каталог целиком
  const previous = `${LIVE}.old`;
  await rm(previous, { recursive: true, force: true });
  if (existsSync(LIVE)) await rename(LIVE, previous);
  await rename(outDir, LIVE);
  await rm(previous, { recursive: true, force: true });
};

/** Держим три последних сборки: откатиться есть куда, диск не забивается */
const dropOldReleases = async () => {
  const { readdir } = await import('node:fs/promises');
  // На запасном пути свежая сборка уже переехала в LIVE, так что здесь
  // остаются только предыдущие — держим три
  const entries = (await readdir(RELEASES).catch(() => []))
    .filter((name) => /^\d+$/.test(name))
    .sort((a, b) => Number(b) - Number(a));

  for (const old of entries.slice(3)) {
    await rm(path.join(RELEASES, old), { recursive: true, force: true });
  }
};

export const requestBuild = () => {
  if (busy) {
    queued = true;
    state.status = 'queued';
    return { queued: true };
  }

  busy = true;
  (async () => {
    try {
      do {
        queued = false;
        try {
          await buildOnce();
        } catch (err) {
          state.status = 'error';
          state.error = err?.message ?? String(err);
          state.finishedAt = Date.now();
        }
      } while (queued);
    } finally {
      busy = false;
    }
  })();

  return { started: true };
};
