#!/usr/bin/env node
/**
 * Готовит строки для /etc/pivzavod74.env: хеш пароля админки и секрет сессий.
 *
 *   node scripts/admin-password.mjs            — придумает пароль сам
 *   node scripts/admin-password.mjs 'мой-пароль'
 *
 * Сам пароль нигде не сохраняется: в env уходит только хеш, обратно
 * восстановить его нельзя. Запишите пароль в менеджер паролей сразу.
 */

import { randomBytes } from 'node:crypto';
import { hashPassword } from '../server/admin/auth.mjs';

const given = process.argv[2];

// Придуманный пароль: 4 слова читаются и диктуются по телефону лучше,
// чем случайные символы, а стойкость выше
const WORDS = [
  'солод', 'хмель', 'дрожжи', 'бочка', 'кега', 'варка', 'сусло', 'пена',
  'ячмень', 'фильтр', 'танк', 'этикетка', 'розлив', 'закваска', 'аромат', 'горечь',
];
const pick = () => WORDS[randomBytes(1)[0] % WORDS.length];

const password = given || Array.from({ length: 4 }, pick).join('-');

if (given && given.length < 12) {
  console.error('Пароль короче 12 символов — возьмите длиннее.');
  process.exit(1);
}

console.log('');
if (!given) {
  console.log(`Пароль: ${password}`);
  console.log('Запишите его — второй раз показан не будет.\n');
}
console.log('Строки для /etc/pivzavod74.env:\n');
console.log(`ADMIN_LOGIN=admin`);
console.log(`ADMIN_PASSWORD_HASH=${hashPassword(password)}`);
console.log(`SESSION_SECRET=${randomBytes(32).toString('base64url')}`);
console.log('');
