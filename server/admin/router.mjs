/**
 * Маршруты админки: страницы и её собственный API.
 *
 * Всё под /admin. Наружу этот процесс не смотрит — перед ним nginx.
 */

import { json, html, redirect, readBody, rejectBody, escapeHtml } from '../lib/http.mjs';
import { authConfigured, isLoggedIn, login, logout } from './auth.mjs';
import { listPosts, getPost, savePost, deletePost } from './posts.mjs';
import { saveUpload, listUploads, MAX_UPLOAD } from './uploads.mjs';
import { requestBuild, buildState } from './build.mjs';
import { renderMarkdown } from './render.mjs';
import { loginPage, notConfiguredPage, listPage, editorPage } from './ui.mjs';

const clientIp = (req) =>
  (req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
    .toString()
    .split(',')[0]
    .trim();

/**
 * Запрос с чужого сайта. Кука выставлена с SameSite=Strict, так что браузер
 * её и так не пришлёт, но проверка Origin страхует на случай, если админку
 * когда-нибудь откроют иначе.
 */
const sameOrigin = (req) => {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
};

const readJson = async (req, res) => {
  try {
    return JSON.parse((await readBody(req)).toString('utf8'));
  } catch (err) {
    if (err?.message === 'too_large') rejectBody(req, res, 413, 'too_large');
    else json(res, 400, { ok: false, error: 'Неверный запрос' });
    return null;
  }
};

export const handleAdmin = async (req, res, url) => {
  const { pathname } = url;

  if (!authConfigured) return html(res, 503, notConfiguredPage());

  // ── вход и выход ──────────────────────────────────────────────────────────

  if (pathname === '/admin/login') {
    if (req.method === 'GET') {
      return isLoggedIn(req) ? redirect(res, '/admin/') : html(res, 200, loginPage());
    }
    if (req.method === 'POST') {
      if (!sameOrigin(req)) return html(res, 403, loginPage('Запрос отклонён'));

      const form = new URLSearchParams((await readBody(req, 4096).catch(() => Buffer.alloc(0))).toString('utf8'));
      const result = login(req, res, clientIp(req), {
        login: form.get('login') ?? '',
        password: form.get('password') ?? '',
      });

      if (result.ok) return redirect(res, '/admin/');
      return html(
        res,
        401,
        loginPage(
          result.error === 'too_many_attempts'
            ? 'Слишком много попыток. Подождите минуту.'
            : 'Неверный логин или пароль',
        ),
      );
    }
  }

  if (pathname === '/admin/logout') {
    logout(req, res);
    return redirect(res, '/admin/login');
  }

  // ── дальше только для вошедших ────────────────────────────────────────────

  if (!isLoggedIn(req)) {
    if (pathname.startsWith('/admin/api/')) return json(res, 401, { ok: false, error: 'Нужен вход' });
    return redirect(res, '/admin/login');
  }

  if (req.method !== 'GET' && !sameOrigin(req)) {
    return json(res, 403, { ok: false, error: 'Запрос с чужого сайта' });
  }

  // ── страницы ──────────────────────────────────────────────────────────────

  if (pathname === '/admin' || pathname === '/admin/') {
    return html(res, 200, listPage(await listPosts()));
  }

  if (pathname === '/admin/new') {
    return html(res, 200, editorPage({ category: 'raznoe', gallery: [] }, {
      uploads: await listUploads(),
      isNew: true,
    }));
  }

  if (pathname.startsWith('/admin/edit/')) {
    const slug = decodeURIComponent(pathname.slice('/admin/edit/'.length));
    const post = await getPost(slug);
    if (!post) return html(res, 404, listPage(await listPosts(), { type: 'error', text: 'Записи нет' }));
    return html(res, 200, editorPage(post, { uploads: await listUploads() }));
  }

  // ── API ───────────────────────────────────────────────────────────────────

  if (pathname === '/admin/api/build' && req.method === 'GET') {
    const { log, ...rest } = buildState();
    return json(res, 200, rest);
  }

  if (pathname === '/admin/api/preview' && req.method === 'POST') {
    const payload = await readJson(req, res);
    if (payload === null) return;
    try {
      return json(res, 200, { html: await renderMarkdown(payload.body) });
    } catch (err) {
      return json(res, 200, { html: `<p style="color:#E2604A">Не удалось разобрать текст: ${escapeHtml(err.message)}</p>` });
    }
  }

  if (pathname === '/admin/api/upload' && req.method === 'POST') {
    let buffer;
    try {
      buffer = await readBody(req, MAX_UPLOAD);
    } catch (err) {
      if (err?.message === 'too_large') {
        return rejectBody(req, res, 413, `Файл больше ${Math.round(MAX_UPLOAD / 1024 / 1024)} МБ`);
      }
      return json(res, 400, { ok: false, error: 'Не удалось прочитать файл' });
    }

    const result = await saveUpload(buffer, url.searchParams.get('name'));
    return json(res, result.error ? 400 : 200, result);
  }

  if (pathname.startsWith('/admin/api/posts')) {
    const slug = decodeURIComponent(pathname.slice('/admin/api/posts'.length).replace(/^\//, ''));

    if (req.method === 'POST') {
      const payload = await readJson(req, res);
      if (payload === null) return;

      const result = await savePost(slug || null, payload);
      if (result.error) return json(res, 400, { ok: false, error: result.error });

      requestBuild();
      return json(res, 200, { ok: true, slug: result.slug });
    }

    if (req.method === 'DELETE' && slug) {
      const result = await deletePost(slug);
      if (result.error) return json(res, 404, { ok: false, error: result.error });

      requestBuild();
      return json(res, 200, { ok: true });
    }
  }

  if (pathname.startsWith('/admin/api/')) return json(res, 404, { ok: false, error: 'Нет такого метода' });
  return html(res, 404, listPage(await listPosts(), { type: 'error', text: 'Страница не найдена' }));
};
