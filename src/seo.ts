// Page metadata per language. vite.config.ts writes it into index.html (English) and a
// pre-rendered de/index.html (German), so each language has its own crawlable URL.

export const SITE_URL = 'https://rkorsakov1.github.io/localcrop/';

type Seo = {
  lang: 'en' | 'de';
  path: string;
  locale: string;
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  image: string;
  imageAlt: string;
  features: string[];
  noscript: { heading: string; text: string; items: string[]; note: string };
};

export const SEO: Record<'en' | 'de', Seo> = {
  en: {
    lang: 'en',
    path: '',
    locale: 'en_US',
    title: 'LocalCrop — Crop, Resize, Compress & Convert Images in Your Browser',
    description:
      'Free, private image editor that runs entirely in your browser: crop, resize, compress to a target size, convert HEIC, PNG, WebP and AVIF, and remove backgrounds. Nothing is uploaded.',
    ogTitle: 'LocalCrop — private image cropping, compression and conversion',
    ogDescription: 'Crop, resize, compress and convert images right in your browser. Background removal included. Nothing is uploaded.',
    image: 'og-image.png',
    imageAlt: 'LocalCrop: a photo of a cat with a crop frame and the exact output size, 18.2 KB, 94% smaller.',
    features: [
      'Crop with a locked or free aspect ratio',
      'Compress to a target file size',
      'Convert HEIC, TIFF, SVG, PDF, PNG, WebP and AVIF',
      'Turn PDF pages into images, or images into a PDF',
      'On-device background removal',
      'Remove objects with a retouch brush',
      'Batch export as ZIP',
      'Works offline, no upload',
    ],
    noscript: {
      heading: 'LocalCrop needs JavaScript',
      text: 'LocalCrop is a free image tool that runs entirely in your browser. Turn on JavaScript to use it.',
      items: [
        'Crop, rotate and resize to presets for YouTube, Open Graph, Instagram and more',
        'Compress JPEG, WebP, AVIF and PNG, or hit a target size like 200 KB',
        'Convert HEIC, TIFF, SVG, TGA and more; unpack ZIP files',
        'Remove backgrounds and objects on your device',
      ],
      note: 'Your images never leave your device.',
    },
  },
  de: {
    lang: 'de',
    path: 'de/',
    locale: 'de_DE',
    title: 'LocalCrop – Bilder zuschneiden, verkleinern, komprimieren & umwandeln im Browser',
    description:
      'Kostenloser, privater Bildeditor direkt im Browser: Bilder zuschneiden, verkleinern, auf eine Zielgröße komprimieren, HEIC, PNG, WebP und AVIF umwandeln und Hintergründe entfernen. Kein Upload.',
    ogTitle: 'LocalCrop – Bilder privat zuschneiden, komprimieren und umwandeln',
    ogDescription: 'Bilder direkt im Browser zuschneiden, verkleinern, komprimieren und umwandeln – inklusive Hintergrundentfernung. Nichts wird hochgeladen.',
    image: 'og-image-de.png',
    imageAlt: 'LocalCrop: ein Katzenfoto mit Zuschnittrahmen und der exakten Ausgabegröße, 18,2 KB, 94 % kleiner.',
    features: [
      'Zuschneiden mit festem oder freiem Seitenverhältnis',
      'Auf eine Ziel-Dateigröße komprimieren',
      'HEIC, TIFF, SVG, PDF, PNG, WebP und AVIF umwandeln',
      'PDF-Seiten in Bilder umwandeln oder Bilder in eine PDF',
      'Hintergrund lokal entfernen',
      'Objekte mit dem Retusche-Pinsel entfernen',
      'Stapelexport als ZIP',
      'Funktioniert offline, ohne Upload',
    ],
    noscript: {
      heading: 'LocalCrop benötigt JavaScript',
      text: 'LocalCrop ist ein kostenloses Bildwerkzeug, das komplett im Browser läuft. Aktiviere JavaScript, um es zu nutzen.',
      items: [
        'Zuschneiden, drehen und skalieren mit Vorlagen für YouTube, Open Graph, Instagram und mehr',
        'JPEG, WebP, AVIF und PNG komprimieren oder eine Zielgröße wie 200 KB treffen',
        'HEIC, TIFF, SVG, TGA und mehr umwandeln; ZIP-Dateien entpacken',
        'Hintergründe und Objekte lokal entfernen',
      ],
      note: 'Deine Bilder verlassen nie dein Gerät.',
    },
  },
};

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** <head> tags for one language: title, description, canonical, hreflang, Open Graph, Twitter, JSON-LD. */
export const headTags = (seo: Seo): string => {
  const url = `${SITE_URL}${seo.path}`;
  const other = seo.lang === 'en' ? SEO.de : SEO.en;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'LocalCrop',
    url,
    description: seo.description,
    inLanguage: seo.lang,
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Any (runs in a web browser)',
    browserRequirements: 'Requires JavaScript and WebAssembly',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    image: `${SITE_URL}${seo.image}`,
    featureList: seo.features,
    license: 'https://opensource.org/licenses/MIT',
    codeRepository: 'https://github.com/rkorsakov1/localcrop',
  };
  return [
    `<title>${escape(seo.title)}</title>`,
    `<meta name="description" content="${escape(seo.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<link rel="alternate" hreflang="en" href="${SITE_URL}" />`,
    `<link rel="alternate" hreflang="de" href="${SITE_URL}de/" />`,
    `<link rel="alternate" hreflang="x-default" href="${SITE_URL}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="LocalCrop" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:title" content="${escape(seo.ogTitle)}" />`,
    `<meta property="og:description" content="${escape(seo.ogDescription)}" />`,
    `<meta property="og:locale" content="${seo.locale}" />`,
    `<meta property="og:locale:alternate" content="${other.locale}" />`,
    `<meta property="og:image" content="${SITE_URL}${seo.image}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escape(seo.imageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escape(seo.ogTitle)}" />`,
    `<meta name="twitter:description" content="${escape(seo.ogDescription)}" />`,
    `<meta name="twitter:image" content="${SITE_URL}${seo.image}" />`,
    `<meta name="twitter:image:alt" content="${escape(seo.imageAlt)}" />`,
    // Data, not a script: the Content-Security-Policy doesn't apply to JSON-LD.
    `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
  ].join('\n    ');
};

/** Shown to crawlers and to visitors without JavaScript; React replaces #root's content on start. */
export const noscriptBlock = (seo: Seo): string =>
  `<noscript><main style="max-width:40rem;margin:4rem auto;padding:0 1.5rem;font-family:system-ui,sans-serif;line-height:1.5">` +
  `<h1>${escape(seo.noscript.heading)}</h1><p>${escape(seo.noscript.text)}</p>` +
  `<ul>${seo.noscript.items.map((item) => `<li>${escape(item)}</li>`).join('')}</ul>` +
  `<p>${escape(seo.noscript.note)}</p></main></noscript>`;
