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
  loader: glob({ base: './src/content/blog', pattern: '**/*.md' }),
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
    /** meta description, если отличается от excerpt */
    description: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
