/**
 * HTML админки. Страниц три: вход, список записей, редактор.
 *
 * Собирается строками, без шаблонизатора и сборщика: админка отдаётся
 * тем же процессом, что принимает заявки, и тащить ради трёх страниц
 * ещё один инструмент незачем. Стиль повторяет сайт, чтобы не выглядело
 * чужой панелью.
 */

import { escapeHtml } from '../lib/http.mjs';
import { CATEGORIES } from './posts.mjs';

const STYLE = `
  :root {
    --bg: #1C1410; --surface: #2B211B; --accent: #F4A93B; --accent-hover: #FFC15E;
    --text: #FAF3E8; --muted: #C9B8A4; --border: #43342A;
    --ok: #7FA66B; --error: #E2604A; --radius: 10px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 16px/1.55 Inter, -apple-system, Segoe UI, Roboto, sans-serif;
  }
  a { color: var(--accent); }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 24px 20px 64px; }
  .narrow { max-width: 460px; }

  header.top {
    display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
    border-bottom: 1px solid var(--border); padding-bottom: 16px; margin-bottom: 24px;
  }
  header.top h1 { font-size: 20px; margin: 0; }
  header.top > div:first-child { margin-right: auto; }
  .brand { color: var(--accent); font-size: 12px; letter-spacing: .1em; text-transform: uppercase; }

  label { display: block; font-size: 12px; letter-spacing: .08em; text-transform: uppercase;
          color: var(--muted); margin: 16px 0 6px; }
  input, select, textarea, button {
    font: inherit; color: inherit;
  }
  input[type=text], input[type=password], input[type=date], select, textarea {
    width: 100%; padding: 11px 13px; background: #241A15;
    border: 1px solid var(--border); border-radius: var(--radius);
  }
  input:focus, select:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  textarea { min-height: 340px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 15px; }

  .btn {
    display: inline-flex; align-items: center; gap: 8px; padding: 11px 20px;
    border: 1px solid transparent; border-radius: var(--radius);
    font-weight: 600; cursor: pointer; text-decoration: none;
  }
  .btn--primary { background: var(--accent); color: var(--bg); }
  .btn--primary:hover { background: var(--accent-hover); }
  .btn--ghost { background: transparent; border-color: var(--border); color: var(--text); }
  .btn--ghost:hover { border-color: var(--accent); color: var(--accent); }
  .btn--danger { background: transparent; border-color: var(--error); color: var(--error); }
  .btn--danger:hover { background: var(--error); color: var(--bg); }
  .btn:disabled { opacity: .5; cursor: default; }

  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
       color: var(--accent); font-weight: 500; padding: 0 12px 10px 0; }
  td { padding: 12px 12px 12px 0; border-top: 1px solid var(--border); vertical-align: top; }
  td.actions { text-align: right; white-space: nowrap; }
  .muted { color: var(--muted); font-size: 14px; }
  .tag { display: inline-block; font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
         color: var(--muted); border: 1px solid var(--border); border-radius: 999px; padding: 3px 9px; }
  .badge-draft { color: var(--accent); border-color: var(--accent); }

  .note { padding: 12px 16px; border-radius: var(--radius); border: 1px solid var(--border);
          background: var(--surface); margin-bottom: 20px; }
  .note--error { border-color: var(--error); color: #FFD9D2; }
  .note--ok { border-color: var(--ok); }

  .grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 20px; }
  .editor { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; }
  .preview {
    border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 20px;
    background: var(--surface); overflow-wrap: anywhere; min-height: 340px;
  }
  .preview img { max-width: 100%; height: auto; border-radius: 6px; }
  .preview h1, .preview h2, .preview h3 { font-family: Georgia, serif; }
  .preview blockquote { border-left: 3px solid var(--accent); margin: 0; padding-left: 16px; color: var(--muted); }

  .toolbar { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .toolbar button {
    background: transparent; border: 1px solid var(--border); border-radius: 8px;
    padding: 7px 11px; cursor: pointer; font-size: 14px; min-height: 36px;
  }
  .toolbar button:hover { border-color: var(--accent); color: var(--accent); }

  .thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 8px; margin-top: 10px; }
  .thumbs button { padding: 0; border: 1px solid var(--border); border-radius: 8px; overflow: hidden;
                   background: none; cursor: pointer; aspect-ratio: 4/3; }
  .thumbs button:hover { border-color: var(--accent); }
  .thumbs img { width: 100%; height: 100%; object-fit: cover; display: block; }

  .status { font-size: 14px; color: var(--muted); }
  .status--running { color: var(--accent); }
  .status--error { color: var(--error); }

  @media (max-width: 860px) {
    .editor, .grid2 { grid-template-columns: minmax(0, 1fr); }
    .preview { min-height: 0; }
  }
`;

const page = (title, body, script = '') => `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)} · Админка</title>
<style>${STYLE}</style>
</head>
<body>
${body}
${script ? `<script>${script}</script>` : ''}
</body>
</html>`;

export const loginPage = (error = '') =>
  page(
    'Вход',
    `<div class="wrap narrow">
  <p class="brand">Лаборатория живого пива</p>
  <h1>Вход в админку</h1>
  ${error ? `<div class="note note--error">${escapeHtml(error)}</div>` : ''}
  <form method="post" action="/admin/login">
    <label for="login">Логин</label>
    <input type="text" id="login" name="login" autocomplete="username" autofocus required>
    <label for="password">Пароль</label>
    <input type="password" id="password" name="password" autocomplete="current-password" required>
    <p style="margin-top:24px"><button class="btn btn--primary" type="submit">Войти</button></p>
  </form>
</div>`,
  );

export const notConfiguredPage = () =>
  page(
    'Админка не настроена',
    `<div class="wrap narrow">
  <p class="brand">Лаборатория живого пива</p>
  <h1>Админка не настроена</h1>
  <div class="note note--error">
    В <code>/etc/pivzavod74.env</code> не заданы <code>ADMIN_LOGIN</code>,
    <code>ADMIN_PASSWORD_HASH</code> или <code>SESSION_SECRET</code>.
  </div>
  <p class="muted">Сгенерировать значения: <code>node scripts/admin-password.mjs</code>,
  затем перезапустить сервис.</p>
</div>`,
  );

const formatDate = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.valueOf())
    ? String(value ?? '')
    : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
};

export const listPage = (posts, flash = null) =>
  page(
    'Новости',
    `<div class="wrap">
  <header class="top">
    <div>
      <p class="brand">Лаборатория живого пива</p>
      <h1>Новости — ${posts.length}</h1>
    </div>
    <span class="status" id="build-status"></span>
    <input type="search" id="filter" placeholder="Поиск по заголовку"
           style="width:220px;padding:9px 13px" aria-label="Поиск по заголовку">
    <a class="btn btn--primary" href="/admin/new">Создать новость</a>
    <a class="btn btn--ghost" href="/admin/logout">Выйти</a>
  </header>

  ${flash ? `<div class="note note--${flash.type}">${escapeHtml(flash.text)}</div>` : ''}

  <table>
    <thead><tr><th>Заголовок</th><th>Дата</th><th>Категория</th><th></th></tr></thead>
    <tbody>
      ${posts
        .map(
          (post) => `<tr>
        <td>
          <a href="/admin/edit/${encodeURIComponent(post.slug)}">${escapeHtml(post.title ?? post.slug)}</a>
          ${post.draft ? '<span class="tag badge-draft">черновик</span>' : ''}
          <div class="muted">/blog/${escapeHtml(post.slug)}</div>
        </td>
        <td class="muted">${escapeHtml(formatDate(post.date))}</td>
        <td><span class="tag">${escapeHtml(CATEGORIES[post.category] ?? post.category ?? '')}</span></td>
        <td class="actions">
          <a class="btn btn--ghost" href="/admin/edit/${encodeURIComponent(post.slug)}">Изменить</a>
          <button class="btn btn--danger" data-delete="${escapeHtml(post.slug)}"
                  data-title="${escapeHtml(post.title ?? post.slug)}">Удалить</button>
        </td>
      </tr>`,
        )
        .join('\n')}
    </tbody>
  </table>
</div>`,
    `
  const filter = document.getElementById('filter');
  const allRows = [...document.querySelectorAll('table tbody tr')];
  filter.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase();
    let shown = 0;
    for (const row of allRows) {
      const match = !q || row.textContent.toLowerCase().includes(q);
      row.hidden = !match;
      if (match) shown++;
    }
    document.querySelector('header.top h1').textContent =
      q ? 'Новости — найдено ' + shown : 'Новости — ' + allRows.length;
  });

  document.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Удалить новость «' + btn.dataset.title + '»? Отменить будет нельзя.')) return;
      btn.disabled = true;
      const res = await fetch('/admin/api/posts/' + encodeURIComponent(btn.dataset.delete), { method: 'DELETE' });
      if (res.ok) location.reload();
      else { alert('Не удалось удалить'); btn.disabled = false; }
    });
  });
  ${BUILD_STATUS_JS}
`,
  );

/** Опрос состояния сборки — общий для списка и редактора */
const BUILD_STATUS_JS = `
  const statusEl = document.getElementById('build-status');
  const TEXT = {
    idle: (s) => s.finishedAt ? 'Сайт обновлён' : '',
    running: () => 'Публикуется…',
    queued: () => 'Публикуется…',
    error: (s) => s.error || 'Ошибка сборки',
  };
  let pollTimer = null;
  async function pollBuild() {
    try {
      const s = await (await fetch('/admin/api/build')).json();
      if (statusEl) {
        statusEl.textContent = (TEXT[s.status] || (() => ''))(s);
        statusEl.className = 'status status--' + s.status;
      }
      if (s.status === 'running' || s.status === 'queued') {
        pollTimer = setTimeout(pollBuild, 2000);
      } else if (pollTimer) {
        pollTimer = null;
        if (s.status === 'idle') setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 6000);
      }
    } catch { /* сеть моргнула — попробуем на следующем действии */ }
  }
  pollBuild();
`;

export const editorPage = (post, { uploads = [], isNew = false } = {}) => {
  const value = (v) => escapeHtml(v ?? '');
  const today = new Date().toISOString().slice(0, 10);

  return page(
    isNew ? 'Новая новость' : 'Правка',
    `<div class="wrap">
  <header class="top">
    <div>
      <p class="brand">Лаборатория живого пива</p>
      <h1>${isNew ? 'Новая новость' : 'Правка новости'}</h1>
    </div>
    <span class="status" id="build-status"></span>
    <a class="btn btn--ghost" href="/admin/">К списку</a>
  </header>

  <div id="msg"></div>

  <form id="editor" data-slug="${value(post.slug)}">
    <div class="grid2">
      <div>
        <label for="title">Заголовок</label>
        <input type="text" id="title" name="title" value="${value(post.title)}" required maxlength="200">
      </div>
      <div>
        <label for="date">Дата</label>
        <input type="date" id="date" name="date" value="${value(String(post.date ?? today).slice(0, 10))}">
      </div>
      <div>
        <label for="category">Категория</label>
        <select id="category" name="category">
          ${Object.entries(CATEGORIES)
            .map(
              ([key, label]) =>
                `<option value="${key}"${post.category === key ? ' selected' : ''}>${escapeHtml(label)}</option>`,
            )
            .join('')}
        </select>
      </div>
      <div>
        <label for="cover">Обложка</label>
        <input type="text" id="cover" name="cover" value="${value(post.cover)}"
               placeholder="выберите фото ниже или вставьте адрес">
      </div>
    </div>

    <label for="excerpt">Анонс для ленты <span class="muted" style="text-transform:none">— если пусто, возьмём начало текста</span></label>
    <input type="text" id="excerpt" name="excerpt" value="${value(post.excerpt)}" maxlength="400">

    <label style="display:flex;align-items:center;gap:8px;text-transform:none;font-size:15px;color:var(--text)">
      <input type="checkbox" id="draft" name="draft" style="width:auto"${post.draft ? ' checked' : ''}>
      Черновик — не показывать на сайте
    </label>

    <label>Текст</label>
    <div class="toolbar">
      <button type="button" data-md="bold" title="Полужирный">Ж</button>
      <button type="button" data-md="italic" title="Курсив"><em>К</em></button>
      <button type="button" data-md="h2">Заголовок</button>
      <button type="button" data-md="ul">Список</button>
      <button type="button" data-md="ol">Нумерация</button>
      <button type="button" data-md="quote">Цитата</button>
      <button type="button" data-md="link">Ссылка</button>
      <button type="button" id="upload-btn">Загрузить фото</button>
      <input type="file" id="file" accept="image/*" multiple hidden>
    </div>

    <div class="editor">
      <textarea id="body" name="body" spellcheck="true">${value(post.body)}</textarea>
      <div class="preview" id="preview"></div>
    </div>

    <label>Загруженные фото <span class="muted" style="text-transform:none">— клик вставляет в текст, Shift+клик ставит обложкой</span></label>
    <div class="thumbs" id="thumbs">
      ${uploads.map((u) => `<button type="button" data-url="${value(u)}"><img src="${value(u)}" alt=""></button>`).join('')}
    </div>

    <p style="margin-top:28px;display:flex;gap:12px;flex-wrap:wrap">
      <button class="btn btn--primary" type="submit">Сохранить и опубликовать</button>
      <a class="btn btn--ghost" href="/admin/">Отмена</a>
    </p>
  </form>
</div>`,
    `
  const body = document.getElementById('body');
  const preview = document.getElementById('preview');
  const msg = document.getElementById('msg');
  const form = document.getElementById('editor');

  // ── разметка через панель ───────────────────────────────────────────────
  function wrap(before, after) {
    const s = body.selectionStart, e = body.selectionEnd;
    const sel = body.value.slice(s, e);
    body.setRangeText(before + sel + after, s, e, 'end');
    if (!sel) body.selectionStart = body.selectionEnd = s + before.length;
    body.focus();
    schedulePreview();
  }
  function prefixLines(prefix) {
    const s = body.selectionStart, e = body.selectionEnd;
    const from = body.value.lastIndexOf('\\n', s - 1) + 1;
    const to = body.value.indexOf('\\n', e) < 0 ? body.value.length : body.value.indexOf('\\n', e);
    const block = body.value.slice(from, to).split('\\n');
    let n = 0;
    const out = block.map((line) => (typeof prefix === 'function' ? prefix(++n) : prefix) + line).join('\\n');
    body.setRangeText(out, from, to, 'end');
    body.focus();
    schedulePreview();
  }
  const ACTIONS = {
    bold: () => wrap('**', '**'),
    italic: () => wrap('*', '*'),
    h2: () => prefixLines('## '),
    ul: () => prefixLines('- '),
    ol: () => prefixLines((n) => n + '. '),
    quote: () => prefixLines('> '),
    link: () => {
      const url = prompt('Адрес ссылки', 'https://');
      if (url) wrap('[', '](' + url + ')');
    },
  };
  document.querySelectorAll('[data-md]').forEach((btn) => {
    btn.addEventListener('click', () => ACTIONS[btn.dataset.md]?.());
  });

  // ── предпросмотр ────────────────────────────────────────────────────────
  // Рендерит сервер тем же обработчиком markdown, что и сборка сайта:
  // иначе предпросмотр расходился бы с тем, что получится на странице.
  let previewTimer = null;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 400);
  }
  async function renderPreview() {
    try {
      const res = await fetch('/admin/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: body.value }),
      });
      const data = await res.json();
      preview.innerHTML = data.html ?? '';
    } catch { /* предпросмотр не критичен */ }
  }
  body.addEventListener('input', schedulePreview);
  renderPreview();

  // ── загрузка фото ───────────────────────────────────────────────────────
  const fileInput = document.getElementById('file');
  const thumbs = document.getElementById('thumbs');
  document.getElementById('upload-btn').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    for (const file of fileInput.files) await upload(file);
    fileInput.value = '';
  });

  async function upload(file) {
    say('Загружаю ' + file.name + '…', 'ok');
    try {
      const res = await fetch('/admin/api/upload?name=' + encodeURIComponent(file.name), {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      const data = await res.json();
      if (!res.ok) return say(data.error || 'Не удалось загрузить', 'error');

      insertImage(data.url);
      addThumb(data.url);
      say('Фото загружено', 'ok');
    } catch {
      say('Не удалось загрузить — проверьте связь', 'error');
    }
  }

  function insertImage(url) {
    const at = body.selectionStart;
    const text = '\\n\\n![](' + url + ')\\n\\n';
    body.setRangeText(text, at, body.selectionEnd, 'end');
    schedulePreview();
    if (!document.getElementById('cover').value) document.getElementById('cover').value = url;
  }

  function addThumb(url) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.url = url;
    btn.innerHTML = '<img alt="">';
    btn.firstChild.src = url;
    thumbs.prepend(btn);
  }

  thumbs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-url]');
    if (!btn) return;
    if (e.shiftKey) document.getElementById('cover').value = btn.dataset.url;
    else insertImage(btn.dataset.url);
  });

  // Перетаскивание файла прямо в текст — привычнее, чем искать кнопку
  body.addEventListener('dragover', (e) => e.preventDefault());
  body.addEventListener('drop', async (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    for (const file of e.dataTransfer.files) if (file.type.startsWith('image/')) await upload(file);
  });

  // ── сохранение ──────────────────────────────────────────────────────────
  function say(text, type) {
    msg.innerHTML = '<div class="note note--' + type + '">' + text + '</div>';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('button[type=submit]');
    submit.disabled = true;
    const previous = submit.textContent;
    submit.textContent = 'Сохраняю…';

    try {
      const res = await fetch('/admin/api/posts' + (form.dataset.slug ? '/' + encodeURIComponent(form.dataset.slug) : ''), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: document.getElementById('title').value,
          date: document.getElementById('date').value,
          category: document.getElementById('category').value,
          excerpt: document.getElementById('excerpt').value,
          cover: document.getElementById('cover').value,
          draft: document.getElementById('draft').checked,
          body: body.value,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        say(data.error || 'Не удалось сохранить', 'error');
        return;
      }
      form.dataset.slug = data.slug;
      history.replaceState(null, '', '/admin/edit/' + encodeURIComponent(data.slug));
      say('Сохранено. Сайт пересобирается — страница появится через полминуты.', 'ok');
      pollBuild();
    } finally {
      submit.disabled = false;
      submit.textContent = previous;
    }
  });

  ${BUILD_STATUS_JS}
`,
  );
};
