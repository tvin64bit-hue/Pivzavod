#!/usr/bin/env node
/**
 * Показывает chat_id, куда бот может слать заявки.
 *
 * Как пользоваться:
 *   1. Откройте бота t.me/Pivzavod_74_bot и нажмите «Запустить» (/start).
 *      Если заявки должны падать в общий чат — добавьте бота в группу
 *      и напишите там любое сообщение.
 *   2. node scripts/telegram-chat-id.mjs <токен>
 *      (или задайте TELEGRAM_BOT_TOKEN в окружении и запустите без аргумента)
 *
 * Токен нигде не сохраняется и в репозиторий не попадает.
 */

const token = process.argv[2] || process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('Укажите токен: node scripts/telegram-chat-id.mjs <токен>');
  process.exit(1);
}

const api = (method) => `https://api.telegram.org/bot${token}/${method}`;

const call = async (method) => {
  const res = await fetch(api(method));
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description ?? res.status}`);
  return data.result;
};

try {
  const me = await call('getMe');
  console.log(`Бот: @${me.username} (${me.first_name})\n`);

  const updates = await call('getUpdates');
  const chats = new Map();

  for (const u of updates) {
    const msg = u.message ?? u.channel_post ?? u.my_chat_member;
    if (msg?.chat) chats.set(msg.chat.id, msg.chat);
  }

  if (!chats.size) {
    console.log('Сообщений боту пока нет.');
    console.log('Напишите ему что-нибудь (или добавьте в группу и напишите там)');
    console.log('и запустите скрипт ещё раз.');
    process.exit(0);
  }

  console.log('Найденные чаты:\n');
  for (const chat of chats.values()) {
    const name = chat.title ?? [chat.first_name, chat.last_name].filter(Boolean).join(' ');
    console.log(`  TELEGRAM_CHAT_ID=${chat.id}   ${chat.type}  ${name}`);
  }
  console.log('\nНужный id скопируйте в .dev.vars и в переменные Cloudflare Pages.');
} catch (e) {
  console.error('Ошибка:', e.message);
  process.exit(1);
}
