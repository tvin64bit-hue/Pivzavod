// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Канонический домен. Переопределяется переменной окружения SITE_URL при сборке
// (например, для превью-деплоя Cloudflare Pages).
const SITE = process.env.SITE_URL || 'https://pivzavod74.ru';

export default defineConfig({
  site: SITE,
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  integrations: [
    sitemap({
      // Раздел 7 ТЗ: на новом сайте нет причин закрывать индексацию.
      filter: (page) => !page.includes('/404'),
      changefreq: 'monthly',
      lastmod: new Date(),
      serialize(item) {
        if (item.url === SITE + '/') item.priority = 1.0;
        else if (/\/(o-kompanii|gde-kupit|opyt|blog|kontakty)\/?$/.test(item.url)) item.priority = 0.9;
        else item.priority = 0.6;
        return item;
      },
    }),
  ],
  markdown: {
    shikiConfig: { theme: 'github-dark' },
  },
});
