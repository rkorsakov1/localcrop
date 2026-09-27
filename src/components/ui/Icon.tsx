// Small inline SVG icons (stroke-based, 20×20), so we don't need an icon package.

const paths = {
  crop: 'M5.5 2.5v12h12 M2.5 5.5h12v12',
  rotateLeft: 'M4.5 10a5.5 5.5 0 1 0 1.6-3.9 M4 3.5V7h3.5',
  rotateRight: 'M15.5 10a5.5 5.5 0 1 1-1.6-3.9 M16 3.5V7h-3.5',
  flipH: 'M10 3v14 M7.5 6 3.5 14h4z M12.5 6l4 8h-4z',
  flipV: 'M3 10h14 M6 7.5l8-4v4z M6 12.5l8 4v-4z',
  grid: 'M3.5 3.5h13v13h-13z M7.8 3.5v13 M12.2 3.5v13 M3.5 7.8h13 M3.5 12.2h13',
  reset: 'M4 10a6 6 0 1 0 1.8-4.3 M4 3.5v3h3',
  upload: 'M10 13V3.5 M6.5 7 10 3.5 13.5 7 M4 13.5v2.5h12v-2.5',
  download: 'M10 3.5V13 M6.5 9.5 10 13l3.5-3.5 M4 16h12',
  copy: 'M7 7h9v9H7z M4 13V4h9',
  lock: 'M5.5 9h9v7.5h-9z M7.5 9V6.5a2.5 2.5 0 0 1 5 0V9',
  link: 'M8.5 11.5l3-3 M9 5.5l1-1a3 3 0 0 1 4.5 4.5l-1 1 M11 14.5l-1 1a3 3 0 0 1-4.5-4.5l1-1',
  unlink: 'M9 5.5l1-1a3 3 0 0 1 4.5 4.5l-1 1 M11 14.5l-1 1a3 3 0 0 1-4.5-4.5l1-1 M4 4l2 2 M16 16l-2-2',
  sun: 'M10 13.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M10 2v1.5 M10 16.5V18 M2 10h1.5 M16.5 10H18 M4.3 4.3l1.1 1.1 M14.6 14.6l1.1 1.1 M4.3 15.7l1.1-1.1 M14.6 5.4l1.1-1.1',
  moon: 'M16 12.5A6.5 6.5 0 0 1 7.5 4a6.5 6.5 0 1 0 8.5 8.5Z',
  monitor: 'M3 4h14v9H3z M7 16.5h6 M10 13v3.5',
  spark: 'M10 3l1.5 3.5L15 8l-3.5 1.5L10 13l-1.5-3.5L5 8l3.5-1.5z',
  split: 'M7.5 6.5 4 10l3.5 3.5 M12.5 6.5 16 10l-3.5 3.5',
  undo: 'M7 5 3.5 8.5 7 12 M3.5 8.5H12a4 4 0 0 1 0 8H9',
  redo: 'M13 5l3.5 3.5L13 12 M16.5 8.5H8a4 4 0 0 0 0 8h3',
  warn: 'M10 3.5 17 16H3z M10 8.5v3 M10 13.8v.2',
  trash: 'M4 6h12 M8 6V4h4v2 M5.5 6l.8 10h7.4l.8-10',
  close: 'M5.5 5.5l9 9 M14.5 5.5l-9 9',
  folder: 'M3 5h5l2 2h7v9H3z',
  info: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm0-4V9m0-3h.01',
  check: 'M4.5 10.5 8 14l7.5-8',
  up: 'M10 15V5m0 0-4 4m4-4 4 4',
  down: 'M10 5v10m0 0-4-4m4 4 4-4',
  plus: 'M10 4v12M4 10h12',
  duplicate: 'M7 7h9v9H7z M4 13V4h9',
  chevron: 'M8 5l5 5-5 5',
  chevronDown: 'M5 8l5 5 5-5',
  sliders: 'M4 6h8 M15 6h1 M4 14h2 M9 14h7 M12 4v4 M6 12v4',
  eyedropper: 'M12.5 4.5l3 3 M14 3a1.5 1.5 0 0 1 2.1 2.1l-2 2-2.1-2.1z M12 7 5 14v2h2l7-7',
  zip: 'M5 2h7l4 4v12H5zM9 4h1M9 6h1M9 8h1M9 10h1v3H9z',
  minus: 'M4 10h12',
  fit: 'M3.5 7.5v-4h4 M12.5 3.5h4v4 M16.5 12.5v4h-4 M7.5 16.5h-4v-4',
  grip: 'M7.5 5h.01 M12.5 5h.01 M7.5 10h.01 M12.5 10h.01 M7.5 15h.01 M12.5 15h.01',
  pencil: 'M12.5 4.5l3 3 M14 3a1.5 1.5 0 0 1 2.1 2.1L7 14.2 3.5 15.5l1.3-3.5z',
  pdf: 'M5 2h7l4 4v12H5z M12 2v4h4 M7.5 11h5 M7.5 14h5',
} as const;

export type IconName = keyof typeof paths;

export const Icon = ({ name, className = 'size-4', strokeWidth = 1.6 }: { name: IconName; className?: string; strokeWidth?: number }) => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    <path d={paths[name]} />
  </svg>
);

/** The brand mark: an ink square with the crop glyph and an accent dot. */
export const BrandMark = ({ className = 'size-6.5' }: { className?: string }) => (
  <span aria-hidden="true" className={`relative flex shrink-0 items-center justify-center rounded-[7px] bg-primary text-on-primary ${className}`}>
    <Icon name="crop" className="size-4" strokeWidth={2} />
    <span className="absolute top-1 right-1 size-1 rounded-full bg-brand" />
  </span>
);

export const Spinner = ({ className = 'size-3' }: { className?: string }) => (
  <span
    aria-hidden="true"
    className={`inline-block shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-70 ${className}`}
  />
);
