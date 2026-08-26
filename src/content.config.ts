import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Категории блога — раздел 4.6 ТЗ (ровно 6 штук).
 * Ключи используются в url-фильтре ленты и во фронтматтере записей.
 */
export const CATEGORIES = {
  nagrady: 'Награды',
  pressa: 'Пресса о нас',
  degustacii: 'Дегустации',
  komandirovki: 'Командировки и обучение',
  otrasl: 'Позиция отрасли',
  raznoe: 'Разное/гости',
} as const;

export type CategoryKey = keyof typeof CATEGORIES;

const blog = defineCollection({
  /**
   * Читаем из .content/blog, а не из src/content/blog напрямую: этот каталог
   * собирает scripts/prepare-content.mjs из архива в репозитории и записей,
   * созданных через админку на сервере. Запускается сам перед build и dev.
   */
  loader: glob({ base: './.content/blog', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(),
    /** Оригинальная дата публикации с донора — раздел 8 ТЗ */
    date: z.coerce.date(),
    category: z.enum(
      Object.keys(CATEGORIES) as [CategoryKey, ...CategoryKey[]],
    ),
    /** Анонс ~150 символов для карточки в ленте */
    excerpt: z.string(),
    /** Имя файла обложки с донора (public/images/legacy/…) */
    cover: z.string().optional(),
    /** Имена файлов галереи с донора */
    gallery: z.array(z.string()).default([]),
    /** ID видео на YouTube для встраивания */
    youtube: z.string().optional(),
    /** Исходный URL на доноре — для редиректов и атрибуции */
    legacyUrl: z.string().optional(),
    /**
     * Дата публикации восстановлена приблизительно. У части архивных статей
     * её нет ни в адресе, ни в тексте: вывод даты в шаблоне донора отключён.
     * Такие записи датированы по их месту в sitemap донора, который идёт
     * обратно-хронологически, поэтому надёжен только год — его и показываем.
     */
    dateApproximate: z.boolean().default(false),
    /** meta description, если отличается от excerpt */
    description: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
