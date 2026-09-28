/**
 * ASCII-only, dash-separated, case kept. Diacritics are stripped; anything
 * else that isn't a letter or digit becomes a single dash.
 */
export const slugify = (input: string, fallback = 'image'): string => {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
};

/** Filename without its last extension. */
export const stripExtension = (filename: string): string => {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return filename;
  return filename.slice(0, dot);
};
