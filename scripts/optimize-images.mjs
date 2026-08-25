#!/usr/bin/env node
/**
 * Пересжатие изображений, перенесённых с донора.
 *
 * Архив приезжает как есть: попадаются снимки шириной под 2000 px и весом
 * больше мегабайта, хотя на сайте они показываются максимум в 900 px.
 * Скрипт ужимает по ширине и пережимает JPEG, не трогая то, что уже лёгкое.
 *
 * Запуск:  node scripts/optimize-images.mjs [--dry-run] [--max-width 1600]
 *
 * Идемпотентен: повторный прогон ничего не меняет, потому что уже сжатые
 * файлы не проходят порог. Оригиналы при первом прогоне копируются
 * в assets/source-images/legacy-originals/.
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'public', 'images', 'legacy');
const BACKUP = path.join(ROOT, 'assets', 'source-images', 'legacy-originals');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const MAX_WIDTH = Number(args[args.indexOf('--max-width') + 1]) || 1600;
/** Ниже этого веса трогать нет смысла — выигрыш не окупает потерю качества */
const SIZE_FLOOR = 200 * 1024;
/** Не сохраняем результат, если он больше исходника или экономия мизерна */
const MIN_GAIN = 0.1;

const kb = (n) => `${Math.round(n / 1024)} КБ`;

async function main() {
  await fs.mkdir(BACKUP, { recursive: true });

  const files = (await fs.readdir(DIR)).filter((f) => /\.(jpe?g|png)$/i.test(f));
  let saved = 0;
  let touched = 0;
  const skipped = [];

  for (const name of files) {
    const src = path.join(DIR, name);
    const before = (await fs.stat(src)).size;

    let meta;
    try {
      meta = await sharp(src).metadata();
    } catch {
      skipped.push([name, 'не читается']);
      continue;
    }

    const tooWide = meta.width > MAX_WIDTH;
    const tooHeavy = before > SIZE_FLOOR;
    if (!tooWide && !tooHeavy) continue;

    let pipeline = sharp(src).rotate();
    if (tooWide) pipeline = pipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true });

    // PNG-фотографии переводим в JPEG: прозрачности в них нет, а вес втрое меньше
    const toJpeg = /\.png$/i.test(name) && !meta.hasAlpha;
    const buf = await (toJpeg || /\.jpe?g$/i.test(name)
      ? pipeline.jpeg({ quality: 82, mozjpeg: true })
      : pipeline.png({ compressionLevel: 9 })
    ).toBuffer();

    const gain = (before - buf.length) / before;
    if (gain < MIN_GAIN) {
      skipped.push([name, `выигрыш ${Math.round(gain * 100)}% — не трогаем`]);
      continue;
    }

    console.log(
      `  ${name.padEnd(32)} ${meta.width}px ${kb(before)} → ` +
        `${tooWide ? MAX_WIDTH : meta.width}px ${kb(buf.length)}  −${Math.round(gain * 100)}%`,
    );

    if (!DRY_RUN) {
      // Оригинал сохраняем один раз: при повторных прогонах не перезаписываем
      const keep = path.join(BACKUP, name);
      if (!existsSync(keep)) await fs.copyFile(src, keep);
      await fs.writeFile(src, buf);
    }

    saved += before - buf.length;
    touched += 1;
  }

  console.log(`\nОбработано: ${touched} из ${files.length}`);
  console.log(`Экономия:   ${Math.round(saved / 1024 / 1024)} МБ${DRY_RUN ? ' (dry-run)' : ''}`);
  if (skipped.length) {
    console.log(`Пропущено:  ${skipped.length}`);
    skipped.slice(0, 5).forEach(([n, why]) => console.log(`  ${n} — ${why}`));
  }
}

main().catch((err) => {
  console.error('Прервано:', err);
  process.exitCode = 1;
});
