import { isGerman } from '../i18n';
import type { OutputFormat } from './types';

export const FORMAT_EXTENSIONS: Record<OutputFormat, string> = {
  jpeg: 'jpg',
  webp: 'webp',
  avif: 'avif',
  png: 'png',
  pdf: 'pdf',
};

export const FORMAT_MIME: Record<OutputFormat, string> = {
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  png: 'image/png',
  pdf: 'application/pdf',
};

export const FORMAT_LABELS: Record<OutputFormat, string> = {
  jpeg: 'JPEG',
  webp: 'WebP',
  avif: 'AVIF',
  png: 'PNG',
  pdf: 'PDF',
};

/** 1536 → "1.5 KB". Uses 1 KB = 1000 B to match what file managers show on macOS/web. */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1000;
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }
  const digits = value >= 100 ? 0 : 1;
  const number = value.toFixed(digits);
  return `${isGerman() ? number.replace('.', ',') : number} ${units[unitIndex]}`;
};

/** Signed percentage change from `before` to `after`, e.g. "−82%" or "+4%". */
export const formatSavings = (before: number, after: number): string => {
  if (before <= 0) return '—';
  const change = Math.round(((after - before) / before) * 100);
  const percent = isGerman() ? ' %' : '%';
  if (change === 0) return `±0${percent}`;
  if (change < 0) return `−${Math.abs(change)}${percent}`;
  return `+${change}${percent}`;
};

/** Parses "200 KB", "1.5mb", "150000" into bytes. Returns null if unparseable or non-positive. */
export const parseByteSize = (input: string): number | null => {
  // Accepts a decimal comma too ("1,5 MB").
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*(b|kb|k|mb|m)?\s*$/i.exec(input);
  if (!match) return null;
  const value = Number((match[1] ?? '').replace(',', '.'));
  const unit = (match[2] ?? 'kb').toLowerCase();
  const multiplier = unit.startsWith('m') ? 1_000_000 : unit.startsWith('k') ? 1000 : 1;
  const bytes = Math.round(value * multiplier);
  if (bytes <= 0) return null;
  return bytes;
};
