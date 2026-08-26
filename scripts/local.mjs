#!/usr/bin/env node
/**
 * Запуск сайта вместе с админкой у себя на компьютере.
 *
 *   npm run local
 *
 * На сервере статику отдаёт nginx, а сюда приходят только /api и /admin.
 * Локально nginx нет, поэтому тот же процесс раздаёт ещё и сам сайт —
 * так проверять админку можно одной командой.
 *
 * Настройки берутся из файла .env в корне проекта (см. .env.example).
 * Файл в git не попадает.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');

if (!existsSync(ENV_FILE)) {
  console.error('Нет файла .env в корне проекта.');
  console.error('Скопируйте .env.example в .env и заполните — там написано, что куда.');
  process.exit(1);
}

/** Свой разбор, а не --env-file: понятнее ошибки и не зависит от версии Node */
const env = { ...process.env };
for (const raw of (await readFile(ENV_FILE, 'utf8')).split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq < 0) continue;
  const key = line.slice(0, eq).trim();
  // Кавычки вокруг значения снимаем, внутри значения не трогаем:
  // в хеше пароля и секрете сессии встречается что угодно
  env[key] = line.slice(eq + 1).trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
}

env.DATA_DIR ??= path.join(ROOT, 'data');
env.WEB_ROOT ??= path.join(ROOT, 'dist');
env.RELEASES_DIR ??= path.join(ROOT, '.releases');
env.STATIC_DIR ??= env.WEB_ROOT;
env.PORT ??= '4321';

const missing = ['ADMIN_LOGIN', 'ADMIN_PASSWORD_HASH', 'SESSION_SECRET'].filter((k) => !env[k]);
if (missing.length) {
  console.error(`В .env не заполнено: ${missing.join(', ')}`);
  console.error('Сгенерировать: node scripts/admin-password.mjs \'ваш-пароль\'');
  process.exit(1);
}

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, env, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${command} вернул ${code}`))));
  });

if (!existsSync(path.join(env.WEB_ROOT, 'index.html'))) {
  console.log('Сайт ещё не собран — собираю. Это займёт около полуминуты.\n');
  await run('npx', ['astro', 'build']);
  console.log('');
}

console.log(`Открывайте http://127.0.0.1:${env.PORT}/admin\n`);
await run(process.execPath, [path.join(ROOT, 'server/app.mjs')]);
