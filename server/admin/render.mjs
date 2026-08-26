/**
 * Предпросмотр текста записи.
 *
 * Рендерим тем же обработчиком markdown, что и сборка сайта
 * (@astrojs/markdown-remark — на нём построен вывод Astro), поэтому
 * предпросмотр совпадает с тем, что получится на странице. Свой мини-парсер
 * на клиенте расходился бы с настоящим на первой же нестандартной конструкции.
 */

import { createMarkdownProcessor } from '@astrojs/markdown-remark';

let processor = null;

export const renderMarkdown = async (source) => {
  processor ??= await createMarkdownProcessor({});
  const { code } = await processor.render(String(source ?? ''));
  return code;
};
